import type { Config } from 'tailwindcss'

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('background'),
        surface: token('surface'),
        raised: token('raised'),
        border: token('border'),
        foreground: token('foreground'),
        muted: token('muted'),
        accent: { DEFAULT: token('accent'), foreground: token('accent-foreground') },
        danger: token('danger'),
        success: token('success'),
        warning: token('warning'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: { '2xs': ['10px', '14px'], xs: ['11.5px', '16px'], sm: ['13px', '18px'] },
      borderRadius: { DEFAULT: '4px', md: '5px', lg: '6px' },
    },
  },
  plugins: [],
} satisfies Config
