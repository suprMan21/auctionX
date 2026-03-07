/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0a0a0f',
          800: '#13131a',
          700: '#1a1a24',
          600: '#252533',
          500: '#2d2d3d',
        },
        primary: {
          400: '#9333ea',
          500: '#7c3aed',
          600: '#6d28d9',
          700: '#5b21b6',
        },
        indigo: {
          500: '#6366f1',
        },
        accent: {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
        },
        success: {
          500: '#10b981',
          600: '#059669',
        },
        error: {
          500: '#ef4444',
          600: '#dc2626',
        },
        warning: {
          500: '#f59e0b',
          600: '#d97706',
        },
        unmentionables: {
          500: '#e11d48',
          400: '#fb7185',
          300: '#fda4af',
        },
        glass: {
          bg: 'rgba(255,255,255,0.04)',
          border: 'rgba(255,255,255,0.08)',
          'border-hover': 'rgba(255,255,255,0.14)',
        },
      },
      fontFamily: {
        sans: [
          'Plus Jakarta Sans',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },
      borderRadius: {
        'card': '20px',
        'btn': '12px',
        '2xl': '20px',
      },
      boxShadow: {
        'glow': '0 4px 24px rgba(124, 58, 237, 0.25)',
        'glow-intense': '0 8px 32px rgba(124, 58, 237, 0.35)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
