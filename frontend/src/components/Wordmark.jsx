// The Issei brand mark: the word "issei", hand-lettered (no icon, no period) —
// per the visual-identity spec §1. Size is controlled by the caller via
// `className`. `muted` renders the faded variant used on empty-photo surfaces
// (recipe cards / detail hero) in place of a cover image.
export default function Wordmark({ className = 'text-5xl', as: Tag = 'span', muted = false }) {
  const base = 'font-hand leading-none'
  if (muted) {
    return <Tag className={`${base} text-terra/40 ${className}`}>issei</Tag>
  }
  return <Tag className={`${base} text-ink ${className}`}>issei</Tag>
}
