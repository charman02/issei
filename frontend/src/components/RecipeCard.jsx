import CoverImage from './CoverImage'

// The signature repeated unit: a recipe as a designed "card in a recipe box."
// - squared corners (heirloom, not app-rounded)
// - layered paper edge: hairline border + stacked warm shadow
// - cuisine as a stamped tag ON the photo, not a gray pill
// - Fraunces name, italic terra "kept by" byline
//
// variant: "row" (fixed-width, for horizontal scroll rows) | "grid" (fills its
// grid cell). onClick navigates to the recipe.
export default function RecipeCard({ recipe, onClick, variant = 'row' }) {
  const widthClass = variant === 'row' ? 'w-44 flex-none' : 'w-full'

  return (
    <button
      onClick={onClick}
      className={`${widthClass} text-left bg-card rounded-[5px] overflow-hidden border border-[#ECE0C9] shadow-[0_1px_0_#E3D3BA,0_8px_18px_rgba(90,60,30,0.14)] transition-transform active:scale-[0.98]`}
    >
      <div className="relative">
        <CoverImage
          url={recipe.cover_photo_url}
          size="sm"
          className={`w-full ${variant === 'row' ? 'h-28' : 'h-32'}`}
        />
        {recipe.cuisine && (
          <span className="absolute top-2 left-2 text-[9.5px] font-sans font-semibold uppercase tracking-[0.14em] text-white px-2 py-[3px] rounded-[2px] border border-white/70 bg-[rgba(74,48,22,0.42)] backdrop-blur-[2px]">
            {recipe.cuisine}
          </span>
        )}
      </div>
      <div className="px-3 pt-2.5 pb-3">
        <p className="font-serif font-bold text-[15px] leading-tight text-ink truncate">
          {recipe.name}
        </p>
        {recipe.author_full_name && (
          <p className="font-serif italic text-xs text-terra mt-1 truncate">
            kept by {recipe.author_full_name}
          </p>
        )}
      </div>
    </button>
  )
}
