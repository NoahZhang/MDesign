/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm paper background system (Anthropic-ish)
        paper: '#F5F4EF',
        panel: '#FAF9F5',
        sink: '#EFEDE5',
        // Beige thumbnails / folder cards
        beige: {
          DEFAULT: '#E9E5DA',
          light: '#EDEAE0',
          dark: '#E1DCCD',
        },
        // Coral / terracotta accent
        coral: {
          DEFAULT: '#D97757',
          muted: '#DCA48E',
          dark: '#C56242',
          tint: '#FBEEE8',
        },
        ink: {
          DEFAULT: '#1F1E1B',
          soft: '#3B3A35',
          muted: '#73726C',
          faint: '#A3A29B',
        },
        line: {
          DEFAULT: '#E6E3D9',
          soft: '#EFEDE6',
          strong: '#D9D5C8',
        },
        // file-type icon tints
        page: '#F6DED3',
        component: '#DCE3EE',
      },
      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'serif'],
        sans: [
          'Hanken Grotesk',
          'ui-sans-serif',
          'system-ui',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(31,30,27,0.04), 0 1px 1px rgba(31,30,27,0.03)',
        raised: '0 2px 8px rgba(31,30,27,0.06), 0 1px 2px rgba(31,30,27,0.04)',
        pop: '0 8px 30px rgba(31,30,27,0.12), 0 2px 8px rgba(31,30,27,0.08)',
      },
      borderRadius: {
        xl2: '14px',
      },
    },
  },
  plugins: [],
}
