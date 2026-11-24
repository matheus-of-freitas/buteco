const fs = require("fs");
const path = require("path");
const {
  createRouting,
  emptyRouteFields,
  formatRankingDistance,
  escapeHtml,
} = require("../../scripts/lib/routing");
const { renderHeader, renderFooter, renderHead, ICONS } = require("./layout");

const SITE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(SITE_DIR, "data");
const RAW_FILE = path.join(DATA_DIR, "bars-raw.json");
const OUTPUT_FILE = path.join(DATA_DIR, "bars-final.json");
const PAGES_DIR = path.join(SITE_DIR, "bar");
const BOTECAR_PRATOS_URL = "https://www.festivalbotecar.com.br/rio/pratos.html";

const routing = createRouting({ dataDir: DATA_DIR });

function slugify(str) {
  return str
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatPrice(value) {
  if (typeof value !== "number") return "";
  return `R$ ${value.toFixed(2).replace(".", ",")}`;
}

// "Rua X, 123 - Bairro" → "Bairro"
function getNeighborhood(endereco) {
  const parts = (endereco || "").split(" - ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
}

function toBar(raw) {
  return {
    slug: slugify(raw.bar),
    name: raw.bar,
    neighborhood: raw.regiao || getNeighborhood(raw.endereco),
    address: `${raw.endereco}, Rio de Janeiro - RJ`,
    displayAddress: raw.endereco,
    dishName: raw.prato || "",
    dishDescription: raw.descricaoCurta || "",
    dishInspiration: raw.inspiracao || "",
    price: typeof raw.preco === "number" ? raw.preco : null,
    priceLabel: formatPrice(raw.preco),
    portion: raw.porcao || "",
    hours: raw.funcionamento || "",
    instagramUrl: raw.instagram ? `https://www.instagram.com/${raw.instagram}/` : "",
    instagramHandle: raw.instagram || "",
    photoUrl: raw.foto || "",
    botecarUrl: BOTECAR_PRATOS_URL,
    googleMapsUrl: "",
    ...emptyRouteFields(),
  };
}

function renderRoute(bar) {
  if (!bar.rankingMode) return "";
  const icon = bar.rankingMode === "walking" ? ICONS.walk : ICONS.car;
  const mode = bar.rankingMode === "walking" ? "a pé" : "de carro/Uber";
  const other = bar.rankingMode === "walking" && bar.drivingDurationText
    ? `<span class="rota-alt">${ICONS.car} ${escapeHtml(bar.drivingDurationText)} de carro/Uber</span>`
    : bar.rankingMode === "driving" && bar.walkingDurationText
      ? `<span class="rota-alt">${ICONS.walk} ${escapeHtml(bar.walkingDurationText)} a pé</span>`
      : "";
  return `
          <div class="rota-box">
            <span class="rota-principal">${icon} <strong>${escapeHtml(bar.rankingDurationText)}</strong> ${mode} · ${escapeHtml(formatRankingDistance(bar))}</span>
            ${bar.rankingRouteSummary ? `<span class="rota-via">${escapeHtml(bar.rankingRouteSummary)}</span>` : ""}
            ${other}
          </div>`;
}

function generateBarPage(bar, rank) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
${renderHead({
  title: `${bar.name} — Botecar Rio 2026`,
  description: `${bar.dishName} no ${bar.name} (${bar.neighborhood}) — Festival Botecar Rio 2026.`,
  root: "../../",
})}
</head>
<body>
${renderHeader({ root: "../../" })}
  <main class="detalhe">
    <div class="detalhe-wrap">
      <a href="../../" class="voltar">${ICONS.back} Voltar para a lista</a>
      <article class="detalhe-card">
        <div class="detalhe-foto">
          <img src="${escapeHtml(bar.photoUrl)}" alt="${escapeHtml(bar.dishName)} — ${escapeHtml(bar.name)}">
          <span class="rank-badge rank-badge--${rank <= 3 ? rank : "n"}">${rank}º</span>
        </div>
        <div class="detalhe-info">
          <p class="detalhe-bairro">${escapeHtml(bar.neighborhood)}</p>
          <h1 class="detalhe-bar">${escapeHtml(bar.name)}</h1>
          <h2 class="detalhe-prato">${escapeHtml(bar.dishName)}</h2>
          <p class="detalhe-preco">${escapeHtml(bar.priceLabel)}${bar.portion ? ` <span>· serve ${escapeHtml(bar.portion)}</span>` : ""}</p>
          <p class="detalhe-desc">${escapeHtml(bar.dishDescription)}</p>
${renderRoute(bar)}
          <dl class="detalhe-dados">
            <div><dt>${ICONS.pin} Endereço</dt><dd>${escapeHtml(bar.displayAddress)}</dd></div>
            ${bar.hours ? `<div><dt>${ICONS.clock} Funcionamento</dt><dd>${escapeHtml(bar.hours)}</dd></div>` : ""}
            ${bar.instagramHandle ? `<div><dt>${ICONS.insta} Instagram</dt><dd><a href="${escapeHtml(bar.instagramUrl)}" target="_blank" rel="noopener">@${escapeHtml(bar.instagramHandle)}</a></dd></div>` : ""}
          </dl>
          ${bar.dishInspiration ? `<div class="detalhe-inspiracao"><h3>${ICONS.music} Inspiração do prato</h3><p>${escapeHtml(bar.dishInspiration)}</p></div>` : ""}
          <div class="detalhe-acoes">
            <a href="${escapeHtml(bar.googleMapsUrl)}" target="_blank" rel="noopener" class="botao botao--cheio">${ICONS.map} Como chegar</a>
            <a href="${escapeHtml(bar.botecarUrl)}" target="_blank" rel="noopener" class="botao botao--contorno">Ver no Festival Botecar</a>
          </div>
        </div>
      </article>
    </div>
  </main>
${renderFooter({ root: "../../" })}
</body>
</html>
`;
}

async function main() {
  const rawBars = JSON.parse(fs.readFileSync(RAW_FILE, "utf-8"));
  console.log(`Processando ${rawBars.length} bares...\n`);

  const bars = rawBars.map(toBar);
  const missingNeighborhood = bars.filter((b) => !b.neighborhood).map((b) => b.name);
  if (missingNeighborhood.length) console.log("Sem bairro:", missingNeighborhood);

  await routing.rankBars(bars);

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(bars, null, 2), "utf-8");
  console.log(`\nSalvo: ${OUTPUT_FILE} (${bars.length} bares)`);

  console.log("\n=== Gerando paginas individuais ===\n");
  fs.rmSync(PAGES_DIR, { recursive: true, force: true });
  bars.forEach((bar, i) => {
    const dir = path.join(PAGES_DIR, bar.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), generateBarPage(bar, i + 1), "utf-8");
  });
  console.log(`${bars.length} paginas geradas em bar/`);

  routing.printSummary(bars);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
