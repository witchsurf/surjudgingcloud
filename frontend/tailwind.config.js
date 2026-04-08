/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Aptos"', '"Segoe UI"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        bebas: ['Impact', '"Arial Narrow Bold"', '"Helvetica Inserat"', '"Haettenschweiler"', 'sans-serif'],
        condensed: ['"Arial Narrow"', '"Roboto Condensed"', '"Helvetica Neue"', 'Arial', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
          DEFAULT: '#7c3aed',
        },
        secondary: {
          DEFAULT: '#a78bfa',
        },
        cta: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          DEFAULT: '#f97316',
        },
        accent: {
          DEFAULT: '#F97316', // Orange CTA
        },
        success: {
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
          800: '#166534',
        },
        danger: {
          600: '#dc2626',
          700: '#b91c1c',
        },
        warning: {
          500: '#f59e0b',
        }
      },
      boxShadow: {
        'block': '4px 4px 0px 0px rgba(76, 29, 149, 1)', // Hard shadow for text color
        'block-orange': '4px 4px 0px 0px rgba(194, 65, 12, 1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'score-flash': 'scoreFlash 0.6s ease-out',
        'score-toast': 'scoreToast 2s ease-in-out forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scoreFlash: {
          '0%': { backgroundColor: '#22c55e', transform: 'scale(1.15)' },
          '50%': { backgroundColor: '#4ade80', transform: 'scale(1.05)' },
          '100%': { backgroundColor: '', transform: 'scale(1)' },
        },
        scoreToast: {
          '0%': { opacity: '0', transform: 'translate(-50%, 12px)' },
          '15%': { opacity: '1', transform: 'translate(-50%, 0)' },
          '75%': { opacity: '1', transform: 'translate(-50%, 0)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -8px)' },
        },
      }
    },
  },
  plugins: [],
}
