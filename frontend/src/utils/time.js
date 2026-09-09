// Timestamps from this API are NAIVE — no timezone at all.
//
// Every `created_at` is a SQLAlchemy `DateTime` with `server_default=func.now()`, which
// serializes as e.g. "2026-08-18T21:37:06". JS's `new Date()` reads a zone-less ISO string as
// LOCAL time, so a bare parse silently shifts every timestamp by the viewer's UTC offset. That
// bug shipped twice in different clothes: a fresh post read "just now" for hours in the
// Americas, and a permalink's date landed on the wrong DAY for anyone west of UTC (a meal
// posted 21:00 Tuesday in California renders as Wednesday).
//
// So: one helper, used by everything that renders a server timestamp. It appends 'Z' only when
// the string carries no zone of its own, which keeps it correct if the backend ever starts
// sending offsets — the whole point of detecting rather than assuming.
export function toUtcMs(iso) {
  const hasZone = /[zZ]|[+-]\d\d:?\d\d$/.test(iso)
  return new Date(hasZone ? iso : `${iso}Z`).getTime()
}
