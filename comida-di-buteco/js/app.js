let allBars = [];
let filteredBars = [];

function normalize(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function getSlug(bar) {
  if (!bar.comidaDeButecoUrl) return "";
  const match = bar.comidaDeButecoUrl.match(/\/buteco\/([^/]+)/);
  return match ? match[1] : "";
}

function formatKmLabel(value) {
  if (value === null || value === undefined) return "";
  return `${value.toFixed(1).replace(".", ",")} km`;
}

function getRankingDistanceKm(bar) {
  if (typeof bar.rankingDistanceKm === "number") return bar.rankingDistanceKm;
  if (typeof bar.distanceKm === "number") return bar.distanceKm;
  return null;
}

function getRankingLabel(bar) {
  if (bar.rankingDistanceLabel) {
    return bar.rankingDistanceLabel;
  }

  if (typeof bar.rankingDistanceKm === "number") {
    return formatKmLabel(bar.rankingDistanceKm);
  }

  if (typeof bar.distanceKm === "number") {
    return formatKmLabel(bar.distanceKm);
  }

  return "—";
}

function populateNeighborhoodFilter() {
  const counts = {};
  for (const bar of allBars) {
    const n = bar.neighborhood || "Outro";
    counts[n] = (counts[n] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));
  const select = document.getElementById("filter-neighborhood");
  for (const [name, count] of sorted) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (${count})`;
    select.appendChild(opt);
  }
}

function applyFiltersAndSort() {
  const searchRaw = document.getElementById("search").value;
  const searchTerm = normalize(searchRaw);
  const sortBy = document.getElementById("sort").value;
  const neighborhoodFilter = document.getElementById("filter-neighborhood").value;

  filteredBars = allBars.filter((bar) => {
    if (neighborhoodFilter && bar.neighborhood !== neighborhoodFilter) return false;
    if (searchTerm) {
      const haystack = normalize(
        `${bar.name} ${bar.neighborhood} ${bar.dishName} ${bar.address}`
      );
      if (!haystack.includes(searchTerm)) return false;
    }
    return true;
  });

  filteredBars.sort((a, b) => {
    if (sortBy === "distance") {
      const aDistance = getRankingDistanceKm(a);
      const bDistance = getRankingDistanceKm(b);
      if (aDistance === null && bDistance === null) return a.name.localeCompare(b.name, "pt-BR");
      if (aDistance === null) return 1;
      if (bDistance === null) return -1;
      if (aDistance !== bDistance) return aDistance - bDistance;

      const aMinutes = typeof a.rankingMinutes === "number" ? a.rankingMinutes : null;
      const bMinutes = typeof b.rankingMinutes === "number" ? b.rankingMinutes : null;
      if (aMinutes === null && bMinutes === null) return a.name.localeCompare(b.name, "pt-BR");
      if (aMinutes === null) return 1;
      if (bMinutes === null) return -1;
      if (aMinutes !== bMinutes) return aMinutes - bMinutes;

      return a.name.localeCompare(b.name, "pt-BR");
    }
    if (sortBy === "name") {
      return a.name.localeCompare(b.name, "pt-BR");
    }
    return 0;
  });

  renderGrid();

  document.getElementById("count").textContent =
    `${filteredBars.length} buteco${filteredBars.length !== 1 ? "s" : ""}`;

  document.getElementById("subtitle").textContent =
    `${filteredBars.length} Butecos para você visitar`;

  document.getElementById("empty-state").classList.toggle("d-none", filteredBars.length > 0);
}

function renderGrid() {
  const grid = document.getElementById("bars-grid");
  grid.innerHTML = "";

  for (const bar of filteredBars) {
    const distanceLabel = getRankingLabel(bar);
    const slug = getSlug(bar);
    const detailHref = slug ? `buteco/${slug}/` : bar.comidaDeButecoUrl;

    const col = document.createElement("div");
    col.className = "col-12 col-md-6 col-lg-4 mb-4";
    col.innerHTML = `
      <div class="item">
        <div class="image">
          <img src="${bar.photoUrl}" alt="${bar.name}" loading="lazy">
          <span class="distance-badge">${distanceLabel}</span>
        </div>
        <div class="caption">
          <h2>${bar.name}</h2>
          <p class="dish-name">${bar.dishName}</p>
          <p>${bar.address}</p>
          <div class="actions">
            <a href="${detailHref}">Detalhes</a>
            <a href="${bar.googleMapsUrl}" target="_blank" class="address">Como chegar</a>
          </div>
        </div>
      </div>
    `;
    grid.appendChild(col);
  }
}

function bindEvents() {
  document.getElementById("search").addEventListener("input", debounce(applyFiltersAndSort, 300));
  document.getElementById("sort").addEventListener("change", applyFiltersAndSort);
  document.getElementById("filter-neighborhood").addEventListener("change", applyFiltersAndSort);
}

async function init() {
  const resp = await fetch("data/bars-final.json");
  allBars = await resp.json();
  populateNeighborhoodFilter();
  applyFiltersAndSort();
  bindEvents();
}

init();
