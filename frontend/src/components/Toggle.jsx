// The app's one switch.
//
// Extracted from `Profile.jsx` when #89 added a Notifications section to the SAME SCREEN and
// duplicated it byte-for-byte — two identical-looking switches rendered inches apart, where a later
// tweak to one would visibly diverge from the other. That's the whole reason this file exists.
//
// `hint` is a plain-language line under the label saying what flipping it actually changes. It was
// added because testing showed the bare labels ("Reduce motion") read as jargon and got skipped.
// Optional, so a self-evident toggle isn't padded with a redundant line.
//
// `items-start` rather than `items-center`: a two-line hint next to a fixed-height track looks
// centred-by-accident, and the notification hints are longer than the display ones.
export default function Toggle({ on, onChange, label, hint, disabled = false }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      disabled={disabled}
      className="flex items-start justify-between gap-4 w-full py-2.5 text-left disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block font-display font-bold text-[14px] text-ink">{label}</span>
        {hint && (
          <span className="block font-display italic text-[12px] text-ink-soft mt-0.5 leading-snug">
            {hint}
          </span>
        )}
      </span>
      <span
        className={`relative flex-none w-12 h-7 rounded-full border-2 border-ink transition-colors ${
          on ? 'bg-sage' : 'bg-cream'
        }`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-ink transition-all ${
            on ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}
