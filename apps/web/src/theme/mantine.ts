import { createTheme, type CSSVariablesResolver, type MantineColorsTuple } from '@mantine/core';

// Mantine themed from the tokens in index.css (SPEC.md decision log, T29). Every value names a
// CSS variable, never a hex value, so docs/UI.md stays the one source of the colors.
const token = (name: string) => `var(--color-${name})`;

// Mantine reads ten shades of a color; a token has one.
const shades = (name: string): MantineColorsTuple =>
  Array.from({ length: 10 }, () => token(name)) as unknown as MantineColorsTuple;

// What the dark scheme reads from the dark palette: 0 text, 1 to 3 the quieter texts, 4 input
// borders, 5 hover, 6 input backgrounds, 7 to 9 surfaces.
const dark = [
  'text',
  'text-2',
  'text-3',
  'text-3',
  'border-strong',
  'raised',
  'inset',
  'panel',
  'bg',
  'bg',
].map(token) as unknown as MantineColorsTuple;

export const mantineTheme = createTheme({
  colors: {
    dark,
    you: shades('you'),
    up: shades('up'),
    down: shades('down'),
    supplier: shades('supplier'),
    model: shades('model'),
    code: shades('code'),
  },
  primaryColor: 'you',
  primaryShade: 6,
  white: token('text'),
  black: token('bg'),
  fontFamily: 'var(--font-sans)',
  fontFamilyMonospace: 'var(--font-mono)',
  headings: { fontFamily: 'var(--font-sans)' },
  // The body rule Mantine adds keeps Tailwind's line height (index.css).
  lineHeights: { md: '1.5' },
  radius: { sm: 'var(--radius-chip)', md: 'var(--radius-button)', lg: 'var(--radius-panel)' },
  defaultRadius: 'md',
  fontSmoothing: true,
});

const variables = {
  '--mantine-color-body': token('bg'),
  '--mantine-color-text': token('text'),
  '--mantine-color-dimmed': token('text-3'),
  '--mantine-color-placeholder': token('text-3'),
  '--mantine-color-default': token('inset'),
  '--mantine-color-default-hover': token('raised'),
  '--mantine-color-default-color': token('text'),
  '--mantine-color-default-border': token('border-strong'),
  '--mantine-color-anchor': token('you'),
  '--mantine-color-error': token('text-2'),
};

// The app is dark only (index.css), so both schemes resolve the same.
export const mantineVariables: CSSVariablesResolver = () => ({
  variables: {},
  light: variables,
  dark: variables,
});
