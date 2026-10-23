// Design tokens from the FindMyHobby design handoff (Modernist system): square corners, 2px ink rules, one red accent.
export const C = {
  bg: '#F3F2F2', surface: '#EAE9E9', ink: '#201E1D', white: '#FFFFFF',
  accent: '#EC3013', accent100: '#FFF2EF', accent400: '#FF9783', accent600: '#DD2B0F', accent700: '#AE1800', accent800: '#7C1405',
  n200: '#EAE7E7', n400: '#BAB6B6', n500: '#9B9797', n600: '#7D7979', n700: '#605D5D', n800: '#444141',
  illus: '#E9E6DF', duo: '#EAD9C6', divider: 'rgba(32,30,29,0.4)',
};

export const F = { regular: 'Archivo_400Regular', semi: 'Archivo_600SemiBold', bold: 'Archivo_800ExtraBold' };

export const GUTTER = 20;
/** iOS-like easing used across the design. */
export const EASE = [0.32, 0.72, 0, 1] as const;
