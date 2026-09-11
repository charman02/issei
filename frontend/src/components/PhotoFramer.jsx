import { useEffect, useRef, useState } from 'react'

// FRAME YOUR OWN PHOTO (#103). Reported twice in one feedback batch, which is what made it a P0:
//
//   "Hard to adjust the photo to center the subject."
//   "Can't edit profile photo to make sure it looks as u want."
//
// Both were the same defect. The crop happened entirely SERVER-SIDE, after the upload, with no
// preview and no control: `crop: fill` centre-crops to the target ratio, so anything the person
// cared about got cut whenever it wasn't dead centre, and they only found out afterwards. This
// matters more than most polish because a POST IS ITS PHOTO — a post carries no ingredients or
// steps — and an avatar is how friends recognise someone.
//
// WHY THE SERVER DIDN'T CHANGE. The client now sends an image ALREADY at the target aspect ratio,
// so Cloudinary's existing `crop: fill` becomes a pure resize — same ratio in, nothing to cut. That
// keeps the whole feature on one side of the wire: no new endpoint, no crop parameters to validate,
// and an old client that doesn't frame still behaves exactly as it did. `gravity: face` likewise
// becomes a no-op on a square input rather than something to remove.
//
// NO NEW DEPENDENCY. The frontend is deliberately at five runtime packages (see `package.json`;
// the rule is stated in CLAUDE.md and ARCHITECTURE.md). A canvas, pointer events and one wheel
// listener are enough; an image-cropper library would be the sixth package for a screen whose whole
// interaction is a drag and a pinch.
//
// TOUCH IS THE PRIMARY INPUT, so pinch is not a nicety here. The first version of this file said
// "Pinch or use the slider to zoom" and implemented no multi-touch at all — and because the canvas
// carries `touch-none`, the browser's own pinch was suppressed too, so two fingers on a phone
// panned the photo instead of zooming it while the one instruction on screen said otherwise. On a
// mobile-first app that made the slider the only working zoom. `pointers` tracks every live pointer
// by id for exactly this reason.

// The two ratios the app actually stores, and nothing else — matching what the server produces so
// the resize downstream is lossless in shape. A third would be a third thing to keep in step.
export const FRAME_RATIOS = {
  cover: 4 / 3, // recipe cover + post photo → 800x600
  avatar: 1, // profile picture → 400x400
}

// Output pixels for the long edge. Generous enough that the server's resize never upscales, small
// enough that a re-encoded JPEG stays under the 10 MB ceiling with room to spare.
const OUTPUT_LONG_EDGE = 1600
const JPEG_QUALITY = 0.9

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

// Zoom about a POINT, returning the offset that keeps whatever source pixel is under `mid` exactly
// where it is. Pinching over someone's face has to leave that face under the fingers — zooming
// about the frame's centre instead slides the subject out of the very frame the gesture exists to
// place it in.
//
// EXPORTED AND PURE on purpose: it is the only real arithmetic on this screen, and jsdom cannot
// deliver a two-finger gesture (nor decode an image to have a `naturalWidth` at all), so this is
// the part that would otherwise be verifiable only by hand in a browser. All lengths are FRAME
// pixels; `base` is the "just covers the frame" scale that zoom multiplies.
export function anchoredOffset({ mid, srcW, srcH, frameW, frameH, base, fromZoom, fromOffset, toZoom }) {
  const s0 = base * fromZoom
  // Which source pixel sits under `mid` at the zoom the gesture began from…
  const srcX = (mid.x - ((frameW - srcW * s0) / 2 + fromOffset.x)) / s0
  const srcY = (mid.y - ((frameH - srcH * s0) / 2 + fromOffset.y)) / s0
  // …and the offset that keeps that same pixel there at the new zoom.
  const s1 = base * toZoom
  return {
    x: mid.x - (frameW - srcW * s1) / 2 - srcX * s1,
    y: mid.y - (frameH - srcH * s1) / 2 - srcY * s1,
  }
}

export default function PhotoFramer({ file, shape = 'cover', onDone, onCancel }) {
  const ratio = FRAME_RATIOS[shape] ?? FRAME_RATIOS.cover
  const [img, setImg] = useState(null)
  const [error, setError] = useState('')
  // The view transform: `zoom` is a multiplier over the "cover the frame" baseline, and offset is in
  // FRAME pixels. Kept in state rather than on the canvas so a re-render redraws identically.
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  // A counter bumped on resize, held in state ONLY so the draw effect reruns. Deliberately not the
  // width itself: the effect reads the live `clientWidth`, so storing a second copy of it would
  // invite someone to trust the stale one.
  const [resizeTick, setResizeTick] = useState(0)
  const canvasRef = useRef(null)
  const frameRef = useRef(null)
  const drag = useRef(null)
  // EVERY pointer currently down, by id — not a boolean, because two fingers is a different
  // gesture from one and the second `pointerdown` must not be mistaken for a new drag. Keeping the
  // whole map is also what lets a lifted finger hand the drag back to the one still on the glass.
  const pointers = useRef(new Map())
  const pinch = useRef(null)
  // The committed offset, readable from an event handler. A gesture that starts in the middle of
  // another one (a finger lifting out of a pinch) needs the offset as it is NOW, and the handler's
  // closure only has the value from its last render — one frame behind a burst of setOffset calls.
  const offsetRef = useRef(offset)
  useEffect(() => {
    offsetRef.current = offset
  }, [offset])

  // Load the picked file into an Image. `createObjectURL` rather than a FileReader data URL: it
  // avoids base64-ing a 10 MB photo into a string on a phone.
  //
  // TWO THINGS HERE ARE FIXES FOR A BUG A REAL BROWSER FOUND and jsdom could not (it has no image
  // decoder, so the load never resolves either way and both paths looked fine):
  //
  // 1. REVOKE AFTER THE LOAD SETTLES, not in the cleanup. Revoking in cleanup killed the URL while
  //    the decode was still in flight — under React StrictMode, which runs every effect twice in
  //    dev, the first pass's cleanup revoked the URL its own Image was still reading, and Chrome
  //    logged ERR_FILE_NOT_FOUND.
  // 2. A `cancelled` FLAG, so a superseded pass cannot write state. Without it StrictMode's
  //    doomed first Image called setError, and since nothing cleared it, "That image could not be
  //    opened" sat on screen OVER a preview that had loaded perfectly — the app calling its own
  //    working feature broken.
  //
  // `setError('')` on success is the belt to that braces: any earlier failure is answered by the
  // photo appearing.
  useEffect(() => {
    if (!file) return undefined
    let cancelled = false
    let settled = false
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      settled = true
      URL.revokeObjectURL(url)
      if (cancelled) return
      setError('')
      setImg(image)
    }
    image.onerror = () => {
      settled = true
      URL.revokeObjectURL(url)
      if (cancelled) return
      setError('That image could not be opened. Try another, or use it as it is.')
    }
    image.src = url
    return () => {
      cancelled = true
      // Revoking on the way out is safe ONLY once the load has settled — that is the whole point of
      // moving the revoke into the handlers. But an unmount BEFORE it settles (tapping "Use this
      // photo" while the preview is still decoding, which is a real path and one the tests exercise)
      // would otherwise leak the URL for the life of the document, since neither handler will now
      // run. Cancelling the load first, then revoking, closes that without reopening the original
      // bug: `src = ''` aborts the fetch, so no in-flight decode is reading the URL we drop.
      if (!settled) {
        image.src = ''
        URL.revokeObjectURL(url)
      }
    }
  }, [file])

  // BASELINE SCALE = "just covers the frame". Everything else is relative to it, which is what makes
  // zoom feel the same whether the photo is 4000px wide or 400.
  function baseScale(frameW, frameH) {
    if (!img) return 1
    return Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight)
  }

  // Clamp so the frame is ALWAYS fully covered — no empty edges, ever. Without this, dragging a
  // photo halfway out of the frame produces a picture with a transparent margin, which is worse
  // than the centre-crop this screen exists to replace.
  function clamp(next, frameW, frameH, z) {
    const s = baseScale(frameW, frameH) * z
    const maxX = Math.max(0, (img.naturalWidth * s - frameW) / 2)
    const maxY = Math.max(0, (img.naturalHeight * s - frameH) / 2)
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    }
  }

  // Draw at the FRAME's on-screen size, scaled by dpr so it isn't soft on a phone.
  useEffect(() => {
    const canvas = canvasRef.current
    const frame = frameRef.current
    if (!canvas || !frame || !img) return
    const frameW = frame.clientWidth
    const frameH = Math.round(frameW / ratio)
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(frameW * dpr)
    canvas.height = Math.round(frameH * dpr)
    canvas.style.height = `${frameH}px`
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, frameW, frameH)
    const s = baseScale(frameW, frameH) * zoom
    const w = img.naturalWidth * s
    const h = img.naturalHeight * s
    ctx.drawImage(img, (frameW - w) / 2 + offset.x, (frameH - h) / 2 + offset.y, w, h)
  }, [img, zoom, offset, ratio, resizeTick])

  // REDRAW ON RESIZE, and re-clamp. This effect owns `canvas.width/height` and the inline
  // `style.height`, all derived from `frame.clientWidth` — so without a resize signal an orientation
  // flip left the bitmap stretched to a new CSS width while the height stayed put, and worse, the
  // offset was still clamped for the OLD frame: an offset legal at 400px wide is out of bounds at
  // 300px, which is exactly how a cream band gets into the uploaded photo (the clamp is the only
  // thing guaranteeing full coverage). `frameSize()` already re-read the frame per gesture and cited
  // orientation flips in its own comment; the draw path needed the same treatment.
  useEffect(() => {
    function onResize() {
      const s = frameSize()
      if (!s) return
      setResizeTick((n) => n + 1) // retrigger the draw effect
      if (img) setOffset((o) => clamp(o, s.frameW, s.frameH, zoom))
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom, ratio])

  // WHEEL, attached BY HAND rather than as an `onWheel` prop. React registers wheel as a PASSIVE
  // listener (react-dom lists it alongside touchstart/touchmove), so `e.preventDefault()` inside a
  // JSX onWheel is silently a no-op and the page scrolls behind the modal while you zoom. A direct
  // `{ passive: false }` listener is the only way to hold the page still. Desktop affordance only —
  // a phone has no wheel, which is why pinch exists.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return undefined
    const onWheel = (e) => {
      e.preventDefault()
      changeZoom(zoom + (e.deltaY < 0 ? 0.12 : -0.12))
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom, ratio])

  // The frame's on-screen size — recomputed per gesture rather than stored, because it changes with
  // an orientation flip and a stale value would desynchronise the crop from the preview.
  function frameSize() {
    const frame = frameRef.current
    if (!frame) return null
    const frameW = frame.clientWidth
    return { frameW, frameH: Math.round(frameW / ratio) }
  }

  // Two live pointers → the distance between them and their midpoint, in FRAME coordinates.
  //
  // `clientLeft`/`clientTop` subtract the frame's own 2.5px BORDER. `getBoundingClientRect()` gives
  // the outer edge, but every other length here is content-box (`frameW` is `clientWidth`, and the
  // canvas is `w-full` so its pixel 0 sits inside the border) — so without this the midpoint was
  // systematically 2.5px down and right of the space the maths assumes. That is the ~2.7px anchor
  // drift the browser probe measured and I wrote off as noise; it was this, and it is not noise:
  // it's a fixed bias that grows with the border, and a reader comparing the two coordinate spaces
  // would have found the arithmetic self-inconsistent.
  function pinchOf() {
    const frame = frameRef.current
    const [a, b] = [...pointers.current.values()]
    if (!a || !b || !frame) return null
    const box = frame.getBoundingClientRect()
    const originX = box.left + frame.clientLeft
    const originY = box.top + frame.clientTop
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2 - originX, y: (a.y + b.y) / 2 - originY },
    }
  }

  function onPointerDown(e) {
    if (!img) return
    // REGISTER THE POINTER FIRST, then try to capture. The reverse order — which this file shipped
    // with — put a throwing call ahead of the only state that makes the gesture work:
    // `setPointerCapture` raises "No active pointer with the given id is found" whenever the browser
    // doesn't consider that pointer active, and the exception took `pointers.set` down with it, so
    // NEITHER drag nor pinch registered at all. Capture is an enhancement (it keeps events coming
    // when a finger slides off the canvas); the gesture must not depend on it succeeding.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // Nothing to do — the handlers below work without capture.
    }
    if (pointers.current.size >= 2) {
      // A pinch begins: remember the finger spread and the zoom it started from, so the gesture is
      // measured against its own origin. Deriving zoom from the PREVIOUS frame instead would
      // compound rounding every move and drift.
      const p = pinchOf()
      pinch.current = p ? { dist: p.dist, zoom, offset: offsetRef.current } : null
      drag.current = null
    } else {
      drag.current = { x: e.clientX, y: e.clientY, from: offsetRef.current }
    }
  }

  function onPointerMove(e) {
    if (!img || !pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const size = frameSize()
    if (!size) return
    const { frameW, frameH } = size

    // PINCH — two fingers. Zoom about the MIDPOINT, not the frame's centre: pinching over someone's
    // face has to keep that face under the fingers, or the subject slides out of the very frame the
    // gesture exists to place it in.
    if (pointers.current.size >= 2 && pinch.current) {
      const p = pinchOf()
      if (!p || !pinch.current.dist) return
      const from = pinch.current
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from.zoom * (p.dist / from.dist)))
      const at = anchoredOffset({
        mid: p.mid,
        srcW: img.naturalWidth,
        srcH: img.naturalHeight,
        frameW,
        frameH,
        base: baseScale(frameW, frameH),
        fromZoom: from.zoom,
        fromOffset: from.offset,
        toZoom: next,
      })
      setOffset(clamp(at, frameW, frameH, next))
      setZoom(next)
      return
    }

    // DRAG — one finger, or a mouse.
    if (!drag.current) return
    setOffset(
      clamp(
        {
          x: drag.current.from.x + (e.clientX - drag.current.x),
          y: drag.current.from.y + (e.clientY - drag.current.y),
        },
        frameW,
        frameH,
        zoom,
      ),
    )
  }

  function onPointerUp(e) {
    pointers.current.delete(e.pointerId)
    pinch.current = null
    const rest = [...pointers.current.values()]
    if (rest.length >= 2) {
      // THREE FINGERS BECOMING TWO IS STILL A PINCH. The first version only handled 2→1: it nulled
      // `pinch.current` and anchored a drag, so lifting one finger of three left two fingers PANNING
      // the photo — the exact symptom the pinch work exists to eliminate — and anchored to one
      // finger's coordinates, so it jumped as well. Re-arm from the fingers that remain, measuring
      // the gesture afresh from here rather than from a spread that included a finger now gone.
      const p = pinchOf()
      pinch.current = p ? { dist: p.dist, zoom, offset: offsetRef.current } : null
      drag.current = null
      return
    }
    // A finger lifted out of a pinch leaves one still down. Re-anchor the drag to WHERE IT IS now
    // rather than clearing it — otherwise the photo either jumps or freezes until they let go
    // entirely, and letting go is the one thing someone mid-adjustment doesn't want to do.
    drag.current = rest[0] ? { x: rest[0].x, y: rest[0].y, from: offsetRef.current } : null
  }

  function changeZoom(next) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    const frame = frameRef.current
    if (frame && img) {
      const frameW = frame.clientWidth
      const frameH = Math.round(frameW / ratio)
      // Re-clamp on zoom OUT, or the offset from a zoomed-in drag leaves an empty edge behind.
      setOffset((o) => clamp(o, frameW, frameH, z))
    }
    setZoom(z)
  }

  // Render the visible rectangle at output resolution and hand back a File.
  async function use() {
    const frame = frameRef.current
    if (!img || !frame) {
      // NEVER A DEAD END. If the preview couldn't be drawn — a decode failure, a browser with no
      // canvas — the only other control here would be "Pick a different one", which strands someone
      // whose photo is perfectly fine. Fall through with the original instead: an uncropped upload
      // is a worse photo, not a lost one.
      onDone(undefined)
      return
    }
    const frameW = frame.clientWidth
    const frameH = Math.round(frameW / ratio)
    const s = baseScale(frameW, frameH) * zoom

    // Map the frame back onto SOURCE pixels: what the person sees is exactly what gets cut.
    const sx = (img.naturalWidth - frameW / s) / 2 - offset.x / s
    const sy = (img.naturalHeight - frameH / s) / 2 - offset.y / s
    const sw = frameW / s
    const sh = frameH / s

    // Cap the WIDTH (height follows from the ratio), and never upscale past the pixels the crop
    // actually has. Correct for a portrait ratio too, since the cap itself is ratio-scaled.
    const maxW = ratio >= 1 ? OUTPUT_LONG_EDGE : Math.round(OUTPUT_LONG_EDGE * ratio)
    const out = document.createElement('canvas')
    out.width = Math.min(maxW, Math.round(sw))
    out.height = Math.round(out.width / ratio)
    const ctx = out.getContext('2d')
    // Fill before drawing, because the output is JPEG and JPEG HAS NO ALPHA. A PNG with a
    // transparent region is an accepted upload (ACCEPTED_IMAGE_TYPES), and before #103 it reached
    // Cloudinary untouched and stayed a PNG — so re-encoding it here would have composited those
    // pixels onto the canvas's default transparent-black. Cream is the app's own background, so a
    // logo on a transparent field lands on the colour it would have sat on anyway.
    ctx.fillStyle = '#FBF3E2'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height)

    const blob = await new Promise((resolve) =>
      out.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) {
      // No canvas encoder (jsdom, a few locked-down browsers). `undefined` means "couldn't crop —
      // upload the original", which is NOT the same as `null`, which cancels the pick. Conflating
      // those two would make a missing encoder look like the person changing their mind.
      onDone(undefined)
      return
    }
    const name = (file?.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg'
    onDone(new File([blob], name, { type: 'image/jpeg' }))
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/50 flex items-end sm:items-center justify-center px-4 py-4">
      {/* `max-h-full` + `overflow-y-auto`, matching RecipePicker — the app's other bottom sheet,
          which is capped for the same reason. An avatar preview is SQUARE, so its height equals the
          panel's inner width: on a 320-360px phone the heading, the instruction, the square frame,
          the slider and two stacked buttons already exceed a short viewport, and with no cap the
          sheet grew past the screen with no way to scroll — "Use this photo" simply off-screen on
          the device class this whole feature was built for. */}
      <div className="sticker bg-card w-full max-w-sm p-4 max-h-full overflow-y-auto">
        <h2 className="font-display font-black text-[19px] text-ink leading-tight">
          {shape === 'avatar' ? 'Frame your photo' : 'Frame the photo'}
        </h2>
        <p className="font-display italic text-[12.5px] text-ink-soft mt-1 mb-3 leading-snug">
          Drag to move it. Pinch or use the slider to zoom.
        </p>

        {error ? (
          <p className="mb-3">
            <span className="error-pill">{error}</span>
          </p>
        ) : null}

        <div
          ref={frameRef}
          className={`relative w-full overflow-hidden border-[2.5px] border-ink bg-cream ${
            shape === 'avatar' ? 'rounded-full' : 'rounded-[14px]'
          }`}
          style={{ aspectRatio: String(ratio) }}
        >
          <canvas
            ref={canvasRef}
            aria-label="Photo preview"
            className="block w-full touch-none cursor-grab active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>

        <label className="block mt-3">
          <span className="section-label">Zoom</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step="0.02"
            value={zoom}
            aria-label="Zoom"
            onChange={(e) => changeZoom(Number(e.target.value))}
            className="w-full mt-1 accent-terra"
          />
        </label>

        <div className="flex flex-col gap-2.5 mt-3">
          {/* Deliberately NOT disabled while the image loads. See `use()`: with no preview it
              uploads the original, which is the outcome someone wants far more than a stuck
              button. */}
          <button onClick={use} className="btn-primary">
            Use this photo
          </button>
          <button
            onClick={onCancel}
            className="font-display font-bold text-[13px] text-ink-soft py-1"
          >
            Pick a different one
          </button>
        </div>
      </div>
    </div>
  )
}
