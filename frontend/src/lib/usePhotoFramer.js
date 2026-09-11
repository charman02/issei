import { useCallback, useRef, useState } from 'react'

// Bridges `photoUpload`'s promise-shaped `frame` hook to a React component (#103).
//
// The upload pipeline wants to `await` a decision; a component makes that decision from a click.
// This is the join: `frame(file)` returns a promise, stores its resolver, and renders the framer via
// the props it hands back. The resolver fires when the person taps "Use this photo" (a File) or
// "Pick a different one" (null, which cancels the pick entirely).
//
// Why a hook rather than an imperative modal helper: the framer has to be REAL DOM inside the
// caller's tree so it inherits the app's styles and its cancel path can restore the caller's own
// state. A portal-and-promise utility would work too, and would be one more abstraction than a
// screen with two gestures deserves.
//
// The resolver lives in a ref, not state: resolving is a one-shot side effect, and putting it in
// state would re-render the caller on every pick for no visual reason.
export function usePhotoFramer() {
  const [pending, setPending] = useState(null) // { file, shape } while the framer is open
  const resolver = useRef(null)

  // `shape` is 'cover' | 'avatar' — see FRAME_RATIOS.
  const makeFrame = useCallback(
    (shape) => (file) =>
      new Promise((resolve) => {
        // A second pick while the framer is open would otherwise leave the first promise dangling
        // forever, and `photoUpload` awaits it — the upload for that slot would hang with its busy
        // flag off and no error. Resolve the old one as a cancel before taking over.
        if (resolver.current) resolver.current(null)
        resolver.current = resolve
        setPending({ file, shape })
      }),
    [],
  )

  const settle = useCallback((value) => {
    const resolve = resolver.current
    resolver.current = null
    setPending(null)
    resolve?.(value)
  }, [])

  return {
    // Pass to `upload({ frame })`. Call with the shape you want: `frame('avatar')`.
    frame: makeFrame,
    // Spread onto <PhotoFramer> — null-file means "don't render it".
    framerProps: {
      file: pending?.file || null,
      shape: pending?.shape || 'cover',
      onDone: (framed) => settle(framed),
      onCancel: () => settle(null),
    },
    framing: Boolean(pending),
  }
}
