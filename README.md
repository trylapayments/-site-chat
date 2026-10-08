# Mill marketing website

18 static marketing pages for a separate Vercel project. The design presents Mill as live chat software first: team collaboration, customer context, custom widgets and connected tools, with AI as a supporting part of the product.

## Preview and hosting

Run `node preview.mjs` in this directory and open http://127.0.0.1:4317/.

Vercel project root: this directory. No framework or build command; output directory `.`. `vercel.json` enables clean URLs. Application sign-in and trial links go to `app.mill.chat`. This revision is a local design preview; no production deployment or DNS changes were made.

## Pages

- Home and Product
- Live chat, Team inbox, Widget customisation, Multiple websites, Customer context
- Mill AI, AI agent, operator assistance, Knowledge
- Solutions for online stores, software teams and professional services
- Pricing, Integrations, Getting started, FAQ

The operator assistance URL remains `/ai/copilot` for existing links; its visible product name is Mill AI.

## Design and interactions

- Shared typography, soft page-specific palettes, gradient headlines, product UI panels, borders and shadows.
- The homepage has a usable local chat demo on its first screen, suggested questions, typed replies, team handover and restart. Lower sections demonstrate the platform, brand/team/tool setup, industry use cases and integrations.
- Detail-page heroes demonstrate their own feature. Their tabs replay local conversations. Teamwork sections show private notes and handover; the widget page includes device and colour previews plus a greeting customiser.
- Pricing includes monthly/yearly display, exact annual totals and savings, a seat/site plan finder, feature comparison filters, and small teamwork/branding interactions. Approved monthly prices are $29/$49/$89/$199; annual totals are $290/$490/$890/$1,990.
- The integrations catalogue contains 24 tools with search, category filters and keyboard-dismissable detail dialogs. Industry links can prefilter the catalogue via `?search=Shopify`; category links use `?category=Automation`.
- Getting started has a four-step interactive preview. FAQ has text search, category filters, accordions and an empty-result reset.
- Animations include message arrival, typing, connected-tool activity and small reveal/hover transitions. Global pause and reduced-motion styling are available.

All marketing demos run locally and make no external writes. They illustrate the complete intended product, as requested. They do not implement or install backend integrations, send real messages, or initiate billing.

## Files

- `site.css`, `site.js`: common navigation, footer, older shared demos and teamwork interactions.
- `platform.css`, `platform.js`: homepage and integration catalogue.
- `detail.css`, `detail.js`: 15 feature, AI, solution and resource pages.
- `pricing.css`, `pricing.js`: pricing presentation and plan finder.
- `integrations-data.js`: integration descriptions and modal content.
- `ASSETS.md`: image and logo provenance.

## Verification for the October 6 refresh

All 18 routes were opened at desktop and 390 px mobile widths: no document overflow or broken image references. The local page/asset/anchor checker and JavaScript syntax checks pass. Browser interaction checks cover the chat, product tabs, private notes and handover, widget colour/device selection, setup steps, FAQ filtering/reset, integration search/categories/dialog/reset, mobile navigation, yearly price totals, plan recommendation and comparison filters.

Review screenshots are in `review/site-v3/`. Earlier HTML snapshots there and in `review/pricing-v3/` are local design backups, not public routes in the navigation.
