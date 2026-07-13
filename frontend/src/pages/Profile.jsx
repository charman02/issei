import { useNavigate } from 'react-router-dom'

export default function Profile() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('issei_user') || '{}')

  function handleLogout() {
    localStorage.removeItem('issei_token')
    localStorage.removeItem('issei_user')
    navigate('/login')
  }

  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ')
  const monogram = (fullName || user.email || '?')
    .trim()
    .charAt(0)
    .toUpperCase()

  return (
    <div className="px-4 pt-6">
      <h1 className="font-serif font-black text-[28px] text-ink">You</h1>

      <div className="bg-card border border-line rounded-2xl p-5 mt-[18px] shadow-[0_2px_10px_rgba(120,80,40,0.08)]">
        <div className="w-14 h-14 rounded-full bg-terra text-white font-serif font-semibold text-2xl flex items-center justify-center mb-3.5">
          {monogram}
        </div>
        {fullName && (
          <p className="font-serif font-semibold text-[19px] text-ink">
            {fullName}
          </p>
        )}
        <p className="section-label mt-3">Email</p>
        <p className="font-sans text-[13.5px] text-ink mt-0.5">
          {user.email || 'Unknown'}
        </p>
      </div>

      <button
        onClick={handleLogout}
        className="w-full py-3 mt-[18px] rounded-[10px] border border-[#d99] text-[#b4472f] font-sans font-medium text-[13px]"
      >
        Log out
      </button>
    </div>
  )
}
