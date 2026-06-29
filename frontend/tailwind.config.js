/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
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
      maxWidth: {
        app: '430px',
      },
    },
  },
  plugins: [],
}
