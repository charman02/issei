import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// NOTE: we derive the path from the test file's own file:// URL rather than
// `new URL('./plant.css', import.meta.url)` — under Vite/jsdom that literal form
// is rewritten to an http:// asset URL, which fileURLToPath rejects. Joining via
// node:path keeps the same intent (read the stylesheet text and assert on it).
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'plant.css'),
  'utf8',
)

describe('plant.css', () => {
  it('defines the cascade growth keyframes', () => {
    ;['gTrunk', 'gBranchL', 'gBranchR', 'gCanopy'].forEach((k) => {
      expect(css).toContain('@keyframes ' + k)
    })
  })
  it('drives the cascade via the .cascading class and --gT duration', () => {
    expect(css).toMatch(/\.form\.cascading/)
    expect(css).toContain('--gT')
  })
  it('defines the bloom brighten and the idle sway', () => {
    expect(css).toContain('@keyframes brightenPulse')
    expect(css).toContain('@keyframes sway')
  })
  it('respects prefers-reduced-motion', () => {
    expect(css).toContain('prefers-reduced-motion')
  })
})
