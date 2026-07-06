// The Issei brand mark: lowercase "issei." in Fraunces with a terra period.
// The wordmark IS the brand — no separate symbol. Size is controlled by the
// caller via `className` (font-size + any color overrides on the base text).
//
// `muted` renders the faded-terra watermark variant used on empty-photo
// surfaces (recipe cards / detail hero) in place of a cover image — the whole
// mark in low-opacity terra with a slightly stronger period, so the brand,
// not a kanji glyph, fills the empty state.
export default function Wordmark({ className = 'text-5xl', as: Tag = 'span', muted = false }) {
  if (muted) {
    return (
      <Tag className={`font-serif font-black tracking-[-0.03em] text-terra/40 leading-none ${className}`}>
        issei<span className="text-terra/55">.</span>
      </Tag>
    )
  }
  return (
    <Tag
      className={`font-serif font-black tracking-[-0.03em] text-ink leading-none ${className}`}
    >
      issei<span className="text-terra">.</span>
    </Tag>
  )
}
