// Renders a recipe cover photo, or a warm cream placeholder with the 一世 mark
// when no photo is set. The prompt text shows at md/lg (form dropzone, detail
// hero) but is suppressed at sm — small cards read cleaner with just the mark,
// matching the mockup's Kitchen grid placeholder.
const sizes = {
  sm: { mark: 'text-2xl', text: 'text-[10px]', prompt: false },
  md: { mark: 'text-4xl', text: 'text-xs', prompt: true },
  lg: { mark: 'text-6xl', text: 'text-sm', prompt: true },
}

export default function CoverImage({ url, size = 'md', className = '' }) {
  if (url) {
    return <img src={url} alt="" className={`object-cover ${className}`} />
  }

  const s = sizes[size] || sizes.md
  return (
    <div
      className={`bg-paper flex flex-col items-center justify-center text-center px-3 ${className}`}
    >
      <span className={`font-serif text-terra/60 leading-none ${s.mark}`}>一世</span>
      {s.prompt && (
        <span className={`text-ink-soft/80 mt-1.5 leading-tight ${s.text}`}>
          A photo brings this dish to life
        </span>
      )}
    </div>
  )
}
