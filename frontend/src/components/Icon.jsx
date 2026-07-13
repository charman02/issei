// Single source of truth for every glyph in the app. We inline Lucide-style
// SVG paths (24-grid, ~1.7 stroke) rather than pull in a package: it keeps the
// "custom Tailwind only" constraint, adds zero dependencies, and — importantly —
// reproduces the exact glyphs from the approved mockup, several of which are
// hand-tuned (the compass needle is filled, the bowl and book are custom) and
// would look different if drawn from stock Lucide.
//
// Usage: <Icon name="mail" className="w-[17px] h-[17px] text-terra" />
// Size and color ride on className. Stroke width defaults to 1.7 but a few
// glyphs override it to match the mockup.

const paths = {
  // navigation set
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" />
    </>
  ),
  book: (
    <>
      <path d="M6 4h9a2 2 0 0 1 2 2v14l-3.5-2L10 20V6a2 2 0 0 0-2-2H6z" />
      <path d="M6 4v14" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),

  // actions / affordances
  back: <path d="M15 5l-7 7 7 7" />,
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,

  // form / field icons
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  camera: (
    <>
      <path d="M6.8 6.2A2.3 2.3 0 0 1 5.2 7.2c-1 .1-1.9.3-2 1.4V18a2 2 0 0 0 2 2h13.5a2 2 0 0 0 2-2V9.6c0-1-.8-1.9-1.8-2a2.3 2.3 0 0 1-1.6-1L16 5.3a2.2 2.2 0 0 0-1.7-1 48 48 0 0 0-5.2 0 2.2 2.2 0 0 0-1.7 1z" />
      <circle cx="12" cy="12.8" r="3.5" />
    </>
  ),

  // recipe meta row
  serves: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  bowl: (
    <path d="M4 11h16M6 11a6 6 0 0 1 12 0M9 4v2M15 4v2M4 15h16v1a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
}

// A few glyphs read better at a slightly different weight — matches the mockup.
const strokeOverrides = { back: 1.9, edit: 1.8, plus: 2 }

export default function Icon({ name, className = '', strokeWidth }) {
  const inner = paths[name]
  if (!inner) return null
  const sw = strokeWidth ?? strokeOverrides[name] ?? 1.7
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {inner}
    </svg>
  )
}
