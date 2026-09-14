import { describe, it, expect } from 'vitest'

// A SOURCE INVARIANT, in the same spirit as palette-usage.test.js: some mistakes are invisible to a
// render test because every render test mocks the seam away.
//
// This one. `usePhotoFramer()` hands back a `frame` callback that `photoUpload.upload()` AWAITS, and
// the promise it returns is settled by nothing except `framerProps.onDone` / `onCancel` — i.e. only
// if the caller actually renders <PhotoFramer>. A surface that asks for a framer and forgets to
// render it therefore HANGS the pick forever: the busy flag goes off, no error appears, and the
// photo simply never shows up. There is nothing to see in the diff and nothing for a unit test to
// catch, because the failure is an absence.
//
// Written as a SCAN rather than a list of five paths on purpose: the risk is the sixth call site,
// added later by someone who copied the `frame:` line and not the render.

// Every source file as raw text, resolved by Vite relative to THIS file — no cwd assumptions.
const sources = import.meta.glob('./**/*.{js,jsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const files = Object.entries(sources).filter(([path]) => !/\.test\.jsx?$/.test(path))

// A file that RETURNS `framerProps` is a bridge, not a screen — `usePhotoFramer` itself, and
// `useAvatarUpload`, which calls it and hands the props onward. The obligation to render belongs to
// whoever the props stop at, so pass-throughs are excluded by that property rather than by name
// (a third hook would otherwise have to be remembered here).
const passesThrough = (text) => /return\s*\{[^}]*\bframerProps\b/.test(text)

// Whoever asks for a framer directly, plus whoever gets one indirectly through the avatar hook
// (which always passes one to photoUpload). Both kinds must render the component.
const callSites = files.filter(
  ([, text]) =>
    (/usePhotoFramer\(|useAvatarUpload\(/.test(text) || /\bframerProps\b/.test(text)) &&
    !passesThrough(text) &&
    !/export function usePhotoFramer/.test(text),
)

describe('the photo framer is rendered wherever it is requested (#103)', () => {
  it('finds the call sites at all, so a rename cannot quietly empty this test', () => {
    // Today SIX: PostComposer, RecipeForm, PostPage (direct — PostPage joined in #106) + Profile,
    // Welcome, PhotoNudge (via useAvatarUpload). The floor below is deliberately looser than the
    // exact count, so adding a seventh surface doesn't fail a test for the wrong reason.
    expect(callSites.length).toBeGreaterThanOrEqual(5)
  })

  it.each(callSites.map(([path, text]) => [path, text]))('%s renders <PhotoFramer>', (_path, text) => {
    expect(text).toMatch(/<PhotoFramer\b/)
    expect(text).toMatch(/from ['"][^'"]*PhotoFramer['"]/)
  })

  it.each(callSites.map(([path, text]) => [path, text]))(
    '%s guards that render on a picked file',
    (_path, text) => {
      // `framerProps?.file && <PhotoFramer …>`. The optional chain is not stylistic: PhotoNudge's
      // own tests mock useAvatarUpload with an object that has no framerProps key at all, and a
      // bare `framerProps.file` threw there. The guard also keeps an empty overlay off the screen.
      expect(text).toMatch(/framerProps\?\.file\s*&&\s*<PhotoFramer/)
    },
  )
})
