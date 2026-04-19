# Comida di Buteco 2026 RJ

Este projeto é uma versão estática do guia dos bares participantes do **Comida di Buteco 2026 no Rio de Janeiro**, com foco em:

- listar todos os butecos participantes
- ordenar pela menor distância de rota real a partir de um endereço fixo
- filtrar por bairro e busca textual
- gerar páginas individuais para cada bar
- preservar a identidade visual do site original

## Visão geral

O repositório contém:

- uma homepage estática em [index.html](/Users/matheus/Projects/buteco/index.html)
- estilos e comportamento de interface em [css/style.css](/Users/matheus/Projects/buteco/css/style.css) e [js/app.js](/Users/matheus/Projects/buteco/js/app.js)
- assets locais de fontes e imagens em `assets/`
- scripts de coleta e processamento em [scripts/scrape.js](/Users/matheus/Projects/buteco/scripts/scrape.js) e [scripts/process.js](/Users/matheus/Projects/buteco/scripts/process.js)
- dados processados em [data/bars-final.json](/Users/matheus/Projects/buteco/data/bars-final.json)
- páginas individuais geradas em `buteco/*/index.html`

## Requisitos

- Node.js 18+ recomendado
- npm

## Instalação

```bash
npm install
```

## Comandos

### Coletar os dados brutos

```bash
npm run scrape
```

Esse comando usa Playwright para capturar os dados da listagem original e gerar a base bruta em `data/`.

### Processar os dados e regenerar o site

```bash
npm run build
```

Esse comando:

- lê os dados brutos
- extrai prato, descrição, endereço, telefone e horário
- faz geocodificação dos bares
- tenta resolver links exatos do Google Maps para cada bar
- calcula rotas reais de caminhada e carro/Uber em relação ao endereço fixo
- seleciona uma rota principal: caminhada até 20 min, senão carro/Uber
- ordena os bares pela distância dessa rota principal
- gera `data/bars-final.json`
- regenera as páginas em `buteco/*/index.html`

## Endereço de referência

As rotas são calculadas a partir de:

`Rua do Bispo, 295, Rio Comprido, Rio de Janeiro, RJ, Brasil`

Esse valor está definido em [scripts/process.js](/Users/matheus/Projects/buteco/scripts/process.js).

## Cache de geocodificação, Maps e rotas

O processamento usa cache local para evitar repetir consultas externas de geocodificação, resolução de links do Google Maps e coleta de rotas.

Arquivos relevantes:

- `data/geocode-cache.json`
- `data/google-maps-cache.json`
- `data/google-maps-route-cache.json`
- `data/bars-final.json`

Se você mudar endereços, nomes dos bares, origem das rotas ou regras de busca, talvez seja necessário limpar ou revisar esses caches antes de rodar o build novamente.

## Estrutura principal

```text
.
├── index.html
├── assets/
│   ├── fonts/
│   └── images/
├── css/
│   └── style.css
├── js/
│   └── app.js
├── scripts/
│   ├── scrape.js
│   └── process.js
├── data/
│   └── bars-final.json
├── buteco/
│   └── */index.html
```

## Como a interface funciona

- `js/app.js` carrega `data/bars-final.json`
- todos os bares são carregados no front-end
- a interface filtra por bairro e texto
- a ordenação pode ser por distância da rota principal ou nome
- hoje os bares não são excluídos por rota; eles apenas são ordenados

## Ajustes visuais

A fidelidade visual foi construída combinando:

- a estrutura local do projeto
- assets locais extraídos do tema original quando necessários
- overrides observados no HTML salvo da página original

O arquivo mais importante para isso é [css/style.css](/Users/matheus/Projects/buteco/css/style.css).

## Observações

- O build depende de geocodificação externa e de páginas do Google Maps para preencher links e rotas.
- Se algum bar não tiver rota confiável, ele continua no dataset e tende a ficar no fim da ordenação principal.
- As páginas individuais são geradas automaticamente; edições manuais nelas podem ser sobrescritas no próximo `npm run build`.
