# Festival Botecar Rio 2026 — guia pessoal

Todos os botecos participantes do [Festival Botecar Rio 2026](https://www.festivalbotecar.com.br/rio/), ordenados pela rota real a partir de casa, com a identidade visual do festival (laranja `#ed7623`, creme `#fff4df`, Baloo 2 + Inter).

## Fluxo de dados

1. `scripts/scrape.js` baixa `https://www.festivalbotecar.com.br/rio/pratos.js` (o site oficial não tem páginas por bar; os dados ficam num array `pratos`) e grava `data/bars-raw.json`.
2. `scripts/process.js` normaliza os campos, extrai o bairro do endereço e usa `../scripts/lib/routing.js` para geocodificar, achar o link exato do Google Maps e calcular rotas a pé e de carro. Gera `data/bars-final.json` e as páginas `bar/<slug>/index.html`.
3. `index.html` + `js/app.js` carregam `data/bars-final.json` e permitem buscar, filtrar por preço/bairro e ordenar por distância, preço ou nome.

Os caches (`data/geocode-cache.json`, `data/google-maps-cache.json`, `data/google-maps-route-cache.json`) evitam refazer consultas. Apague a entrada de um bar no cache se o endereço dele mudar.

## Arquivos

- `index.html`, `css/style.css`, `js/app.js`: página principal
- `scripts/layout.js`: cabeçalho/rodapé das páginas geradas (manter igual ao de `index.html`)
- `assets/`: logo (`fav.svg`), selo (`botecar.png`) e ícones decorativos do festival
- As fotos dos pratos são carregadas direto do site do festival
