import { useLocation, useNavigate } from 'react-router-dom'

// Consistent line-icon set (stroke 1.6, 24-grid) so the nav reads as one family.
const navItems = [
  {
    label: 'Home',
    path: '/',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
        <path d="M4 11.5 12 4l8 7.5" />
        <path d="M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9" />
      </svg>
    ),
  },
  {
    label: 'Browse',
    path: '/browse',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    label: 'Add',
    path: '/add',
    center: true,
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-6 h-6">
        <path d="M12 5v14M5 12h14" />
      </svg>
    ),
  },
  {
    label: 'Kitchen',
    path: '/my-recipes',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
        <path d="M6 4h9a2 2 0 0 1 2 2v14l-3.5-2L10 20V6a2 2 0 0 0-2-2H6z" />
        <path d="M6 4v14" />
      </svg>
    ),
  },
  {
    label: 'You',
    path: '/profile',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-[22px] h-[22px]">
        <circle cx="12" cy="8" r="3.4" />
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      </svg>
    ),
  },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#F6EDDD] border-t border-line">
      <div className="max-w-app mx-auto flex justify-around items-center h-[68px] px-1.5">
        {navItems.map((item) => {
          const active = location.pathname === item.path

          if (item.center) {
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                aria-label={item.label}
                className="flex flex-col items-center -mt-6"
              >
                <span className="flex items-center justify-center w-[52px] h-[52px] rounded-full bg-terra text-white border-[3px] border-paper shadow-[0_8px_18px_rgba(189,90,44,0.4)]">
                  {item.icon}
                </span>
                <span className="text-[9.5px] font-sans font-semibold tracking-[0.04em] text-terra mt-1">
                  {item.label}
                </span>
              </button>
            )
          }

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 ${active ? 'text-terra' : 'text-ink-soft/60'}`}
            >
              {/* active tab gets a soft terra seal disc behind the icon */}
              <span className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${active ? 'bg-terra/[0.14]' : ''}`}>
                {item.icon}
              </span>
              <span className="text-[9.5px] font-sans font-medium tracking-[0.04em]">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
