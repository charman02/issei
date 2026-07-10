import CoverImage from './CoverImage'
import Plant from './Plant'
import { stageForRecipe, vitalityForRecipe } from '../lib/growth'

// The signature repeated unit: a recipe as a designed "card in a recipe box."
// - squared corners (heirloom, not app-rounded)
// - layered paper edge: hairline border + stacked warm shadow
// - cuisine as a cream stamped tag ON the photo, not a gray pill
// - Fraunces name, italic terra "kept by" byline
//
// variant: "row" (fixed-width, for horizontal scroll rows) | "grid" (fills its
// grid cell). onClick navigates to the recipe.
export default function RecipeCard({ recipe, onClick, variant = 'row' }) {
  const widthClass = variant === 'row' ? 'w-[168px] flex-none' : 'w-full'

  return (
    <button
      onClick={onClick}
      className={`${widthClass} text-left bg-card rounded-[5px] overflow-hidden border border-[#ECE0C9] shadow-[0_1px_0_#E3D3BA,0_8px_18px_rgba(90,60,30,0.14)] transition-transform active:scale-[0.98]`}
    >
      <div className="relative">
        <CoverImage
          url={recipe.cover_photo_url}
          size="sm"
          className="w-full h-[104px]"
        />
        {recipe.cuisine && (
          <span className="absolute top-[7px] left-[7px] text-[9px] font-sans font-semibold uppercase tracking-[0.12em] text-[#5C3A1E] bg-[rgba(247,238,221,0.94)] px-[7px] py-[3px] rounded-[2px]">
            {recipe.cuisine}
          </span>
        )}
        <span className="absolute top-[6px] right-[6px] bg-[rgba(247,238,221,0.94)] rounded-full p-[5px] shadow-[0_1px_3px_rgba(90,60,30,0.2)]">
          <Plant
            stage={stageForRecipe(recipe)}
            vitality={vitalityForRecipe(recipe)}
            size={38}
          />
        </span>
      </div>
      <div className="px-[11px] pt-[9px] pb-[11px]">
        <p className="font-serif font-bold text-[15px] leading-[1.15] text-ink">
          {recipe.name}
        </p>
        {recipe.author_full_name && (
          <p className="font-serif italic text-[11.5px] text-terra mt-[3px]">
            kept by {recipe.author_full_name}
          </p>
        )}
      </div>
    </button>
  )
}
