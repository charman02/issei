import { describe, it, expect } from 'vitest'
import { toUtcMs } from './time'

// This is where the naive-UTC contract is actually pinned, and it has to be here rather than
// in a render test. A component test can only assert what the browser PRINTS, which depends on
// the runtime's timezone — and CI runs in UTC, where the bug is invisible by definition (a bare
// parse and a UTC parse agree exactly when the offset is zero). No fixture can catch it there.
// Asserting the epoch milliseconds instead is timezone-independent: it's true in UTC, in
// New York and in Manila.
describe('toUtcMs — the API sends timestamps with no timezone', () => {
  it('reads a zone-less string as UTC, not as local time', () => {
    // The exact shape SQLAlchemy serializes: no offset, no trailing Z.
    expect(toUtcMs('2026-08-20T02:30:00')).toBe(Date.UTC(2026, 7, 20, 2, 30, 0))
  })

  it('is NOT what a bare Date() does, anywhere with an offset', () => {
    const iso = '2026-08-20T02:30:00'
    const offsetMinutes = new Date().getTimezoneOffset()
    const bare = new Date(iso).getTime()
    if (offsetMinutes === 0) {
      // Running in UTC (this is CI). The two agree, which is precisely why the assertion
      // above — on absolute ms — is the one that carries the contract.
      expect(bare).toBe(toUtcMs(iso))
    } else {
      // Anywhere else, a bare parse is wrong by exactly the offset. West of UTC that lands
      // the printed DATE on the previous day for anything posted in the small hours.
      expect(bare).not.toBe(toUtcMs(iso))
      expect(bare - toUtcMs(iso)).toBe(offsetMinutes * 60 * 1000)
    }
  })

  it('leaves a string that already carries a zone alone', () => {
    // Detect rather than assume, so this keeps working if the backend ever starts sending
    // offsets — appending 'Z' unconditionally would corrupt exactly that case.
    expect(toUtcMs('2026-08-20T02:30:00Z')).toBe(Date.UTC(2026, 7, 20, 2, 30, 0))
    expect(toUtcMs('2026-08-20T02:30:00+00:00')).toBe(Date.UTC(2026, 7, 20, 2, 30, 0))
    expect(toUtcMs('2026-08-20T04:30:00+02:00')).toBe(Date.UTC(2026, 7, 20, 2, 30, 0))
  })

  it('returns NaN for junk rather than throwing', () => {
    // Callers guard on Number.isNaN and render nothing; a throw would take the page with it.
    expect(Number.isNaN(toUtcMs('not-a-date'))).toBe(true)
  })
})
