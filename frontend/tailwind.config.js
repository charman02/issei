/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // New heirloom palette
        paper: '#EFE4D2',
        card: '#FBF6EC',
        ink: '#3A2A1C',
        'ink-soft': '#6D5844',
        line: '#E3D3BA',
        terra: '#BD5A2C',
        saffron: '#D99A2B',
        herb: '#6F8A4D',
        plum: '#8A3D5A',
        // Legacy tokens — retained until Task 12 migration completes
        cream: '#F7F2EA',
        primary: '#1A1A1A',
        accent: '#8B5E3C',
        secondary: '#D4C5B0',
        surface: '#FFFFFF',
      },
      fontFamily: {
        serif: ['Playfair Display', 'serif'],
        sans: ['Inter', 'sans-serif'],
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
