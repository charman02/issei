import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PhotoFramer, { FRAME_RATIOS, MIN_ZOOM, MAX_ZOOM, anchoredOffset } from './PhotoFramer'

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

  it('offers zoom as a range whose bounds are the ones the gesture clamps to', () => {
    // The slider and the pinch must agree; two independently-written 1..4 pairs would eventually not.
    render(<PhotoFramer file={FILE} onDone={() => {}} onCancel={() => {}} />)
    const zoom = screen.getByLabelText('Zoom')
    expect(zoom).toHaveAttribute('min', String(MIN_ZOOM))
    expect(zoom).toHaveAttribute('max', String(MAX_ZOOM))
  })

  it('claims nothing about voice, audio or recording', () => {
    // A new user-facing surface; POSITIONING treats the count of these guards as a floor.
    const BANNED = /record|recording|\bvoice\b|audio|in (their|your|his|her)( own)? words|listen/i
    render(<PhotoFramer file={FILE} onDone={() => {}} onCancel={() => {}} />)
    expect(document.body.textContent).not.toMatch(BANNED)
  })
})

// PINCH-TO-ZOOM ANCHORING. The screen's one instruction says "Pinch or use the slider to zoom", and
// for one commit that was a lie: there was no multi-touch code at all, and `touch-none` suppressed
// the browser's own pinch too, so two fingers panned the photo on the one input that matters most.
//
// jsdom cannot deliver a two-finger gesture and cannot decode an image (so `naturalWidth` is 0 and
// the component's pinch branch bails before any arithmetic). The maths is therefore exported as a
// pure function and tested here directly, with the GESTURE WIRING verified in a real browser.
describe('anchoredOffset — zoom keeps the subject under the fingers', () => {
  // A 1000x1000 source in a 300x300 frame: base scale 0.3, so the whole image just covers it.
  const SQUARE = { srcW: 1000, srcH: 1000, frameW: 300, frameH: 300, base: 0.3 }
  const CENTRED = { x: 0, y: 0 }

  // Where does source pixel (srcX, srcY) land on screen, at a given zoom and offset?
  function screenPos({ srcX, srcY }, zoom, offset) {
    const s = SQUARE.base * zoom
    return {
      x: (SQUARE.frameW - SQUARE.srcW * s) / 2 + offset.x + srcX * s,
      y: (SQUARE.frameH - SQUARE.srcH * s) / 2 + offset.y + srcY * s,
    }
  }

  it('leaves the pixel under the midpoint exactly where it was', () => {
    // Fingers centred on a point up and to the left — someone framing a face off-centre.
    const mid = { x: 90, y: 120 }
    const before = { zoom: 1, offset: CENTRED }
    const toZoom = 2.5

    const at = anchoredOffset({ ...SQUARE, mid, fromZoom: before.zoom, fromOffset: before.offset, toZoom })

    // Work out which source pixel was under the midpoint, then confirm it is still there after.
    const s0 = SQUARE.base * before.zoom
    const src = {
      srcX: (mid.x - ((SQUARE.frameW - SQUARE.srcW * s0) / 2 + before.offset.x)) / s0,
      srcY: (mid.y - ((SQUARE.frameH - SQUARE.srcH * s0) / 2 + before.offset.y)) / s0,
    }
    const after = screenPos(src, toZoom, at)
    expect(after.x).toBeCloseTo(mid.x, 6)
    expect(after.y).toBeCloseTo(mid.y, 6)
  })

  it('is a no-op when the zoom does not change', () => {
    const at = anchoredOffset({
      ...SQUARE,
      mid: { x: 200, y: 40 },
      fromZoom: 1.8,
      fromOffset: { x: -25, y: 12 },
      toZoom: 1.8,
    })
    expect(at.x).toBeCloseTo(-25, 6)
    expect(at.y).toBeCloseTo(12, 6)
  })

  it('holds the anchor on zoom OUT as well as in', () => {
    const mid = { x: 240, y: 250 }
    const fromOffset = { x: 40, y: -60 }
    const at = anchoredOffset({ ...SQUARE, mid, fromZoom: 3, fromOffset, toZoom: 1.4 })

    const s0 = SQUARE.base * 3
    const src = {
      srcX: (mid.x - ((SQUARE.frameW - SQUARE.srcW * s0) / 2 + fromOffset.x)) / s0,
      srcY: (mid.y - ((SQUARE.frameH - SQUARE.srcH * s0) / 2 + fromOffset.y)) / s0,
    }
    const after = screenPos(src, 1.4, at)
    expect(after.x).toBeCloseTo(mid.x, 6)
    expect(after.y).toBeCloseTo(mid.y, 6)
  })

  it('anchoring at the exact centre is the same as plain centre-zoom', () => {
    // The degenerate case, worth pinning: pinching dead centre must not drift the photo sideways.
    const at = anchoredOffset({
      ...SQUARE,
      mid: { x: SQUARE.frameW / 2, y: SQUARE.frameH / 2 },
      fromZoom: 1,
      fromOffset: CENTRED,
      toZoom: 2,
    })
    expect(at.x).toBeCloseTo(0, 6)
    expect(at.y).toBeCloseTo(0, 6)
  })

  it('works for a non-square frame, where the two axes have different slack', () => {
    const WIDE = { srcW: 1200, srcH: 1200, frameW: 400, frameH: 300, base: 400 / 1200 }
    const mid = { x: 310, y: 80 }
    const fromOffset = { x: 5, y: -5 }
    const at = anchoredOffset({ ...WIDE, mid, fromZoom: 1.2, fromOffset, toZoom: 2.2 })

    const s0 = WIDE.base * 1.2
    const srcX = (mid.x - ((WIDE.frameW - WIDE.srcW * s0) / 2 + fromOffset.x)) / s0
    const srcY = (mid.y - ((WIDE.frameH - WIDE.srcH * s0) / 2 + fromOffset.y)) / s0
    const s1 = WIDE.base * 2.2
    expect((WIDE.frameW - WIDE.srcW * s1) / 2 + at.x + srcX * s1).toBeCloseTo(mid.x, 6)
    expect((WIDE.frameH - WIDE.srcH * s1) / 2 + at.y + srcY * s1).toBeCloseTo(mid.y, 6)
  })
})
