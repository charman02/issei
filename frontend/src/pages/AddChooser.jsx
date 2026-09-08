import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'

// The + tab now forks two creation acts. Sharing a meal is the LIGHT everyday act
// (a photo + a name, seconds) and is offered first + larger; keeping a recipe is
// the deliberate, rarer one. Framing the order this way is the nudge: the app
// wants you posting what you cooked more often than formally logging recipes.
export default function AddChooser() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-cream px-[18px] pt-5">
      <h1 className="font-display font-black text-[30px] text-ink leading-tight">
        What are you adding?
      </h1>
      <p className="font-display italic text-[15px] text-ink-soft mt-2 mb-6">
        Share a meal in seconds, or write down a recipe to keep.
      </p>

      {/* Share a meal — the primary, light act. Peach + camera. */}
      <button
        onClick={() => navigate('/add/meal')}
        className="flex w-full items-center gap-3.5 text-left sticker sticker-press bg-peach p-4 mb-4"
      >
        <span className="flex-none flex items-center justify-center w-12 h-12 rounded-full bg-cream border-2 border-ink shadow-[0_3px_0_#2E3A24] text-ink rotate-[-6deg]">
          <Icon name="camera" className="w-6 h-6" />
        </span>
        <span className="min-w-0">
          <span className="font-display font-black text-[18px] text-ink">
            Share a meal
          </span>
          <span className="block font-display text-[13px] text-ink-soft mt-0.5">
            A photo and the dish name — that&rsquo;s it. Your friends see what you made.
          </span>
        </span>
      </button>

      {/* Write a recipe — the deliberate act, demoted below but still a full card.
          Called "Write", not "Keep": "Keep" now means bookmarking SOMEONE ELSE'S recipe
          (#57), and one verb for both acts had people reading this as "make my own copy"
          — which is the removed Remix model reached by wording. Three verbs, three acts:
          Share a meal · Write a recipe · Keep (someone else's). */}
      <button
        onClick={() => navigate('/add/recipe')}
        className="flex w-full items-center gap-3.5 text-left sticker sticker-press bg-card p-4"
      >
        <span className="flex-none flex items-center justify-center w-12 h-12 rounded-[14px] bg-sage border-2 border-ink shadow-[0_3px_0_#2E3A24] text-ink rotate-[6deg]">
          <Icon name="edit" className="w-6 h-6" />
        </span>
        <span className="min-w-0">
          <span className="font-display font-black text-[18px] text-ink">
            Write a recipe
          </span>
          <span className="block font-display text-[13px] text-ink-soft mt-0.5">
            Write down a dish the way it&rsquo;s really made — to cook again or hand on.
          </span>
        </span>
      </button>
    </div>
  )
}
