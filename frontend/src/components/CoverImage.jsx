// Renders a recipe cover photo, or a warm cream placeholder with the 一世 mark
// and a prompt when no photo is set. Sizing of the mark/text scales with `size`.
const sizes = {
  sm: { mark: 'text-2xl', text: 'text-[10px]' },
  md: { mark: 'text-4xl', text: 'text-xs' },
  lg: { mark: 'text-6xl', text: 'text-sm' },
}

export default function CoverImage({ url, size = 'md', className = '' }) {
  if (url) {
    return <img src={url} alt="" className={`object-cover ${className}`} />
  }

  const s = sizes[size] || sizes.md
  return (
    <div
      className={`bg-cream flex flex-col items-center justify-center text-center px-3 ${className}`}
    >
      <span className={`font-serif text-accent/70 leading-none ${s.mark}`}>一世</span>
      <span className={`text-accent/60 mt-1.5 leading-tight ${s.text}`}>
        Add a photo to bring this recipe to life
      </span>
    </div>
  )
}
