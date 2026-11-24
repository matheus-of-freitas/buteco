# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static websites ranking the participating bars of Rio de Janeiro bar festivals by real Google Maps route from home. HTML/CSS/JS only, no backend.

The repo holds one folder per festival, plus a shared pipeline:

- `botecar/` — **Festival Botecar Rio 2026** (https://www.festivalbotecar.com.br/rio/). This is the site that is live now. Its look and feel follow the Botecar brand: orange `#ed7623`, cream `#fff4df`, Baloo 2 + Inter fonts, and its logo and badge.
- `comida-di-buteco/` — **Comida di Buteco 2026** (https://comidadibuteco.com.br/butecos/rio-de-janeiro/). Archived for the next edition. Don't delete it, and keep it buildable.
- `scripts/lib/routing.js` — shared core: Nominatim geocoding, exact Google Maps place links, walking/driving routes scraped with Playwright, hybrid ranking (walk if ≤20 min, else car/Uber), and summaries. Each site calls `createRouting({ dataDir, getCacheKey? })` and keeps its own caches in `<site>/data/`.

**All UI text, content, and copy must be in Brazilian Portuguese (pt-BR).**

## Commands

```bash
npm run scrape && npm run build      # Botecar: fetch data, compute routes, generate pages
npm run deploy                       # Botecar → S3 bucket + CloudFront (live)
npm run scrape:buteco && npm run build:buteco && npm run deploy:buteco   # Comida di Buteco
npx serve botecar                    # local preview
```

GitHub Pages: `.github/workflows/pages-botecar.yml` publishes `botecar/` when pushed to `main` (needs Pages enabled with source "GitHub Actions").

## Requirements

- **Home address:** Rua do Bispo, 295 - Rio Comprido, CEP 20261-067 (set in `scripts/lib/routing.js`)
- **Travel radius:** up to ~30 minutes by Uber
- **Ranking:** nearby bars first, by the primary route distance
- **Per-bar info:** Google Maps link, festival link, dish, price, hours, Instagram, and other relevant details
- **UI:** each site follows its own festival's branding, with the personalized ranking on top
- Generated files (`<site>/data/bars-final.json`, `botecar/bar/*`, `comida-di-buteco/buteco/*`) are overwritten by the build. Change the templates instead: `botecar/scripts/process.js` plus `layout.js`, or `comida-di-buteco/scripts/process.js`.
