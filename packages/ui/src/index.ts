export function cn(...inputs: Array<string | number | boolean | null | undefined>): string {
  return inputs
    .filter((val): val is string | number => typeof val === 'string' || typeof val === 'number')
    .map((val) => String(val).trim())
    .filter(Boolean)
    .join(' ');
}

export const designTokens = {
  colors: {
    brand: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      500: '#0284c7',
      600: '#0284c7',
      900: '#0c4a6e',
    },
    neutral: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      500: '#64748b',
      800: '#1e293b',
      900: '#0f172a',
    },
    semantic: {
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444',
      info: '#3b82f6',
    },
  },
  typography: {
    fontFamily: {
      sans: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    fontSize: {
      xs: '0.75rem',
      sm: '0.875rem',
      base: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
      '2xl': '1.5rem',
    },
  },
  spacing: {
    1: '0.25rem',
    2: '0.5rem',
    4: '1rem',
    6: '1.5rem',
    8: '2rem',
    12: '3rem',
  },
  radii: {
    none: '0',
    sm: '0.125rem',
    md: '0.375rem',
    lg: '0.5rem',
    full: '9999px',
  },
} as const;
