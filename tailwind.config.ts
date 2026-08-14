import type { Config } from 'tailwindcss';

/**
 * All colour values resolve to CSS variables defined in src/styles/tokens.css.
 * Nothing in the codebase may reference a raw hex value — swap tokens.css to rebrand.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          900: 'var(--navy-900)',
          800: 'var(--navy-800)',
        },
        steel: {
          600: 'var(--steel-600)',
          300: 'var(--steel-300)',
        },
        cream: { 100: 'var(--cream-100)' },
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        ink: {
          DEFAULT: 'var(--ink)',
          muted: 'var(--ink-muted)',
        },
        hairline: 'var(--hairline)',
        'on-target': 'var(--on-target)',
        behind: 'var(--behind)',
        attention: 'var(--attention)',
        blocked: 'var(--blocked)',
        input: 'var(--input)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        data: ['var(--font-data)'],
      },
      fontSize: {
        // The six-step scale from the design system: 30 / 22 / 17 / 15 / 13 / 11
        'scale-1': ['30px', { lineHeight: '1.15', letterSpacing: '-0.02em' }],
        'scale-2': ['22px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        'scale-3': ['17px', { lineHeight: '1.35' }],
        'scale-4': ['15px', { lineHeight: '1.45' }],
        'scale-5': ['13px', { lineHeight: '1.4' }],
        'scale-6': ['11px', { lineHeight: '1.35' }],
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '6px',
        lg: '10px',
      },
      maxWidth: { content: '1280px' },
      spacing: { rail: '56px' },
    },
  },
  plugins: [],
};

export default config;
