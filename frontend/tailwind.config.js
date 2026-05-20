/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './*.{tsx,ts,jsx,js}',
    './components/**/*.{tsx,ts,jsx,js}',
    './pages/**/*.{tsx,ts,jsx,js}',
    './contexts/**/*.{tsx,ts,jsx,js}',
    './hooks/**/*.{tsx,ts,jsx,js}',
    './index.html',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

