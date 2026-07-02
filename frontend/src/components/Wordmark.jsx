// The Issei brand mark: lowercase "issei." in Fraunces with a terra period.
// The wordmark IS the brand — no separate symbol. Size is controlled by the
// caller via `className` (font-size + any color overrides on the base text).
export default function Wordmark({ className = 'text-5xl', as: Tag = 'span' }) {
  return (
    <Tag
      className={`font-serif font-black tracking-[-0.03em] text-ink leading-none ${className}`}
    >
      issei<span className="text-terra">.</span>
    </Tag>
  )
}
