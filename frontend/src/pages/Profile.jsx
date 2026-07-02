import { useNavigate } from 'react-router-dom'

export default function Profile() {
  const navigate = useNavigate()
  const user = JSON.parse(localStorage.getItem('issei_user') || '{}')

  function handleLogout() {
    localStorage.removeItem('issei_token')
    localStorage.removeItem('issei_user')
    navigate('/login')
  }

  return (
    <div className="px-4 pt-8">
      <h1 className="font-serif text-2xl font-bold text-ink mb-6">You</h1>

      <div className="bg-card rounded-xl p-5 shadow-warm mb-6">
        <div className="w-16 h-16 rounded-full bg-line/50 flex items-center justify-center mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-ink-soft">
            <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
          </svg>
        </div>
        {(user.first_name || user.last_name) && (
          <p className="font-serif text-lg text-ink mb-2">
            {user.first_name} {user.last_name}
          </p>
        )}
        <p className="text-sm text-ink-soft">Email</p>
        <p className="text-ink font-medium">{user.email || 'Unknown'}</p>
      </div>

      <button
        onClick={handleLogout}
        className="w-full py-3 rounded-lg border border-red-300 text-red-600 font-medium text-sm"
      >
        Log Out
      </button>
    </div>
  )
}
