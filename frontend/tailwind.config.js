/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Garden palette (R1) — green is the ambient lead; terra is the action accent.
        paper: '#F3EAD6',        // warm cream app background
        card: '#FCF8EE',         // surface
        ink: '#2E3A24',          // deep leaf — primary text
        'ink-soft': '#4A5540',   // green-gray — secondary text
        line: '#E3D9C4',         // hairline
        terra: '#B5502A',        // warm action accent
        saffron: '#D99A2B',      // vitality sparks
        herb: '#5C7A3F',         // (kept as alias of the lead green)
        plum: '#8A3D5A',         // the person / heritage accent
        soil: '#C9A277',         // garden ground
        // Semantic roles: green = grow/ambient, terra = do/act
        action: '#B5502A',       // = terra — buttons, links, active states
        growth: '#5C7A3F',       // lead green — plants, growth, garden ambient, eyebrows
        'growth-bright': '#7FA05A', // leaf highlights, plant accents
      },
      fontFamily: {
        serif: ['Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['Nunito Sans', 'system-ui', 'sans-serif'],
        hand: ['Caveat', 'cursive'],
      },
      boxShadow: {
        warm: '0 2px 10px rgba(120, 80, 40, 0.10)',
        'warm-lg': '0 12px 32px rgba(80, 50, 20, 0.18)',
      },
      maxWidth: {
        app: '430px',
      },
    },
  },
  plugins: [],
}
