/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        war: {
          bg: '#0f0a1e',
          card: '#1a1035',
          border: '#3d2a6e',
          accent: '#7c3aed',
          gold: '#f59e0b',
          red: '#ef4444',
          green: '#22c55e',
        },
      },
      fontFamily: {
        display: ['Georgia', 'serif'],
      },
      keyframes: {
        flip: {
          '0%': { transform: 'rotateY(0deg)' },
          '50%': { transform: 'rotateY(90deg)' },
          '100%': { transform: 'rotateY(0deg)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '25%': { transform: 'translateX(-8px)' },
          '75%': { transform: 'translateX(8px)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
      },
      animation: {
        flip: 'flip 0.5s ease-in-out',
        shake: 'shake 0.4s ease-in-out',
        float: 'float 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
