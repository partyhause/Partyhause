/**
 * PartyHause Design System
 * Follows docs/BRAND.md (sections 4 and 12.1) and docs/BRAND.md section 12 for
 * the concept grid. All frontend components should import and use these
 * tokens. New UI may also use NativeWind classes (tailwind.config.js), which
 * carries the same palette.
 */

import { Platform } from 'react-native';

/**
 * Spacing Scale (4px base)
 * Use these values for all margins, paddings, and gaps
 */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
} as const;

/**
 * Border Radius Scale
 */
export const BORDER_RADIUS = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

/**
 * Color Palette
 * Values from docs/BRAND.md sections 4 and 12.1, solved for contrast targets
 * rather than picked by eye. The rule that matters: #FF5233 is the brand
 * colour, not a button colour. White on it measures 3.23:1 and AA needs 4.5:1,
 * so the anchor is split by role: `main` is the AA-passing fill that carries a
 * white label, `light` is the decorative brand tone, `dark` is the deep text
 * tone. The light and decorative tones do not meet AA for body-size text and
 * are marked; do not put readable text on them.
 */
export const COLORS = {
  primary: {
    main: '#C02A16',    // coral-700, 5.86:1 with white. Solid fill under a white label
    light: '#FF5233',   // coral-500 brand anchor, 3.23:1. Icons, decorative fills, large text
    dark: '#972317',    // coral-800, 8.18:1
    contrast: '#FFFFFF',
  },
  magenta: {
    main: '#B62066',    // magenta-700, 6.20:1 with white
    light: '#EC4699',   // magenta-500, 3.56:1. Decorative
    dark: '#901D51',    // magenta-800, 8.47:1
    contrast: '#FFFFFF',
  },
  // docs/BRAND.md s12.1, the concept palette. cream is the surface family
  // (page background, warm cards). teal is the cool accent, category and
  // surface colour, never a status colour. periwinkle is the evening accent;
  // text-bearing surfaces use 500 or darker.
  cream: {
    50: '#FAF8F5',
    100: '#F5F1EA',
    200: '#EBE3D6',
    300: '#DCCEB7',
    400: '#CDBA98',
    500: '#BDA375',
    600: '#AE8E56',
    700: '#917546',
    800: '#755F38',
    900: '#604E2E',
    950: '#372D1B',
  },
  teal: {
    50: '#F4FBFA',
    100: '#E8F7F5',
    200: '#D2EFEA',
    300: '#B0E3DB',
    400: '#8ED7CB',
    500: '#68CABA',
    600: '#46BEAA',
    700: '#389F8D',   // 3.22:1 with white. Decorative fills, large text
    800: '#2D8072',   // 4.73:1 with white, AA. The concept leaderboard surface, corrected
    900: '#256A5E',
    950: '#153C36',
  },
  periwinkle: {
    50: '#F1F0FF',
    100: '#E2E0FF',
    200: '#C6C2FF',
    300: '#9B94FF',
    400: '#7066FF',   // the logo house colour's step, 4.17:1 on white. Decorative and large text
    500: '#4133FF',   // 6.68:1 with white
    600: '#1605FF',
    700: '#0E00D6',   // 10.55:1 with white
    800: '#0C00AD',
    900: '#0A008F',
    950: '#050052',
  },
  success: {
    main: '#0B835B',    // 4.76:1 with white
    light: '#10BC83',   // hue 160, decorative tint, 2.46:1
    dark: '#096748',    // hue 160, 6.90:1
    contrast: '#FFFFFF',
  },
  error: {
    main: '#E12D33',    // hue 358, clearly separated from coral at hue 9. 4.54:1 with white
    light: '#E96367',   // hue 358, 3.26:1. Decorative
    dark: '#98161A',    // hue 358, 8.52:1
    contrast: '#FFFFFF',
  },
  warning: {
    main: '#A26907',    // 4.61:1 with white
    light: '#F6AA28',   // hue 38, decorative tint, 1.96:1
    dark: '#7A4F05',    // hue 38, 7.12:1
    contrast: '#FFFFFF',
  },
  neutral: {
    0: '#FFFFFF',
    50: '#FBFAF9',
    100: '#F6F4F3',
    200: '#EBE7E5',
    300: '#D8D2CF',
    400: '#ABA09B',   // 2.55:1. Disabled controls only, never readable text
    500: '#847771',   // 4.32:1. Placeholder only, not readable text
    600: '#6A5E58',   // 6.26:1 on white, 5.90:1 on cream-50
    700: '#514743',   // 9.0:1 body text
    800: '#39312D',   // headings
    900: '#26201D',   // 16.07:1 primary text. Logo body
    950: '#181311',   // inverse surface, 18.42:1 with white
  },
  text: {
    primary: '#26201D',      // neutral-900, 16.07:1 on white, 15.16:1 on cream-50
    secondary: '#6A5E58',    // neutral-600, 6.26:1 on white, 5.90:1 on cream-50
    tertiary: '#796D67',     // hsl(20 8% 44%), 5.00:1 on white, 4.72:1 on cream-50
    disabled: '#ABA09B',     // neutral-400
    onDark: '#FBFAF9',       // neutral-50
    inverse: '#FFFFFF',
  },
  background: {
    primary: '#FFFFFF',
    secondary: '#FAF8F5',    // cream-50, the page background
    tertiary: '#F5F1EA',     // cream-100, inset surfaces
    dark: '#181311',         // neutral-950
  },
} as const;

/**
 * Legacy Colors for compatibility
 * @deprecated Use COLORS instead
 */
export const Colors = {
  light: {
    text: COLORS.text.primary,
    background: COLORS.background.primary,
    tint: COLORS.primary.main,
    icon: COLORS.text.tertiary,
    tabIconDefault: COLORS.text.tertiary,
    tabIconSelected: COLORS.primary.main,
  },
  dark: {
    text: COLORS.text.onDark,
    background: COLORS.background.dark,
    tint: COLORS.text.onDark,
    icon: COLORS.neutral[400],
    tabIconDefault: COLORS.neutral[400],
    tabIconSelected: COLORS.text.onDark,
  },
};

/**
 * Typography Scale
 * Font sizes, weights, and line heights
 */
export const TYPOGRAPHY = {
  h1: {
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  h2: {
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  h3: {
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  h4: {
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 26,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24, // 1.5 line height
  },
  bodyBold: {
    fontSize: 16,
    fontWeight: '700' as const,
    lineHeight: 24,
  },
  small: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 21, // 1.5 line height
  },
  smallBold: {
    fontSize: 14,
    fontWeight: '700' as const,
    lineHeight: 21,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 18, // 1.5 line height
  },
  captionBold: {
    fontSize: 12,
    fontWeight: '700' as const,
    lineHeight: 18,
  },
} as const;

/**
 * Font Weights
 * Only use regular and bold
 */
export const FONT_WEIGHTS = {
  regular: '400',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Line Heights
 */
export const LINE_HEIGHTS = {
  tight: 1.2,     // Headings only
  normal: 1.5,    // Body text (default)
  relaxed: 1.6,   // Long-form content
} as const;

/**
 * Icon Sizes
 */
export const ICON_SIZES = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

/**
 * Shadow Styles
 * Use sparingly - only when creating depth is necessary
 */
export const SHADOWS = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

/**
 * Component Dimensions
 */
export const DIMENSIONS = {
  buttonHeight: 48,
  inputHeight: 48,
  iconButtonSize: 40,
  touchTargetSize: 44,
} as const;

/**
 * Font Families
 */
export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
