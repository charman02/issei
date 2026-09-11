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
// NO NEW DEPENDENCY. The frontend is deliberately at five runtime packages and
// `frontend/.env.example` says so. A canvas, pointer events and a wheel listener are enough; an
// image-cropper library would be the sixth for a screen with two gestures on it.

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

export default function PhotoFramer({ file, shape = 'cover', onDone, onCancel }) {
  const ratio = FRAME_RATIOS[shape] ?? FRAME_RATIOS.cover
  const [img, setImg] = useState(null)
  const [error, setError] = useState('')
  // The view transform: `zoom` is a multiplier over the "cover the frame" baseline, and offset is in
  // FRAME pixels. Kept in state rather than on the canvas so a re-render redraws identically.
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const canvasRef = useRef(null)
  const frameRef = useRef(null)
  const drag = useRef(null)
  const objectUrl = useRef(null)

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
    const url = URL.createObjectURL(file)
    objectUrl.current = url
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      if (cancelled) return
      setError('')
      setImg(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      if (cancelled) return
      setError('That image could not be opened. Try another, or use it as it is.')
    }
    image.src = url
    return () => {
      cancelled = true
      objectUrl.current = null
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
  }, [img, zoom, offset, ratio])

  function onPointerDown(e) {
    if (!img) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, from: offset }
  }

  function onPointerMove(e) {
    if (!drag.current || !img) return
    const frame = frameRef.current
    const frameW = frame.clientWidth
    const frameH = Math.round(frameW / ratio)
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

  function onPointerUp() {
    drag.current = null
  }

  function changeZoom(next) {
    const z = Math.min(4, Math.max(1, next))
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

    const outW = ratio >= 1 ? OUTPUT_LONG_EDGE : Math.round(OUTPUT_LONG_EDGE * ratio)
    const outH = ratio >= 1 ? Math.round(OUTPUT_LONG_EDGE / ratio) : OUTPUT_LONG_EDGE
    const out = document.createElement('canvas')
    out.width = Math.min(outW, Math.round(sw))
    out.height = Math.round(out.width / ratio)
    const ctx = out.getContext('2d')
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
    <div className="fixed inset-0 z-50 bg-ink/50 flex items-end sm:items-center justify-center px-4">
      <div className="sticker bg-card w-full max-w-sm p-4 mb-4 sm:mb-0">
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
            onWheel={(e) => {
              e.preventDefault()
              changeZoom(zoom + (e.deltaY < 0 ? 0.12 : -0.12))
            }}
          />
        </div>

        <label className="block mt-3">
          <span className="section-label">Zoom</span>
          <input
            type="range"
            min="1"
            max="4"
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
