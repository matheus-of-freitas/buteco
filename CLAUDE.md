# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Static website for "Comida de Buteco 2026" — a personalized guide to the best participating bars in Rio de Janeiro, ranked by proximity to home and Google reviews. Designed for easy deployment on GitHub Pages (HTML/CSS/JS only, no backend or database).

**All UI text, content, and copy must be in Brazilian Portuguese (pt-BR).**

## Development

This is a static site. To preview locally, serve the root directory with any static file server:

```bash
npx serve .
# or
python3 -m http.server
```

Deploy target: GitHub Pages (static files only).

## Project Requirements

- **Home address:** Rua do Bispo, 295 - Rio Comprido, CEP 20261-067
- **Event site:** https://comidadibuteco.com.br/butecos/rio-de-janeiro/
- **Travel radius:** up to ~30 minutes by Uber
- **Ranking criteria:** prioritize nearby bars first, then list farther bars that are worth the trip based on Google ratings
- **Per-bar info to include:** Google Maps link, Comida de Buteco link, Google star rating, review summary, and any other relevant details (dish, price, hours, etc.)
- **UI:** inspired by the Comida de Buteco website style, but with a personalized ranking
- **Language:** content in Portuguese (pt-BR)
