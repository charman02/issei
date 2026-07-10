/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Heirloom palette
        paper: '#EFE4D2',
        card: '#FBF6EC',
        ink: '#3A2A1C',
        'ink-soft': '#6D5844',
        line: '#E3D3BA',
        terra: '#BD5A2C',
        saffron: '#D99A2B',
        herb: '#6F8A4D',
        plum: '#8A3D5A',
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
