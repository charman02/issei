import { useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'

// Bottom nav — one line-icon family (see Icon.jsx). Active tab gets a soft terra
// seal disc behind the glyph; Add is a raised terra ring. Labels match the
// locked vocabulary: Home · Browse · Add · Garden · You.
const navItems = [
  { label: 'Home', path: '/', icon: 'home' },
  { label: 'Browse', path: '/browse', icon: 'compass' },
  { label: 'Add', path: '/add', icon: 'plus', center: true },
  { label: 'Garden', path: '/my-recipes', icon: 'book' },
  { label: 'You', path: '/profile', icon: 'user' },
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#F6EDDD] border-t border-line">
      <div className="max-w-app mx-auto flex justify-around items-center h-16 px-1.5">
        {navItems.map((item) => {
          const active = location.pathname === item.path

          if (item.center) {
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                aria-label={item.label}
                className="flex flex-col items-center -mt-[22px]"
              >
                <span className="flex items-center justify-center w-12 h-12 rounded-full bg-terra text-white border-[3px] border-paper shadow-[0_6px_16px_rgba(189,90,44,0.4)]">
                  <Icon
                    name={item.icon}
                    className="w-[22px] h-[22px]"
                    strokeWidth={2}
                  />
                </span>
                <span className="text-[9px] font-sans font-semibold tracking-[0.04em] text-terra mt-0.5">
                  {item.label}
                </span>
              </button>
            )
          }

          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              className={`flex flex-col items-center gap-0.5 ${active ? 'text-terra' : 'text-[#A8926F]'}`}
            >
              {/* active tab gets a soft terra seal disc behind the icon */}
              <span
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors ${active ? 'bg-terra/[0.14]' : ''}`}
              >
                <Icon name={item.icon} className="w-5 h-5" />
              </span>
              <span className="text-[9px] font-sans font-medium tracking-[0.03em]">
                {item.label}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
