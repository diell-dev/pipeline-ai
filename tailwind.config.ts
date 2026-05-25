import type { Config } from 'tailwindcss'

/**
 * Pipeline AI — Tailwind Config
 *
 * ⚠️ Important context for anyone editing this file:
 *
 * The project uses Tailwind v4, which configures most things via the
 * `@theme` block in `src/app/globals.css` (the modern CSS-first config).
 * This `tailwind.config.ts` exists for two reasons:
 *
 *   1. **Compat surface** — some IDEs (VS Code Tailwind extension) and
 *      eslint-plugin-tailwindcss still expect to find a config file.
 *
 *   2. **Documentation surface** — it maps the design tokens declared in
 *      `assets/design-tokens.css` to Tailwind utility class names, so a
 *      developer reading this file can see at a glance what
 *      `bg-brand-primary`, `text-text-secondary`, `bg-status-success`
 *      resolve to.
 *
 * The CSS variables referenced below are defined in:
 *   - assets/design-tokens.css  (token plumbing; not yet @imported into globals.css)
 *   - src/app/globals.css       (currently the source of truth at runtime)
 *
 * Per-tenant theming:
 *   - --brand-primary / --brand-accent are overridden at runtime by
 *     src/components/providers/brand-provider.tsx via element.style on <html>.
 *   - All other tokens are constant across tenants.
 *
 * Phase A only ships this file as scaffolding. Phase B will swap globals.css
 * to @import assets/design-tokens.css and complete the migration.
 */

const config: Config = {
  content: [
    './src/**/*.{ts,tsx,js,jsx,mdx}',
  ],

  // Tailwind v4 reads `@theme` from CSS. The block below is mostly informational —
  // it documents the token → utility mapping. The runtime source of truth is the
  // `@theme inline` block in src/app/globals.css.
  theme: {
    extend: {
      colors: {
        // Brand — per-tenant, overridable
        'brand-primary': 'var(--brand-primary)',
        'brand-primary-fg': 'var(--brand-primary-fg)',
        'brand-accent':  'var(--brand-accent)',
        'brand-accent-fg': 'var(--brand-accent-fg)',

        // Surfaces
        'surface':           'var(--surface)',
        'surface-elevated':  'var(--surface-elevated)',
        'surface-muted':     'var(--surface-muted)',
        'surface-inverse':   'var(--surface-inverse)',

        // Text
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted':     'var(--text-muted)',
        'text-on-brand':  'var(--text-on-brand)',
        'text-inverse':   'var(--text-inverse)',

        // Borders
        'border-default': 'var(--border-default)',
        'border-strong':  'var(--border-strong)',
        'border-subtle':  'var(--border-subtle)',

        // Status — full set for bg / text / border via single key
        'status-success':   'var(--status-success-solid)',
        'status-warning':   'var(--status-warning-solid)',
        'status-danger':    'var(--status-danger-solid)',
        'status-info':      'var(--status-info-solid)',
      },

      borderRadius: {
        sm:   'var(--radius-sm)',
        md:   'var(--radius-md)',
        lg:   'var(--radius-lg)',
        xl:   'var(--radius-xl)',
        '2xl':'var(--radius-2xl)',
      },

      boxShadow: {
        sm:   'var(--shadow-sm)',
        md:   'var(--shadow-md)',
        lg:   'var(--shadow-lg)',
        xl:   'var(--shadow-xl)',

        // Aliases for elevation roles
        card:    'var(--elevation-card)',
        popover: 'var(--elevation-popover)',
        modal:   'var(--elevation-modal)',
      },

      fontFamily: {
        sans:    ['var(--font-body)'],
        heading: ['var(--font-heading)'],
        mono:    ['var(--font-mono)'],
      },

      transitionDuration: {
        instant: 'var(--duration-instant)',
        fast:    'var(--duration-fast)',
        normal:  'var(--duration-normal)',
        slow:    'var(--duration-slow)',
      },

      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        spring:   'var(--ease-spring)',
      },
    },
  },

  // Dark mode is class-based; .dark on <html> activates dark tokens.
  // (See assets/design-tokens.css for .dark + [data-theme='dark'] selectors.)
  darkMode: ['class', '[data-theme="dark"]'],

  plugins: [],
}

export default config
