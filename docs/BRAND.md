# PartyHause Brand Visual Identity

Version 1.1. Status: proposed, not yet wired into the app. Amended 2026-09-30 with section 12, the reference concept direction derived from three supplied mockups.

This document defines the visual identity for PartyHause: the logo, the colour system, typography, iconography, motion and the raster assets that ship with them. Every colour value here was computed and every contrast ratio was measured. Nothing in the tables below is asserted from memory.

The assets described here exist as real files in `public/brand/`. The application does not consume them yet. The migration is specified in section 10.

---

## 1. Why this document exists

An audit of the shipping codebase found no single identity to document. It found three of them, layered in the same stylesheet, plus a logo that contradicts all three.

| Finding | Evidence |
|---|---|
| Three competing "brand" colours | `--primary` is `#FF5233` coral. The logo house is `#6C63FF` periwinkle. The PWA `theme_color` is `#6366F1` indigo. None of them match. |
| Three palettes in one `:root` | A "Liquid Metal" chrome and iridescent set, the coral-orange shadcn scale, and a "PartyHause Solid Color System" of burnt orange and dark slate. `src/index.css:22-115` |
| No logo component | The de facto lockup is the string `PartyHause` flanked by two lucide `Sparkles` icons. `src/components/AuthScreen.tsx:209-225` |
| The share card was a stand-in | `public/placeholder.svg` served as both `og:image` and `twitter:image`: the name misspelled, set in Arial Bold on a flat periwinkle field, and in a format no social crawler renders. Resolved 2026-09-08. The tags point at `social-card-1200x630.png` and the file is deleted. |
| No brand typeface | Zero `@font-face`, zero font `<link>`, no `fontFamily` in Tailwind. Everything renders in the OS system UI font. Inter is loaded only inside HTML email templates. |
| Logo palette orphaned | `public/partyhause-icon.svg` uses seven colours, none of which appear anywhere in the app's CSS. |
| Non-monotonic colour scale | `--orange-500` and `--orange-600` sit at hue 9 and 349. `--orange-700` returns to hue 17. The 600 step is pinker than the 700 step. `src/index.css:43-52` |
| Ten broken tokens | `--shadow-primary`, `--glow-primary`, `--glow-secondary`, `--glow-subtle`, `--electric-cyan`, `--accent-orange`, `--success-500`, `--success-400`, `--text-tertiary`, `--transition-normal` are referenced but never defined. `.glow-primary`, `.focus-cosmic`, `.status-online` and `.cosmic-spinner` therefore do nothing. |
| Error is indistinguishable from brand | `--error-red` and `--orange-500` are both `9 100% 60%`. The same colour signals "primary action" and "destructive". |
| Dark mode declared, never built | `darkMode: ["class"]` at `tailwind.config.ts:4`, but no `.dark` block exists anywhere. |

Three decisions were taken to resolve this. The canonical name is **PartyHause**. The anchor colour is **coral `#FF5233`**, because it is what the UI actually paints today and it carries the lowest migration cost. The identity is **corrected rather than merely recorded**.

---

## 2. Brand idea

**Raise the roof.**

PartyHause is two words fused: the party and the house. The name already carries the idea. The mark makes it literal by lifting the roof off the building, hinged on one side, with confetti escaping through the gap.

This works because it is an idiom people already know. "Raising the roof" and "blowing the roof off" both mean a gathering got good. The mark is a house that is visibly having a better time than a house normally has.

The tone that follows: warm, energetic, competent. People use this product to manage guest lists, split costs and track RSVPs. It should feel like a good night out that someone actually organised, not like chaos.

The existing tagline is `Plan. Party. Perfect.` (`src/components/AuthScreen.tsx:364`). It is retained.

---

## 3. The logo

### 3.1 The mark

A house drawn as two solid shapes plus three confetti dots. The roof is a triangle rotated 5.5 degrees counter-clockwise about its own centroid. It stays in near contact with the body at the left, at a 0.39 unit gap, and lifts away at the right, at a 3.26 unit gap. The body is a rounded rectangle with an arched doorway punched out as true negative space using `fill-rule="evenodd"`, so the background shows through.

The hinge is the whole design. An evenly floating roof reads as a misalignment. A roof that pivots on one corner reads as intent.

Geometry, on a 48 by 48 grid:

| Element | Specification |
|---|---|
| Roof triangle, before rotation | Apex `(24, 3.9)`, left `(9, 19.3)`, right `(39, 19.3)` |
| Rotation | `-5.5°` about centroid `(24, 14.167)` |
| Roof corner softening | `stroke-linejoin="round"`, `stroke-width="1.8"`, stroke colour equal to fill |
| Roof, after rotation | Apex `(23.016, 3.947)`, left `(9.561, 20.714)`, right `(39.423, 17.839)` |
| Body | `x=12.5`, `y=22`, `w=23`, `h=20`, `rx=2` |
| Doorway | Width `7`, centred, arch springs at `y=31.4`, radius `3.5`, runs to the body's lower edge |
| Confetti | `(41.0, 10.2) r=1.9`, `(36.8, 4.4) r=1.25`, `(7.4, 12.4) r=1.55` |
| Optical bounds | Top `3.05`, bottom `42.0` |

Default colours: roof `coral-500 #FF5233`, body `neutral-900 #26201D`, confetti `magenta-500 #EC4699` and `coral-400 #FF7D66`.

The doorway is what makes the mark legible. Eight variants were rendered and compared; without the doorway the silhouette reads as a black box wearing a hat, and with a wider gap the roof reads as a paper aeroplane. Both failure modes were rejected on inspection, not on theory.

### 3.2 The wordmark

Set in **Outfit Bold (700)**, tracked `-14/1000 em` for optical tightness at logo scale.

The wordmark ships as outlined vector paths. It carries no font dependency and will render identically on any machine. Glyph positioning came from HarfBuzz shaping with kerning enabled, so the pair fitting is the font designer's, not hand-eyeballed.

Cap height is 676 units per 1000 em. All lockup measurements below are expressed against cap height, not against the bounding box, because `PartyHause` contains a descender in the `y`.

### 3.3 Lockups

**Horizontal.** The primary lockup. Mark at full height, wordmark cap height `22` units, gap `13` units. The wordmark's cap band is centred on the mark's optical centre at `y=22.525`, not on its geometric box.

**Stacked.** For square and narrow spaces. Wordmark cap height `20`, gap `13` below the mark's baseline, both centred on a shared vertical axis.

**Inverse.** Body and wordmark in white, roof stays coral, confetti stays in brand colours. For dark surfaces.

**Mono.** Every element inherits `currentColor`. For single-colour reproduction, embossing, and cases where the mark must adopt surrounding text colour.

### 3.4 Clear space

Minimum clear space on all four sides equals the width of the mark's doorway, which is `7` units on the 48 grid, or **14.6 percent of the mark's height**. Nothing may enter this zone, including background imagery with detail.

### 3.5 Minimum sizes

| Asset | Minimum | Reason |
|---|---|---|
| Mark, screen | 16 px | Verified legible at 16 px. Below this the doorway closes up. |
| Mark, print | 6 mm | |
| Horizontal lockup, screen | 120 px wide | Below this the wordmark's counters fill in. |
| Stacked lockup, screen | 64 px wide | |
| Favicon | Use `partyhause-favicon.svg` | It drops the confetti and tightens the mark for small-size rendering. Do not downscale the full mark instead. |

### 3.6 Misuse

Do not recolour the mark outside the defined variants. Do not add a stroke, drop shadow or bevel. Do not rotate the assembled mark; the tilt is already built into the roof and rotating the whole thing destroys the hinge. Do not separate the roof from the body beyond the specified gap. Do not set the wordmark in any face other than Outfit Bold. Do not use `Sparkles` icons as logo flanks; that pattern is retired. Do not use the emoji `🎉` as a brand mark.

---

## 4. Colour

### 4.1 The anchor and its critical constraint

`#FF5233` is the brand colour. It is not a button colour.

White text on `#FF5233` measures **3.23:1**. WCAG 2.1 AA requires 4.5:1 for normal-size text. The application currently ships this exact combination, since `--primary` is `#FF5233` and `--primary-foreground` is white on every button. **That is a live accessibility defect, not a theoretical one.**

The colour is therefore split by role. Each role below was solved for, not chosen by eye.

| Role | Token | Value | Measured | Verdict |
|---|---|---|---|---|
| Brand, logo, decorative fills, large display text | `coral-500` | `#FF5233` | 3.23:1 on white | Passes for large text and non-text UI only |
| Hover fill, focus ring | `coral-600` | `#EA361A` | 4.17:1 on white | Passes non-text 1.4.11 on all surfaces |
| Solid button fill carrying a white label | `coral-700` | `#C02A16` | 5.86:1 with white | Passes AA |
| Link and body text on white | `coral-800` | `#972317` | 8.18:1 on white | Passes AAA |

The single lightest coral that can legally carry white text at body size is `#E1311A`. Anything lighter fails.

### 4.2 Focus ring rule

A `coral-500` focus ring measures 3.23:1 on white, 3.10:1 on `neutral-50`, but **2.94:1 on `neutral-100` and 2.63:1 on `neutral-200`, both of which fail** WCAG 1.4.11.

The app's default background is a tinted surface. Therefore the focus ring is `coral-600 #EA361A`, which measures 4.17, 4.00, 3.80 and 3.39 respectively and passes on every defined surface.

### 4.3 Coral scale

| Step | HSL | Hex |
|---|---|---|
| 50 | `10 100% 97%` | `#FFF2F0` |
| 100 | `10 100% 94%` | `#FFE5E0` |
| 200 | `10 100% 88%` | `#FFCCC2` |
| 300 | `10 100% 79%` | `#FFA694` |
| 400 | `9 100% 70%` | `#FF7D66` |
| **500** | `9 100% 60%` | **`#FF5233`** |
| 600 | `8 83% 51%` | `#EA361A` |
| 700 | `7 79% 42%` | `#C02A16` |
| 800 | `6 74% 34%` | `#972317` |
| 900 | `6 68% 28%` | `#782117` |
| 950 | `6 72% 16%` | `#46110B` |

Hue drifts from 10 down to 6 as lightness falls. This is deliberate. Dark oranges read as muddy brown unless they shift toward red.

### 4.4 Magenta scale

The secondary. It exists because `from-orange-500 to-pink-500` already appears 14 times in the codebase and is the one genuinely consistent visual signal the audit found.

| Step | HSL | Hex |
|---|---|---|
| 50 | `330 100% 97%` | `#FFF0F7` |
| 100 | `330 100% 94%` | `#FFE0F0` |
| 200 | `330 96% 88%` | `#FEC3E0` |
| 300 | `330 92% 80%` | `#FB9DCC` |
| 400 | `330 86% 70%` | `#F471B3` |
| **500** | `330 81% 60%` | **`#EC4699`** |
| 600 | `331 74% 51%` | `#DF267F` |
| 700 | `332 70% 42%` | `#B62066` |
| 800 | `333 66% 34%` | `#901D51` |
| 900 | `333 62% 28%` | `#741B43` |
| 950 | `333 66% 16%` | `#440E26` |

White on `magenta-500` measures 3.56:1. The same rule applies: use `magenta-700` for text-bearing surfaces.

### 4.5 Neutral scale

Warm-tinted at hue 20 so it sits with coral instead of fighting it. A pure grey next to `#FF5233` reads blue.

| Step | HSL | Hex | Use |
|---|---|---|---|
| 0 | `0 0% 100%` | `#FFFFFF` | Cards, inputs |
| 50 | `20 20% 98%` | `#FBFAF9` | Page background |
| 100 | `20 16% 96%` | `#F6F4F3` | Subtle fill |
| 200 | `20 13% 91%` | `#EBE7E5` | Borders, dividers |
| 300 | `20 11% 83%` | `#D8D2CF` | Strong borders |
| 400 | `20 9% 64%` | `#ABA09B` | Disabled text |
| 500 | `20 8% 48%` | `#847771` | Placeholder |
| 600 | `20 9% 38%` | `#6A5E58` | Secondary text, 6.26:1 |
| 700 | `20 10% 29%` | `#514743` | Body text, 9.0:1 |
| 800 | `20 12% 20%` | `#39312D` | Headings |
| 900 | `20 14% 13%` | `#26201D` | Primary text, 16.07:1. Logo body. |
| 950 | `20 18% 8%` | `#181311` | Inverse surface, 18.42:1 with white |

`neutral-400` on white measures 2.55:1 and fails AA. It is reserved for disabled controls, which WCAG 1.4.3 exempts. Do not use it for readable text.

### 4.6 Support colours

Every value below was solved to the lightest tone that still passes 4.5:1 with white text, so each one works as both a fill and a text colour.

| Token | HSL | Hex | White on it |
|---|---|---|---|
| `success` | `160 84% 28%` | `#0B835B` | 4.76:1 AA |
| `warning` | `38 92% 33%` | `#A26907` | 4.61:1 AA |
| `danger` | `358 75% 53%` | `#E12D33` | 4.54:1 AA |
| `info` | `213 80% 49%` | `#1973E1` | 4.58:1 AA |

`danger` sits at hue 358, clearly separated from `coral-500` at hue 9. This resolves the current defect where destructive and primary are the identical colour.

Tinted surfaces for banners and alerts:

| Token | Hex | Text contrast on it |
|---|---|---|
| `success-surface` | `#ECFDF8` | 7.43:1 |
| `warning-surface` | `#FEF7EB` | 8.75:1 |
| `danger-surface` | `#FCEDEE` | 12.41:1 |
| `info-surface` | `#EDF4FD` | 12.05:1 |

### 4.7 The brand gradient

```css
linear-gradient(135deg, #FF5233 0%, #EC4699 100%);
```

Both endpoints sit at exactly `L=60%`. The gradient is iso-lightness, so it holds a constant perceived weight across its run and does not band or develop a dark middle. Approximate midpoint `#F33F60`.

Use it for the app icon, the social card, hero surfaces and celebration moments. Do not put body-size text on it. Do not use it for buttons; the varying background makes label contrast unverifiable.

---

## 5. Typography

The app currently loads no webfont at all. This section introduces one.

| Role | Face | Weights | Licence |
|---|---|---|---|
| Display, headings, the wordmark | **Outfit** | 500, 600, 700 | SIL Open Font Licence 1.1 |
| Body, UI, data | **Inter** | 400, 500, 600, 700 | SIL Open Font Licence 1.1 |

Outfit is a geometric sans with wide, open counters that hold their shape at large display sizes and in the logo. Inter is optimised for UI legibility at small sizes and is already loaded inside the HTML email templates at `src/lib/email.ts:114`, so adopting it for the app unifies email and product typography rather than adding a third face.

Both are variable, both are OFL, both can be self-hosted. Self-host them. Do not link to the Google Fonts CDN from the app, since that adds a third-party request on the critical path and a privacy consideration.

Recommended scale, based on the sizes the codebase already uses most:

| Token | Size / line height | Face | Use |
|---|---|---|---|
| `display-lg` | 60 / 1.05 | Outfit 700 | Landing hero |
| `display` | 44 / 1.1 | Outfit 700 | Page hero |
| `h1` | 32 / 1.2 | Outfit 600 | Screen title |
| `h2` | 24 / 1.25 | Outfit 600 | Section |
| `h3` | 20 / 1.3 | Outfit 600 | Card title |
| `body-lg` | 18 / 1.55 | Inter 400 | Lead paragraph |
| `body` | 16 / 1.55 | Inter 400 | Default |
| `body-sm` | 14 / 1.5 | Inter 400 | Dense UI. The most used size in the app, 214 occurrences. |
| `caption` | 12 / 1.4 | Inter 500 | Labels, metadata |
| `overline` | 12 / 1.4, `0.05em` tracking, uppercase | Inter 600 | Stat labels |

Display sizes take `-0.02em` tracking. Body sizes take none.

The current largest live heading is `text-6xl md:text-8xl lg:text-9xl` at `src/components/AuthScreen.tsx:211`, which reaches 128 px. That is oversized for the content and should come down to `display-lg`.

---

## 6. Iconography

The library is **lucide-react** (`package.json:75`). It stays. 103 distinct icons are already in use across 77 files. Replacing the set has no upside.

| Property | Value |
|---|---|
| Stroke width | 2 (lucide default) |
| Inline with text | 16 px |
| Header actions, buttons | 20 px |
| Feature tiles | 24 px |
| Empty states, hero | 32 to 48 px |
| Colour | Inherits `currentColor`. Never hardcode. |

Buttons already pin icons to 16 px via `[&_svg]:size-4` at `src/components/ui/button.tsx:8`. Keep that.

**Brand glyphs.** `PartyPopper` is the celebration mark, reserved for success and completion moments. `Sparkles` is retired from the logo lockup and is now available as an ordinary AI and suggestion glyph, which is how the rest of the product already uses it.

**Emoji.** The 11 event-template glyphs at `src/components/templates/EventTemplateSelection.tsx` and the invite-template glyphs at `src/types/invites.ts` are content, not identity. They stay. Emoji must never appear in chrome, navigation, or as a brand mark.

---

## 7. Motion

The existing motion tokens at `src/index.css:171-191` are well constructed and are retained unchanged.

| Token | Value |
|---|---|
| `--ease-fluid` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--ease-liquid` | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| `--ease-metallic` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| `--duration-fast` | 150 ms |
| `--duration-normal` | 300 ms |
| `--duration-slow` | 500 ms |

Standard patterns already in the codebase and worth keeping: page transitions at 300 ms with a 20 px y offset (`src/App.tsx:268-275`), card hover as a spring at stiffness 300 and damping 20 (`src/lib/animations.ts:23-25`), and list stagger at `index * 0.1`.

`prefers-reduced-motion` is already honoured globally at `src/index.css:232-241`. Keep it. Any new animation must fall inside that guard.

Logo animation: the mark may animate its roof, lifting on entry with a spring, then settling. The wordmark does not animate. The pulsing `drop-shadow` currently applied to the hero title at `src/components/AuthScreen.tsx:213-220` is retired.

---

## 8. Surfaces

| Level | Background | Border | Shadow |
|---|---|---|---|
| Page | `neutral-50` | none | none |
| Card | `neutral-0` | `1px neutral-200` | `0 1px 2px rgb(0 0 0 / 0.04)` |
| Raised card | `neutral-0` | `1px neutral-200` | `0 6px 16px rgb(0 0 0 / 0.08)` |
| Modal | `neutral-0` | none | `0 16px 48px rgb(0 0 0 / 0.16)` |
| Inverse | `neutral-950` | none | none |

Corner radius resolves from one token. Set `--radius: 0.75rem`.

Note a live bug this replaces: `tailwind.config.ts:76-80` overrides only `lg`, `md` and `sm`, so Tailwind's stock `xl` at `0.75rem` and the overridden `lg` at `0.75rem` render identically. `rounded-lg` and `rounded-xl` are currently the same size. The 14 hand-written CSS rules using raw pixel radii from 12 px to 24 px bypass the token entirely and should be removed.

Glassmorphism is used in only 9 places across the whole app while 8 unused `.glass-*` classes sit in the stylesheet. Keep `backdrop-blur` for overlays and sticky headers only. Delete the unused classes.

---

## 9. Assets produced

All paths relative to `public/brand/`.

### Vector

| File | Viewbox | Purpose |
|---|---|---|
| `partyhause-mark.svg` | 48×48 | Primary mark, full colour |
| `partyhause-mark-inverse.svg` | 48×48 | Mark for dark surfaces |
| `partyhause-mark-mono.svg` | 48×48 | Single colour via `currentColor` |
| `partyhause-wordmark.svg` | 370.97×64.69 | Wordmark, outlined paths |
| `partyhause-wordmark-inverse.svg` | 370.97×64.69 | White wordmark |
| `partyhause-lockup-horizontal.svg` | 231.03×48 | Primary lockup |
| `partyhause-lockup-inverse.svg` | 231.03×48 | Lockup for dark surfaces |
| `partyhause-lockup-mono.svg` | 231.03×48 | Single colour lockup |
| `partyhause-lockup-stacked.svg` | 154.57×82.07 | Stacked lockup |
| `partyhause-app-icon.svg` | 512×512 | Gradient app icon, 80 percent maskable safe zone |
| `partyhause-favicon.svg` | 32×32 | Favicon, confetti removed |
| `partyhause-social-card.svg` | 1200×630 | Open Graph and Twitter card |
| `shortcut-create.svg` | 96×96 | PWA shortcut, plus glyph |
| `shortcut-events.svg` | 96×96 | PWA shortcut, calendar glyph |

### Raster, in `public/brand/icons/`

`icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`, `apple-touch-icon-120x120.png`, `apple-touch-icon-152x152.png`, `apple-touch-icon-167x167.png`, `apple-touch-icon-180x180.png`, `shortcut-create.png`, `shortcut-events.png`, `badge.png`, `social-card-1200x630.png`.

`badge.png` is a white silhouette on transparency, which is what Android notification badges require. It is referenced by `public/sw.js:110` and is currently missing from `public/manifest.json`.

Alpha channels are deliberate, not incidental. The Apple touch icons, both `icon-*` and both `icon-maskable-*`, the two shortcut icons and the social card are all **opaque**, because iOS composites a transparent touch icon onto black and a maskable icon must fill its safe zone edge to edge. The three favicons keep transparency for their rounded corners, and `badge.png` keeps it because a notification badge is a silhouette. Preserve this distinction when regenerating.

---

## 10. Implementation

Partly implemented as of 2026-09-08. The landing page (`src/components/LandingPageCreative.tsx`) was rebuilt against this specification and is the reference for how the palette is meant to be applied; `index.html` carries the correct `theme-color` and social card. The rest of the app still runs on the legacy scales. Each paragraph below records its own state.

**Colour.** Replace `src/index.css:8-192` with the scales in section 4. Delete the Liquid Metal block at `:22-40` and the Solid Color System block at `:92-115`. Define the ten currently undefined variables listed in section 1, or delete the rules that reference them. Point `--primary` at `coral-500` for brand use but set button fills to `coral-700`, and set `--ring` to `coral-600`.

**Tailwind.** In `tailwind.config.ts`, rename the `orange` key at `:53-64` to `coral` so it stops shadowing Tailwind's built-in orange, and add `magenta`, `neutral` and the support colours. Add the `fontFamily` block, which does not currently exist.

**Type.** Self-host Outfit and Inter, add `@font-face` rules, and set the Tailwind `fontFamily` tokens.

**Icons and manifest.** `theme-color` is done: `index.html` and the generated manifest both carry `#FF5233`. `#6366F1` no longer appears in the build. Still outstanding: copy `public/brand/icons/*` over `public/icons/*` and update `index.html:5-13` to point at the new favicon set. Add `badge.png` to the manifest icon list. Either create `public/screenshots/` or remove the three entries at `public/manifest.json:46-61`, which currently point at files that do not exist.

**Social.** Done, 2026-09-08. `og:image` and `twitter:image` now point at `https://partyhause.com/brand/icons/social-card-1200x630.png`, with `og:image:width`, `:height`, `:type` and `:alt` declared and `og:url` and `og:site_name` added. Two things had been wrong, not one: the previous target was `/placeholder.svg`, and no major crawler renders SVG as a share image, so the card had never appeared on any platform; and a root-relative path is not reliably resolved by crawlers that fetch the tag without page context, so the URL is now absolute. `placeholder.svg` has been deleted.

**Retire.** `public/placeholder.svg` was deleted on 2026-09-08 along with its three references (`index.html`, `vite.config.ts` includeAssets, and the hand-written `public/sw.js`, which was itself deleted after being confirmed unreachable: `vite-plugin-pwa` in `generateSW` mode overwrites `dist/sw.js` at build, so that file was never served). `public/partyhause-icon.svg` remains, rendered at `src/components/PWAInstallBanner.tsx:156`.

**Logo in the app.** Partly done, 2026-09-08. `src/components/BrandMark.tsx` renders the committed mark with an `onLight` / `onDark` tone, and the landing page uses it in the header and the footer instead of a text-only wordmark. Path data is byte-identical to `public/brand/partyhause-mark.svg`, so the component and the assets cannot drift. Still outstanding: replace the `Sparkles` lockups at `src/components/AuthScreen.tsx:209-225` and `:356-365`. The dashboard headers that pass `title="PartyHause"` into `PageShell` should render the mark alongside the text.

Two duplicate manifests currently exist and disagree. `vite.config.ts:9-42` generates one while `index.html:13` hard-links `/manifest.json`. Resolve to a single source before shipping icon changes, or the icon set that wins will depend on injection order.

---

## 11. Open items

Name spelling is resolved. All 208 occurrences were corrected across 54 files, and the misspelled icon filename was renamed in both `public/` and `apps/mobile/public/`. Typecheck and the full test suite were clean afterwards. Re-verified 2026-09-08: a case-insensitive search for the name without its trailing `e` returns nothing anywhere in the repository, including filenames, binary assets and both lockfiles.

The X (Twitter) handle is resolved, and the answer is that **no X handle belongs to PartyHause**. Verified 2026-08-30: both the correct spelling and the misspelling are held by unrelated accounts with single-digit follower counts. The `twitter:site` tag is therefore absent from `index.html` rather than pointed at a stranger, and the comment there says so without naming either account. Cards still render, because `summary_large_image` does not require the tag.

Several candidate handles were free at the time of checking. Register one and restore the tag. Note that the marketing and setup documents still list a social handle in about a dozen places; those are aspirational copy, not shipped metadata, and should be corrected when a handle is actually secured. Email addresses on `@partyhause.com` are unaffected: that domain is owned and its use is correct throughout.

Separately, seven lines in the archived Vercel and mobile documentation contradicted themselves, because they were written to explain that the old deployment hostname deliberately had no `e`. The recommendation here was to delete them along with the obsolete Vercel docs rather than edit them. That was done on 2026-09-04: `docs/mobile/MOBILE_API_CONFIG.md`, `docs/mobile/MOBILE_EVENT_PUBLISHING_READY.md` and `docs/TESTING_GUIDE_NATIVE_VS_WEB.md` were removed with the other 94 documents describing retired infrastructure.

Three of those lines survive in `docs/EVENT_LOADING_FIX_NOV_1.md:51,171,198`, which is a dated incident record and is deliberately left unedited. Rewriting a record falsifies it. Read the date before the body.

Dark mode has a full palette defined here but no implementation. `neutral-950` is specified as the inverse surface and `coral-300` measures 9.77:1 against it, so the values are ready when the work is scheduled.

No print specification is included. Add CMYK and Pantone equivalents before any physical production.

---

## 12. Reference concept direction

Added 2026-09-30. Source: three reference mockups supplied at the repository root
(`concept.JPG`, `concept1.JPG`, `concept2.JPG`) as design inspiration for the web and
mobile apps. They are not PartyHause mockups. `concept.JPG` is "Mentalq", a mental-health
mood app; `concept1.JPG` is a compilation of two e-learning dashboards; `concept2.JPG` is
a clean re-crop of the first of those two. Both education shots carry a Xiaohongshu
watermark (id 967145877), so they are somebody else's designs. **Take them as direction
only. Do not ship, trace or copy any asset from them.**

The decision of 2026-09-30 took three things from them: the colour palette, adapted to the
event-planning domain; the grid layout; and the layout concept. Everything else was
rejected and is listed in 12.5.

### 12.1 Palette

The mockups paint a warm, paper-like palette: cream surfaces, a warm orange primary, one
saturated cool accent, soft pinks and a dark slate. Mapped onto the system in section 4,
coral stays the anchor and three new scales join it. Every value below was generated with
the same lightness ramp section 4 uses for coral and magenta (97, 94, 88, 79, 70, 60, 51,
42, 34, 28, 16) and every contrast ratio was computed. Nothing here is asserted from
memory.

**cream**, hue 38, sat 35%. The surface family. The two concept ivories differ slightly in
hue (`#F2EDE4` at hsl 39 35% 92%, `#F5F3E7` at hsl 51 41% 93%); the scale pins hue 38,
between them. The concept backgrounds land between the 100 and 200 steps.

| Step | HSL | Hex |
|---|---|---|
| 50 | `38 35% 97%` | `#FAF8F5` |
| 100 | `38 35% 94%` | `#F5F1EA` |
| 200 | `38 35% 88%` | `#EBE3D6` |
| 300 | `38 35% 79%` | `#DCCEB7` |
| 400 | `38 35% 70%` | `#CDBA98` |
| 500 | `38 35% 60%` | `#BDA375` |
| 600 | `38 35% 51%` | `#AE8E56` |
| 700 | `38 35% 42%` | `#917546` |
| 800 | `38 35% 34%` | `#755F38` |
| 900 | `38 35% 28%` | `#604E2E` |
| 950 | `38 35% 16%` | `#372D1B` |

Measured on the new surfaces: `neutral-900` text on cream-50 is 15.16:1, on cream-100
14.27:1, on cream-200 12.62:1, all AAA. `neutral-700` on cream-100 is 8.00:1. A
`coral-700` button fill against cream-50 measures 5.53:1 and against cream-100 5.20:1,
both pass non-text 1.4.11. The `coral-600` focus ring measures 3.93:1 on cream-50, 3.70:1
on cream-100 and 3.27:1 on cream-200, all of which pass 1.4.11, so section 4.2's rule
holds on the new surfaces without changing the ring.

**teal**, hue 170, sat 48%. The cool accent, for category surfaces and visual rhythm. The
concept's leaderboard surface `#2F8577` (hsl 170 48% 35%) carries white at 4.43:1, which
fails AA by 0.07. The 800 step is the corrected version of the same colour.

| Step | HSL | Hex |
|---|---|---|
| 50 | `170 48% 97%` | `#F4FBFA` |
| 100 | `170 48% 94%` | `#E8F7F5` |
| 200 | `170 48% 88%` | `#D2EFEA` |
| 300 | `170 48% 79%` | `#B0E3DB` |
| 400 | `170 48% 70%` | `#8ED7CB` |
| 500 | `170 48% 60%` | `#68CABA` |
| 600 | `170 48% 51%` | `#46BEAA` |
| 700 | `170 48% 42%` | `#389F8D` |
| **800** | `170 48% 34%` | **`#2D8072`** |
| 900 | `170 48% 28%` | `#256A5E` |
| 950 | `170 48% 16%` | `#153C36` |

White on `teal-800` measures **4.73:1** and passes AA. White on `teal-700` measures
3.22:1: decorative fills and large text only. Role rule: `teal` is a category and surface
colour, never a status colour. `success` (hue 160) stays the only semantic green; status
colours never use `teal`, so the two cannot collide in meaning.

**periwinkle**, hue 244, sat 100%. The evening accent. It also adopts the logo house
colour at last: the mark's periwinkle is `#6C63FF` (hsl 243 100% 69%), which section 1
found orphaned, appearing in no app CSS. `periwinkle-400` is its step, within one degree
of hue and one point of lightness; the exact hex stays logo-only and UI uses the scale.

| Step | HSL | Hex |
|---|---|---|
| 50 | `244 100% 97%` | `#F1F0FF` |
| 100 | `244 100% 94%` | `#E2E0FF` |
| 200 | `244 100% 88%` | `#C6C2FF` |
| 300 | `244 100% 79%` | `#9B94FF` |
| **400** | `244 100% 70%` | **`#7066FF`** |
| 500 | `244 100% 60%` | `#4133FF` |
| 600 | `244 100% 51%` | `#1605FF` |
| 700 | `244 100% 42%` | `#0E00D6` |
| 800 | `244 100% 34%` | `#0C00AD` |
| 900 | `244 100% 28%` | `#0A008F` |
| 950 | `244 100% 16%` | `#050052` |

White on `periwinkle-400` measures 4.17:1: decorative fills, focus rings and large text.
White on `periwinkle-500` measures 6.68:1 and on `periwinkle-700` 10.55:1: use 500 or
darker wherever text sits on it.

**Concept colours the existing scales already cover.** No new tokens for these:

| Concept colour | Measured | Maps to |
|---|---|---|
| Orange `#F08A3C`, buttons and illustration | 2.50:1 with white | `coral-400`/`coral-500` decorative fills. Never a button fill under a white label; buttons stay `coral-700` |
| Amber-orange `#F0A03C` | 2.14:1 with white | `coral-300`/`coral-400` |
| Amber `#F5C563`, card fills | 1.61:1 with white | Rejected as a scale. Card washes use `coral-100`/`cream-200` |
| Hot pink `#EE5D8D`, header block | 3.19:1 with white | `magenta-400`/`magenta-500` |
| Soft pink `#F2B8C6`, chips | 1.69:1 with white | `magenta-100`/`magenta-200` |
| Dark slate `#3F4460`, backdrop | 9.51:1 with white | `neutral-800`/`neutral-900` |
| Charcoal `#2B2B33`, dark UI | 14.04:1 with white | `neutral-950` |
| Dusty periwinkle `#8A92B5`, header block | 3.06:1 with white | Replaced by `periwinkle-100`/`periwinkle-200` washes. The mockup's 13-percent-saturation grey-blue is the one-off-token failure mode section 1 records |

The scales are specified for the light theme. Dark mode is still unbuilt (section 11);
dark values for the three new scales are unscheduled like the rest.

### 12.2 Grid layout

The grid the concept screens compose from, with the Tailwind mapping:

| Pattern | Concept | Tailwind |
|---|---|---|
| Mobile sections | Explicit 2- and 3-column rows | `grid grid-cols-2` / `grid grid-cols-3` |
| Web sections | 12-column grid with spans | `lg:grid-cols-12`, content `lg:col-span-7`, visual `lg:col-span-5` |
| Gutters | 16 px mobile, 24 px web | `gap-4` / `md:gap-6` |
| Screen margins | 16 px mobile, 32 px web | `px-4` / `md:px-8`; container padding 2rem unchanged |
| Hero header block | Coloured block over roughly the top 38 percent of the screen | `min-h-[38vh]` on mobile heroes |
| Content sheet | Cream sheet overlapping the header block, radius about 28 px | `rounded-3xl` (24 px) with a `-mt-7` overlap |
| Sibling cards | Two-across equal split | `grid grid-cols-2 gap-4` |
| Stat pills | Three-across, dotted borders, icon chip, number, label | `grid grid-cols-3 gap-3`, `rounded-2xl border-2 border-dashed` |
| List rows | Full width, thumb, title and meta, trailing round action | flex row, `rounded-2xl`, action `rounded-full` |
| Rank cards | Stacked rows, rank chip, percentage pill, avatar | `rounded-2xl` rows, pill `rounded-full` |
| Bottom sheet, mobile | Drag handle, rounded top | `rounded-t-3xl` and a handle bar |
| Buttons and chips | Fully rounded pills | `rounded-full` |

Web card grids run 3-across (`lg:grid-cols-3`) or 4-across (`xl:grid-cols-4`) inside the
existing container (2xl at 1400 px, padding 2rem, unchanged from `tailwind.config.ts`).

One oversized metric per screen: a single display numeral at 56 to 64 px (`text-6xl`)
under an `overline` caption, the mockups' "78 percent" pattern. One per screen, not a grid
of big numbers.

### 12.3 Layout concept

The patterns, in the order they should reach the app:

1. **Greeting-first header.** "Hi, {name}" plus the date, avatar and search, on every
   signed-in screen. `PageShell` dashboard headers currently pass a static title; they
   take the greeting pattern.
2. **Coloured header block over a cream content sheet.** The two-tone screen: a coral,
   teal or periwinkle block on top, the cream sheet overlapping upward.
3. **One oversized metric.** RSVP rate, guest count or poll turnout as the screen's hero
   number.
4. **Dotted-border stat pills.** Guests confirmed, declined and pending; polls open and
   closed. The dotted border is the concept's signature detail and distinguishes these
   from ordinary cards.
5. **Coloured category cards with meta pills.** Timeline blocks, media and poll cards as
   coloured washes with duration and count pills.
6. **Rank cards.** Partycrew engagement as #1/#2/#3 rows with percentage pills and
   avatars.
7. **Rounded emoji-topped bars and bubble charts.** Poll results as rounded bars topped
   with the option's template glyph; RSVP breakdown as circles sized by count. Charts use
   palette colours only.
8. **Filter chips and bottom sheets.** Chip rows for filtering, bottom sheets with drag
   handles for composition on mobile.
9. **Flat illustration with starburst accents.** Empty states, landing hero and
   onboarding.

### 12.4 Illustration

The concepts are illustration-led: flat vector spot illustration, friendly curvy shapes,
starburst accents, consistent line weight. The mark already speaks this language (flat
shapes, confetti dots). New spot illustration must: use palette colours only, from section
4 and 12.1; stay flat, with the brand gradient of 4.7 reserved for celebration moments;
carry the starburst and confetti motif as the recurring accent; and never use emoji as
illustration, per section 6.

### 12.5 Rejected

- The mental-health subject matter (mood tracking, meditation sessions) and the
  e-learning subject matter (courses, subjects, academic leaderboards). The patterns
  transfer; the content does not.
- The concept backdrops: dark navy `#3F4460` (Mentalq) and pink `#F2CFE0` with a diagonal
  stripe texture (education shots). The backdrop is presentation framing, not app UI.
- The concept orange as a button colour: 2.50:1 with white fails AA. Buttons stay
  `coral-700`.
- The concept teal's exact value under white text: 4.43:1 fails AA by 0.07. `teal-800` is
  the corrected version.
- The dusty 13-percent-saturation grey-blue as a token. One-off low-saturation colours are
  the failure mode section 1 records; washes come from the scale instead.
- The mockups' own artwork. Xiaohongshu-sourced, somebody else's design. Direction only.
- Rotated device frames and three-across phone mockups. Presentation, not product.

### 12.6 Implementation plan (Tailwind)

Plan made 2026-09-30, not yet executed. The steps, in order:

1. **CSS variables.** In `src/index.css`, add the three scales from 12.1 to the `:root`
   PartyHause brand block, after `--magenta-*`, as 33 HSL triplets in the same pattern as
   `--coral-*`, each commented with its hue and role.
2. **Tailwind config.** In `tailwind.config.ts`, add `cream`, `teal` and `periwinkle`
   keys to `theme.extend.colors` with the same `hsl(var(--cream-50))` pattern as
   `coral`/`magenta`/`neutral`, placed adjacent to them. No other colour addition. Grid,
   radius and gaps need no config change: they use stock utilities (`rounded-3xl`,
   `rounded-full`, `gap-4`, `grid-cols-*`).
3. **Page background.** Point `--background` at `38 35% 97%` (cream-50) so the app page
   goes cream. Cards stay `neutral-0`; inset surfaces use `cream-100`. `--ring` stays
   `coral-600`, verified against cream in 12.1.
4. **Reference page first.** Apply the grid and layout patterns to
   `src/components/LandingPageCreative.tsx`, already this document's reference
   implementation (section 10). Then `PageShell` for the greeting-first header, then the
   dashboard stat pills, partycrew rank cards and poll result charts.
5. **Fonts unchanged.** The concepts' rounded geometric sans confirms Outfit (section 5).
   No typography change in this plan.
6. **Verification.** `npm run typecheck`, `npm run test:run`, then a visual pass on the
   dev server at 375, 768 and 1440 px. `npm run audit:contracts` is unaffected; no API
   change.
7. **Guard.** The three scales are additive and the only existing token changed is
   `--background`. Note for later: `src/test/mobile-launch-assets.test.ts:168` pins the
   colour list permitted in `public/brand/*` assets. If the concept palette is ever
   applied to the app icon or social card, that list must be extended in the same change.
