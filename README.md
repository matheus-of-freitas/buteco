# Guias de botecos do Rio

Guias pessoais e estáticos dos festivais de boteco do Rio de Janeiro, com todos os bares participantes ordenados pela **rota real** (Google Maps) a partir da Rua do Bispo, 295 — Rio Comprido.

| Pasta | Festival | Status |
| --- | --- | --- |
| [`botecar/`](botecar/) | Festival Botecar Rio 2026 | **no ar** |
| [`comida-di-buteco/`](comida-di-buteco/) | Comida di Buteco 2026 | arquivado para a próxima edição |

A geocodificação, a resolução de links do Google Maps e o cálculo de rotas (a pé até 20 min, senão carro/Uber) ficam em [`scripts/lib/routing.js`](scripts/lib/routing.js) e são compartilhados pelos dois sites. Cada site guarda seus próprios dados e caches em `<site>/data/`.

## Comandos

```bash
npm install

# Botecar (site atual)
npm run scrape        # baixa os bares do festivalbotecar.com.br
npm run build         # geocodifica, calcula rotas, gera data/bars-final.json e bar/*/
npm run deploy        # publica botecar/ no S3 + CloudFront

# Comida di Buteco (próxima edição)
npm run scrape:buteco
npm run build:buteco
npm run deploy:buteco
```

Pré-visualização local: `npx serve botecar` (ou `npx serve comida-di-buteco`).

## GitHub Pages

O workflow [`.github/workflows/pages-botecar.yml`](.github/workflows/pages-botecar.yml) publica `botecar/` no GitHub Pages a cada push em `main` que altere essa pasta. É preciso ativar o Pages em *Settings → Pages → Source: GitHub Actions* (repositórios privados exigem plano pago do GitHub).
