// Section header used across Home and Browse: an uppercase Inter label, a
// hairline rule filling the remaining width, and — optionally — a small terra
// `issei.` seal at the end. The seal marks the app's own curated sections
// (Home); cuisine/section rows on Browse omit it (seal={false}).
export default function SectionHeader({
  children,
  seal = true,
  className = '',
}) {
  return (
    <div className={`flex items-center gap-2.5 mb-3 ${className}`}>
      <span className="section-label whitespace-nowrap">{children}</span>
      <span className="h-px flex-1 bg-line" />
      {seal && <span className="font-serif text-xs text-terra/60">issei.</span>}
    </div>
  )
}
