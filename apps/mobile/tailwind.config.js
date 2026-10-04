/** @type {import('tailwindcss').Config} */

// NativeWind (Tailwind CSS for React Native) for the mobile app, installed
// 2026-09-30. The palette is the same one the web app uses: docs/BRAND.md
// sections 4 and 12.1. Values are literal hex here, not hsl(var(--x)): the web
// resolves its scales through CSS variables in src/index.css :root, and the
// mobile bundle has no equivalent :root stylesheet, so literal values are the
// robust form on this side. docs/BRAND.md is the single source of truth for
// the values; a change there is a two-site change (src/index.css and here).
//
// Gradients are deliberately absent: NativeWind's background-image support
// does not cover every component the app renders, and expo-linear-gradient is
// already a dependency for gradient surfaces.

module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        coral: {
          50: "#FFF2F0",
          100: "#FFE5E0",
          200: "#FFCCC2",
          300: "#FFA694",
          400: "#FF7D66",
          500: "#FF5233",
          600: "#EA361A",
          700: "#C02A16",
          800: "#972317",
          900: "#782117",
          950: "#46110B",
        },
        magenta: {
          50: "#FFF0F7",
          100: "#FFE0F0",
          200: "#FEC3E0",
          300: "#FB9DCC",
          400: "#F471B3",
          500: "#EC4699",
          600: "#DF267F",
          700: "#B62066",
          800: "#901D51",
          900: "#741B43",
          950: "#440E26",
        },
        cream: {
          50: "#FAF8F5",
          100: "#F5F1EA",
          200: "#EBE3D6",
          300: "#DCCEB7",
          400: "#CDBA98",
          500: "#BDA375",
          600: "#AE8E56",
          700: "#917546",
          800: "#755F38",
          900: "#604E2E",
          950: "#372D1B",
        },
        teal: {
          50: "#F4FBFA",
          100: "#E8F7F5",
          200: "#D2EFEA",
          300: "#B0E3DB",
          400: "#8ED7CB",
          500: "#68CABA",
          600: "#46BEAA",
          700: "#389F8D",
          800: "#2D8072",
          900: "#256A5E",
          950: "#153C36",
        },
        periwinkle: {
          50: "#F1F0FF",
          100: "#E2E0FF",
          200: "#C6C2FF",
          300: "#9B94FF",
          400: "#7066FF",
          500: "#4133FF",
          600: "#1605FF",
          700: "#0E00D6",
          800: "#0C00AD",
          900: "#0A008F",
          950: "#050052",
        },
        neutral: {
          0: "#FFFFFF",
          50: "#FBFAF9",
          100: "#F6F4F3",
          200: "#EBE7E5",
          300: "#D8D2CF",
          400: "#ABA09B",
          500: "#847771",
          600: "#6A5E58",
          700: "#514743",
          800: "#39312D",
          900: "#26201D",
          950: "#181311",
        },
      },
    },
  },
  plugins: [],
};
