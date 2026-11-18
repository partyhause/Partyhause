# Landing Page Spec

Path: `/`
Component: `LandingPageCreative`
Auth: None

Brand system from BRAND.md:
- Primary: #FF5233 coral
- Logo house: #6C63FF
- PWA theme: #6366F1
- Motion: 300ms page transition + 20px y offset, card hover spring stiffness 300 damping 20.

Sections:
1. Hero with BrandMark, hero title, primary CTA Create event, secondary Explore, login CTA.
2. Feature grid 3 cols: Event Planning, Guest Management, AI Assistant.
3. Social proof / testimonials.
4. Footer with Privacy/Terms/Support links.

All CTAs map to real routes: `/auth`, `/create-event`, `/explore`. No inert setCurrentPage.
