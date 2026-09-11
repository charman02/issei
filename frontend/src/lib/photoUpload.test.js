import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createUploader, isHeic, PHOTO_ACCEPT, ACCEPTED_IMAGE_TYPES } from './photoUpload'
import client from '../api/client'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
  toUserMessage: (err, fallback) => err?.message || fallback,
}))

// THE CONSUMING SIDE of the #103 framing seam. `usePhotoFramer.test.jsx` proves the hook PRODUCES
// three distinct outcomes; this file proves `upload()` treats them as three different things —
// which is the property the design note calls load-bearing and which nothing pinned before.
//
// It exists because a shipped-green regression was one character away. Collapsing
// `if (framed === null)` into `if (!framed)` makes a browser with no canvas encoder (which resolves
// `undefined`, meaning "couldn't crop — send the original") look exactly like someone tapping
// "Pick a different one", and the photo is silently dropped. All 874 other tests pass either way.
//
// Also pinned here: the ORDER of the pipeline. Framing must run after HEIC conversion (no browser
// can draw a HEIC into a canvas, so framing first shows iPhone users a blank preview) and after
// validation (nobody should frame a 40 MB file only to be told no).

const FILE = new File(['x'], 'dinner.jpg', { type: 'image/jpeg' })
const CROPPED = new File(['y'], 'dinner-cropped.jpg', { type: 'image/jpeg' })

function pickEvent(file = FILE) {
  // A minimal stand-in for the change event of a real <input type="file">.
  return { target: { files: [file], value: 'C:\\fakepath\\dinner.jpg' } }
}

function harness() {
  return {
    onBusy: vi.fn(),
    onError: vi.fn(),
    onUrl: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  client.post.mockResolvedValue({ data: { url: 'https://res.cloudinary.com/x/a.jpg' } })
})

describe('photoUpload — the three framing outcomes (#103)', () => {
  it('a returned File is what gets uploaded, not the original pick', async () => {
    const h = harness()
    await createUploader().upload({
      slot: 'cover',
      event: pickEvent(),
      frame: async () => CROPPED,
      ...h,
    })

    expect(client.post).toHaveBeenCalledTimes(1)
    const sent = client.post.mock.calls[0][1].get('file')
    expect(sent.name).toBe('dinner-cropped.jpg')
    expect(h.onUrl).toHaveBeenCalledWith('https://res.cloudinary.com/x/a.jpg')
  })

  it('UNDEFINED uploads the ORIGINAL — "couldn’t crop" must never lose the photo', async () => {
    const h = harness()
    await createUploader().upload({
      slot: 'cover',
      event: pickEvent(),
      frame: async () => undefined,
      ...h,
    })

    expect(client.post).toHaveBeenCalledTimes(1)
    expect(client.post.mock.calls[0][1].get('file').name).toBe('dinner.jpg')
    expect(h.onUrl).toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalledWith(expect.stringMatching(/fail/i))
  })

  it('NULL cancels: nothing uploads, nothing errors, the existing photo stays', async () => {
    const h = harness()
    const event = pickEvent()
    await createUploader().upload({
      slot: 'cover',
      event,
      frame: async () => null,
      ...h,
    })

    expect(client.post).not.toHaveBeenCalled()
    expect(h.onUrl).not.toHaveBeenCalled()
    // Cancelling is not a failure — no error copy may appear for it.
    expect(h.onError.mock.calls.flat().filter(Boolean)).toEqual([])
    // The input is reset so the SAME file can be picked again (a change event needs a value change).
    expect(event.target.value).toBe('')
  })

  it('a framer that THROWS falls through with the original instead of eating the pick', async () => {
    const h = harness()
    await createUploader().upload({
      slot: 'cover',
      event: pickEvent(),
      frame: async () => {
        throw new Error('canvas exploded')
      },
      ...h,
    })

    expect(client.post).toHaveBeenCalledTimes(1)
    expect(client.post.mock.calls[0][1].get('file').name).toBe('dinner.jpg')
    expect(h.onError.mock.calls.flat().filter(Boolean)).toEqual([])
  })

  it('drops the busy flag while someone is framing, and raises it again for the upload', async () => {
    // A spinner during a deliberate interaction reads as a hang, and the file input has to stay
    // usable if they cancel. But the real upload after it must show progress.
    const h = harness()
    let busyWhileFraming = null
    await createUploader().upload({
      slot: 'cover',
      event: pickEvent(),
      frame: async () => {
        busyWhileFraming = h.onBusy.mock.calls.at(-1)[0]
        return CROPPED
      },
      ...h,
    })

    expect(busyWhileFraming).toBe(false)
    const flags = h.onBusy.mock.calls.map((c) => c[0])
    expect(flags).toEqual([true, false, true, false]) // pick → framing → uploading → done
  })

  it('never calls the framer when none is supplied — an unframed pick behaves exactly as before', async () => {
    const h = harness()
    await createUploader().upload({ slot: 'cover', event: pickEvent(), ...h })

    expect(client.post).toHaveBeenCalledTimes(1)
    expect(client.post.mock.calls[0][1].get('file').name).toBe('dinner.jpg')
  })
})

describe('photoUpload — framing runs LAST', () => {
  it('is not reached for a file that fails validation', async () => {
    const h = harness()
    const frame = vi.fn(async () => CROPPED)
    const huge = new File([new Uint8Array(2)], 'big.jpg', { type: 'image/jpeg' })
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 })

    await createUploader().upload({ slot: 'cover', event: pickEvent(huge), frame, ...h })

    expect(frame).not.toHaveBeenCalled()
    expect(client.post).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledWith(expect.stringMatching(/too large/i))
  })

  it('is not reached for a rejected file type', async () => {
    const h = harness()
    const frame = vi.fn(async () => CROPPED)
    const pdf = new File(['x'], 'recipe.pdf', { type: 'application/pdf' })

    await createUploader().upload({ slot: 'cover', event: pickEvent(pdf), frame, ...h })

    expect(frame).not.toHaveBeenCalled()
    expect(client.post).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledWith(expect.stringMatching(/JPEG, PNG, or WebP/i))
  })

  it('a superseded pick cannot upload what it framed', async () => {
    // Two picks for the same slot, the first still in its framer. The stale one must not write:
    // "replacing A with B kept A" is the race this module exists to prevent, and the framer adds a
    // long human pause right in the middle of it.
    const h = harness()
    const uploader = createUploader()
    let releaseFirst
    const first = uploader.upload({
      slot: 'cover',
      event: pickEvent(),
      frame: () => new Promise((r) => { releaseFirst = r }),
      ...h,
    })
    await uploader.upload({
      slot: 'cover',
      event: pickEvent(new File(['z'], 'second.jpg', { type: 'image/jpeg' })),
      frame: async () => null,
      ...h,
    })
    releaseFirst(CROPPED)
    await first

    expect(client.post).not.toHaveBeenCalled()
    expect(h.onUrl).not.toHaveBeenCalled()
  })
})

describe('photoUpload — unchanged surface', () => {
  it('accepts HEIC at the input but not as an upload type', () => {
    expect(PHOTO_ACCEPT).toMatch(/heic/)
    expect(ACCEPTED_IMAGE_TYPES).not.toContain('image/heic')
    expect(isHeic(new File(['x'], 'IMG_1.HEIC'))).toBe(true)
    expect(isHeic(FILE)).toBe(false)
  })
})
