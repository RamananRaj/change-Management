/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy:   '#1F4E79',
          blue:   '#2E75B6',
          orange: '#E8913A',
          light:  '#D6E4F0',
        },
        role: {
          po: '#2E75B6',   // Product Owner
          cm: '#E8913A',   // Change Manager
          pm: '#70AD47',   // Project Manager
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

