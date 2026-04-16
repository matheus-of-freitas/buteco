# Comida di Buteco 2026 RJ

Este projeto é uma versão estática do guia dos bares participantes do **Comida di Buteco 2026 no Rio de Janeiro**, com foco em:

- listar todos os butecos participantes
- ordenar por distância a partir de um endereço fixo
- filtrar por bairro e busca textual
- gerar páginas individuais para cada bar
- preservar a identidade visual do site original

## Visão geral

O repositório contém:

- uma homepage estática em [index.html](/Users/matheus/Projects/buteco/index.html)
- estilos e comportamento de interface em [css/style.css](/Users/matheus/Projects/buteco/css/style.css) e [js/app.js](/Users/matheus/Projects/buteco/js/app.js)
- scripts de coleta e processamento em [scripts/scrape.js](/Users/matheus/Projects/buteco/scripts/scrape.js) e [scripts/process.js](/Users/matheus/Projects/buteco/scripts/process.js)
- dados processados em [data/bars-final.json](/Users/matheus/Projects/buteco/data/bars-final.json)
- páginas individuais geradas em `buteco/*/index.html`
- arquivos originais do tema em `original-theme/`, usados como referência visual

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
- calcula a distância em relação ao endereço fixo
- ordena os bares por distância
- gera `data/bars-final.json`
- regenera as páginas em `buteco/*/index.html`

## Endereço de referência

As distâncias são calculadas a partir de:

`Rua do Bispo, 295, Rio Comprido, Rio de Janeiro, RJ, Brasil`

Esse valor está definido em [scripts/process.js](/Users/matheus/Projects/buteco/scripts/process.js).

## Cache de geocodificação

O processamento usa cache local para evitar repetir consultas de geocodificação.

Arquivos relevantes:

- `data/geocode-cache.json`
- `data/bars-final.json`

Se você mudar endereços, regras de parsing ou a origem da distância, talvez seja necessário limpar ou revisar o cache antes de rodar o build novamente.

## Estrutura principal

```text
.
├── index.html
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
└── original-theme/
```

## Como a interface funciona

- `js/app.js` carrega `data/bars-final.json`
- todos os bares são carregados no front-end
- a interface filtra por bairro e texto
- a ordenação pode ser por distância ou nome
- hoje os bares não são excluídos por distância; eles apenas são ordenados

## Ajustes visuais

A fidelidade visual foi construída combinando:

- a estrutura local do projeto
- os arquivos do tema original em `original-theme/`
- overrides observados no HTML salvo da página original

O arquivo mais importante para isso é [css/style.css](/Users/matheus/Projects/buteco/css/style.css).

## Observações

- O build depende de geocodificação externa para preencher coordenadas.
- Se algum bar não for geocodificado, ele continua no dataset e tende a ficar no fim da ordenação por distância.
- As páginas individuais são geradas automaticamente; edições manuais nelas podem ser sobrescritas no próximo `npm run build`.
