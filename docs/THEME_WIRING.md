# Theme Wiring Plan

Tailwind config:
- extend colors: primary #FF5233, logo #6C63FF, theme #6366F1
- font family from BRAND.md typography tokens

Page transition: src/App.tsx 300ms +20px y offset already present.
Card hover: use spring stiffness 300 damping 20.

Retire pulsing drop-shadow on hero title in AuthScreen.tsx.

prefers-reduced-motion honored globally.

Assets: public/brand/ must be copied into Docker build.
