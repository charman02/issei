import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhotoFramer, { FRAME_RATIOS } from './PhotoFramer'

// WHAT JSDOM CANNOT SEE, stated up front so nobody trusts these tests further than they go: there is
// no layout engine, no image decoder and no canvas encoder here. The drag maths, the zoom clamp and
// the pixel output are verified in a real browser instead (see the #103 commit message).
//
// What IS testable, and worth pinning, is everything about the CONTRACT — because each of these was
// a way to strand someone holding a photo:
//   - never a dead end: "Use this photo" works even when the preview never rendered
//   - the aspect ratios stay the two the server stores
//   - cancel means cancel, and it is distinguishable from "couldn't crop"

const FILE = new File(['x'], 'dinner.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  // jsdom has neither; both are exercised by the fall-through paths below.
  global.URL.createObjectURL = vi.fn(() => 'blob:fake')
  global.URL.revokeObjectURL = vi.fn()
})

describe('PhotoFramer (#103)', () => {
  it('says what to do, in gestures rather than jargon', () => {
    render(<PhotoFramer file={FILE} onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByText(/drag to move it/i)).toBeInTheDocument()
    expect(screen.getByText(/pinch or use the slider to zoom/i)).toBeInTheDocument()
    // No "crop", no "aspect ratio", no "1:1" — this screen is for someone framing their dinner.
    expect(screen.queryByText(/aspect ratio|1:1|4:3/i)).toBeNull()
  })

  it('offers BOTH a way forward and a way out', () => {
    render(<PhotoFramer file={FILE} onDone={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /use this photo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pick a different one/i })).toBeInTheDocument()
  })

  it('NEVER disables "Use this photo" — a stuck button is worse than an uncropped photo', async () => {
    // The image never decodes in jsdom, which is exactly the state this guards: a decode failure or
    // a slow load must not leave someone with only "pick a different one" for a photo that is fine.
    const onDone = vi.fn()
    render(<PhotoFramer file={FILE} onDone={onDone} onCancel={() => {}} />)
    const use = screen.getByRole('button', { name: /use this photo/i })
    expect(use).not.toBeDisabled()

    await userEvent.click(use)

    // `undefined`, meaning "upload the original" — NOT null, which would cancel the pick.
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(undefined))
  })

  it('cancel resolves through onCancel, not onDone', async () => {
    const onDone = vi.fn()
    const onCancel = vi.fn()
    render(<PhotoFramer file={FILE} onDone={onDone} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: /pick a different one/i }))

    expect(onCancel).toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('frames an avatar as a CIRCLE and a cover as a rounded rectangle', () => {
    // The shape someone sees has to match where the photo ends up, or they frame for the wrong crop.
    const { unmount } = render(
      <PhotoFramer file={FILE} shape="avatar" onDone={() => {}} onCancel={() => {}} />,
    )
    expect(screen.getByLabelText('Photo preview').parentElement.className).toMatch(/rounded-full/)
    unmount()

    render(<PhotoFramer file={FILE} shape="cover" onDone={() => {}} onCancel={() => {}} />)
    const frame = screen.getByLabelText('Photo preview').parentElement
    expect(frame.className).not.toMatch(/rounded-full/)
  })

  it('carries exactly the two ratios the server stores', () => {
    // 800x600 and 400x400 (app/routers/upload.py). A third ratio here would be a third thing to
    // keep in step with the backend, and the sending side is what makes the server's crop a no-op.
    expect(Object.keys(FRAME_RATIOS).sort()).toEqual(['avatar', 'cover'])
    expect(FRAME_RATIOS.cover).toBeCloseTo(800 / 600)
    expect(FRAME_RATIOS.avatar).toBe(1)
  })

  it('falls back to "cover" for an unknown shape rather than dividing by undefined', () => {
    render(<PhotoFramer file={FILE} shape="nonsense" onDone={() => {}} onCancel={() => {}} />)
    const frame = screen.getByLabelText('Photo preview').parentElement
    expect(frame.style.aspectRatio).toBe(String(FRAME_RATIOS.cover))
  })

  it('offers zoom as a labelled slider, so it works without a trackpad or two fingers', () => {
    render(<PhotoFramer file={FILE} onDone={() => {}} onCancel={() => {}} />)
    const zoom = screen.getByLabelText('Zoom')
    expect(zoom).toHaveAttribute('type', 'range')
    expect(zoom).toHaveValue('1')
  })

  it('claims nothing about voice, audio or recording', () => {
    // A new user-facing surface; POSITIONING treats the count of these guards as a floor.
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    render(<PhotoFramer file={FILE} onDone={() => {}} onCancel={() => {}} />)
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})
