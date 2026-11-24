const ICON_WALK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM9.8 8.9 7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/></svg>';
const ICON_CAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>';

const PRICE_BANDS = {
  ate30: (p) => p <= 30,
  "30-50": (p) => p > 30 && p <= 50,
  "50-70": (p) => p > 50 && p <= 70,
  acima70: (p) => p > 70,
};

let allBars = [];

const $ = (id) => document.getElementById(id);

function normalize(str) {
  return (str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function formatKm(value) {
  return typeof value === "number" ? `${value.toFixed(1).replace(".", ",")} km` : "";
}

function routeLabel(bar) {
  if (!bar.rankingMode) return "";
  const icon = bar.rankingMode === "walking" ? ICON_WALK : ICON_CAR;
  const distance = bar.rankingDistanceLabel || formatKm(bar.rankingDistanceKm);
  const title = bar.rankingMode === "walking" ? "a pé" : "de carro/Uber";
  return `<span class="rota-chip rota-chip--${bar.rankingMode}" title="${title}">${icon}${escapeHtml(bar.rankingDurationText)} · ${escapeHtml(distance)}</span>`;
}

function populateNeighborhoods() {
  const counts = {};
  for (const bar of allBars) {
    const n = bar.neighborhood || "Outro";
    counts[n] = (counts[n] || 0) + 1;
  }
  const select = $("filtro-bairro");
  Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .forEach(([name, count]) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name} (${count})`;
      select.appendChild(opt);
    });
}

function compareByDistance(a, b) {
  const ad = typeof a.rankingDistanceKm === "number" ? a.rankingDistanceKm : null;
  const bd = typeof b.rankingDistanceKm === "number" ? b.rankingDistanceKm : null;
  if (ad === null && bd === null) return a.name.localeCompare(b.name, "pt-BR");
  if (ad === null) return 1;
  if (bd === null) return -1;
  if (ad !== bd) return ad - bd;
  return (a.rankingMinutes ?? Infinity) - (b.rankingMinutes ?? Infinity) || a.name.localeCompare(b.name, "pt-BR");
}

const SORTERS = {
  distancia: compareByDistance,
  preco: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || compareByDistance(a, b),
  nome: (a, b) => a.name.localeCompare(b.name, "pt-BR"),
};

function render() {
  const term = normalize($("filtro-busca").value.trim());
  const band = PRICE_BANDS[$("filtro-preco").value];
  const neighborhood = $("filtro-bairro").value;
  const sorter = SORTERS[$("filtro-ordem").value] || compareByDistance;

  const bars = allBars
    .filter((bar) => {
      if (neighborhood && bar.neighborhood !== neighborhood) return false;
      if (band && !(typeof bar.price === "number" && band(bar.price))) return false;
      if (term) {
        const haystack = normalize(`${bar.name} ${bar.neighborhood} ${bar.dishName} ${bar.dishDescription} ${bar.displayAddress}`);
        if (!haystack.includes(term)) return false;
      }
      return true;
    })
    .sort(sorter);

  $("pratos-grid").innerHTML = bars.map((bar) => {
    const rank = bar.rank;
    const badgeClass = rank <= 3 ? `rank-badge--${rank}` : "rank-badge--n";
    return `
      <article class="prato-card">
        <a class="prato-card-foto" href="bar/${encodeURIComponent(bar.slug)}/">
          <img src="${escapeHtml(bar.photoUrl)}" alt="${escapeHtml(bar.dishName)}" loading="lazy">
          <span class="rank-badge ${badgeClass}" title="${rank}º mais perto">${rank}º</span>
        </a>
        <div class="prato-card-info">
          <p class="prato-card-bairro">${escapeHtml(bar.neighborhood)}</p>
          <h3 class="prato-card-bar"><a href="bar/${encodeURIComponent(bar.slug)}/">${escapeHtml(bar.name)}</a></h3>
          <p class="prato-card-nome">${escapeHtml(bar.dishName)}</p>
          <p class="prato-card-preco">${escapeHtml(bar.priceLabel)}${bar.portion ? ` <span>· ${escapeHtml(bar.portion)}</span>` : ""}</p>
          <p class="prato-card-desc">${escapeHtml(bar.dishDescription)}</p>
          ${routeLabel(bar)}
          <div class="prato-card-acoes">
            <a href="bar/${encodeURIComponent(bar.slug)}/" class="prato-card-link">Detalhes</a>
            <a href="${escapeHtml(bar.googleMapsUrl)}" target="_blank" rel="noopener" class="prato-card-link">Como chegar</a>
          </div>
        </div>
      </article>`;
  }).join("");

  $("contador-num").textContent = bars.length;
  $("contador-texto").textContent = bars.length === 1 ? "boteco encontrado" : "botecos encontrados";
  $("pratos-vazio").hidden = bars.length > 0;
}

function bindEvents() {
  $("filtro-busca").addEventListener("input", debounce(render, 200));
  ["filtro-ordem", "filtro-preco", "filtro-bairro"].forEach((id) => $(id).addEventListener("change", render));
  $("btn-limpar").addEventListener("click", () => {
    $("filtro-busca").value = "";
    $("filtro-preco").value = "";
    $("filtro-bairro").value = "";
    $("filtro-ordem").value = "distancia";
    render();
  });
}

async function init() {
  const resp = await fetch("data/bars-final.json");
  allBars = await resp.json();
  // Rank = position in the distance ranking, regardless of current sort/filter.
  [...allBars].sort(compareByDistance).forEach((bar, i) => { bar.rank = i + 1; });
  populateNeighborhoods();
  bindEvents();
  render();
}

init();
