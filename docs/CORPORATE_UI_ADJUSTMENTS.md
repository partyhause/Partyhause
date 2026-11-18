# PartyHause Corporate UI Adjustments

## Source of truth
docs/BRAND.md v1.1, canonical name PartyHause, anchor coral #FF5233, raise-the-roof mark. No asset copying from reference mockups.

## Position Summary
Corporate translation risks: perception mismatch party vs operations, tone informality in compliance/HR, colour overuse on data surfaces, credibility gap for PII, segmentation confusion.

Recommendation: master brand with corporate variant system. Keep name/mark/corral anchor. Gate fun expression to marketing surfaces. Introduce locked corporate visual rules for dashboards/B2B portal/guest management.

## UI Adjustments List

### Branding / Logo
- Header / app chrome: use Variant A Corporate Mono Lockup in neutral-900 currentColor for dashboard header, PageShell chrome, navigation top bar and tab bar. Minimum lockup width 120px screen, mark minimum 16px. Replace Sparkles flanks at AuthScreen.tsx:209-225 and :356-365 with mono lockup.
- Inverse mono on dark surfaces neutral-950 using white currentColor. No colour accent in header to keep data-dense surfaces neutral.
- Tab bar / mobile: use partyhause-favicon.svg, confetti removed. Label use wordmark mono. Dark rounded bottom tab bar per 12.7.2 #9. Active icon in coloured circle optional using coral-700 only on marketing surfaces.
- Guest check-in screen / B2B portal: screen header mono lockup. Primary CTA button fill coral-700 #C02A16 with white label for AA compliance.
- Hero / onboarding only: Variant B Corporate Restrained Colour Lockup permitted for greeting-first header with cream-50 background. Roof coral-700, body neutral-900, confetti toned neutral-500 or omitted at ≤24px.
- Forbid full festive lockup with magenta confetti and coral-500 roof on check-in. No roof animation on data screens; reserve roof lift animation for marketing surfaces only.
- Clear space: doorway width 7 units minimum, 16 units recommended on coloured backgrounds; 21 units for formal docs.
- Component updates: BrandMark.tsx add mono mode; PageShell headers swap title text for mono lockup; AuthScreen replace Sparkles flanks; Dashboard headers mono lockup; Guest check-in header mono; Print/PDF exports mono lockup with expanded clear space.

### Colour
- Role split enforced: coral-500 for decorative/logo only. Buttons with white label use coral-700 5.86:1. Links/body text use coral-800 8.18:1.
- Focus ring coral-600 #EA361A, passes 1.4.11 on all surfaces including neutral-200 and cream-200.
- Error colour danger #E12D33, separate from coral. Success #0B835B, warning #A26907, info #1973E1.
- Page background cream-50 #FAF8F5, cards neutral-0, inset surfaces cream-100.
- Category surfaces: saturated cards coral-700, magenta-700, teal-800, periwinkle-500 with white text AA. Tinted cards cream-100/200, magenta-100/200, periwinkle-100/200 with neutral-800/900 text.
- Contrast card neutral-950 with white pill button, neutral-900 text. No coral on neutral-950.
- Dark mode: neutral-950 inverse surface, coral-300 passes 9.77:1 against it.

### Typography
- Self-host Outfit and Inter. No Google Fonts CDN.
- Dashboard headers Outfit 600/32px max. Body 16px Inter 400 for tables. Captions 12px Inter 500.
- Reduce hero to display-lg 60/1.05. Tracking -0.02em on display only.
- Greeting-first header in PageShell: “Hi, {name}” plus date, avatar, search on every signed-in screen.

### Iconography & Motion
- Lucide-react stays. Icon colour inherits currentColor, never hardcode.
- PartyPopper reserved for success/completion. Sparkles retired from logo, available as AI/suggestion glyph.
- No emoji in chrome/navigation. Event-template glyphs stay as content.
- Roof animation permitted on entry for marketing surfaces only. No pulsing drop-shadow on titles.
- prefers-reduced-motion honoured.

### Layout & Components
- PageShell: greeting-first header, sticky bg-card header, centered main.
- Multi-colour card system: no two adjacent cards share hue. Saturated fills carry white text only at AA steps. Every coloured card leads with white icon chip 40-48px. Selection is white ring not colour change. Contrast card carries primary action with white pill button.
- Stat trio: tinted boxes with icon chip, big number, overline label for guests confirmed/declined/pending; polls open/closed.
- Oversized metric one per screen with delta chips +/−.
- Rank cards: partycrew leaderboard row surface teal-800, chips coral-500/neutral-0/coral-300.
- Avatar cluster with +N pill for guest previews.
- Trailing circular arrow button on cards.
- Dark rounded bottom tab bar active icon in coloured circle.
- Circular bell button with unread dot on mobile headers.
- Sticky-note tags, dropdown chip with chevron, doodle layer for onboarding/empty states only.

### Accessibility & Compliance
- WCAG AA compliance: white on coral-500 3.23:1 fails for body text. White on coral-700 passes.
- Focus ring coral-600 passes on cream and neutral surfaces.
- Ten broken tokens defined or removed. --shadow-primary, --glow-primary, etc.
- Error colour distinct from primary.
- Dark mode palette ready.

### Implementation notes
- Migrate every caller from text title to BrandLockup.
- Update src/index.css to remove Liquid Metal and Solid Color System blocks, define missing tokens.
- Tailwind config rename orange key to coral, add magenta/neutral/support colours.
- Verify at 375, 768, 1440 px.

Risks: brand dilution if festive lockup used on data screens; accessibility failures if coral-500 used for white labels; perception mismatch if confetti persists in corporate chrome.

Recommendation: adopt corporate variant system with mono lockup for chrome, colour restrained for hero only, enforce coral-700 button rule, and apply multi-colour card system with AA contrast.
