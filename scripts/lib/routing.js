// Shared geocoding + Google Maps routing core used by every festival site.
// Each site calls createRouting({ dataDir, ... }) with its own data folder/caches.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_HOME_ADDRESS = "Rua do Bispo, 295, Rio Comprido, Rio de Janeiro, RJ, Brasil";
const DEFAULT_HOME_ROUTE_ORIGIN = "Rua do Bispo, 295 - Rio Comprido, Rio de Janeiro - RJ, 20261-067, Brasil";
const GOOGLE_MAPS_SEARCH_BASE = "https://www.google.com/maps/search/?api=1&query=";
const ROUTE_CACHE_VERSION = 1;
const WALKING_ROUTE_LIMIT_MINUTES = 20;
const ROUTE_LOOKUP_ATTEMPTS = 3;
const ROUTE_RETRY_DELAY_MS = 1200;
const ROUTE_PANEL_RECOVERY_WAIT_MS = 6000;
const ROUTE_FINAL_RECOVERY_WAIT_MS = 8000;
const DEFINITIVE_ROUTE_FAILURES = new Set([
  "Não foi possível calcular uma rota",
  "Nenhuma rota encontrada",
]);
const ROUTE_MODE_CONFIG = {
  walking: {
    travelMode: "walking",
    label: "a pé",
  },
  driving: {
    travelMode: "driving",
    label: "de carro/Uber",
  },
};
const GENERIC_PLACE_TOKENS = new Set([
  "bar",
  "boteco",
  "botequim",
  "restaurante",
  "gastrobar",
  "gastro",
  "pub",
  "cafe",
  "lanchonete",
  "chopp",
  "choperia",
  "de",
  "do",
  "da",
  "das",
  "dos",
  "e",
  "na",
  "no",
  "rio",
  "janeiro",
  "rj",
]);

function loadJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanAddressForGeocode(address) {
  return address
    .replace(/\|/g, ",")
    .replace(/–/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\bR\.\s/g, "Rua ")
    .replace(/\bAv\.\s/g, "Avenida ")
    .replace(/\bPça\.\s/g, "Praça ")
    .replace(/\bEst\.\s/g, "Estrada ")
    .replace(/\s*-\s*RJ\s*$/, ", RJ")
    .trim() + ", Brasil";
}

function isExactGoogleMapsUrl(url) {
  return typeof url === "string" && url.includes("/maps/place/");
}

function cleanAddressForMapsSearch(address) {
  return address
    .replace(/\|/g, ",")
    .replace(/–/g, "-")
    .replace(/\s*-\s*RJ\s*$/, ", RJ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextForComparison(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getMeaningfulNameTokens(name) {
  return normalizeTextForComparison(name)
    .split(" ")
    .filter((token) => token.length > 2 && !GENERIC_PLACE_TOKENS.has(token));
}

function getGoogleMapsPlaceLabel(url) {
  try {
    const pathname = new URL(url).pathname;
    const placeSegment = pathname.split("/place/")[1];
    if (!placeSegment) return "";
    return decodeURIComponent(placeSegment.split("/@")[0].replace(/\+/g, " "));
  } catch {
    return "";
  }
}

function doesGoogleMapsPlaceMatchBar(bar, resolvedUrl) {
  if (!isExactGoogleMapsUrl(resolvedUrl)) return false;

  const placeLabel = normalizeTextForComparison(getGoogleMapsPlaceLabel(resolvedUrl));
  const barTokens = getMeaningfulNameTokens(bar.name);
  if (!placeLabel || !barTokens.length) return false;

  return barTokens.some((token) => placeLabel.includes(token));
}

function parseDurationTextToMinutes(text) {
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  const hourMatch = normalized.match(/(\d+)\s*h/);
  const minuteMatch = normalized.match(/(\d+)\s*min/);

  if (!hourMatch && !minuteMatch) return null;

  const hours = hourMatch ? Number(hourMatch[1]) : 0;
  const minutes = minuteMatch ? Number(minuteMatch[1]) : 0;
  return hours * 60 + minutes;
}

function parseDistanceTextToKm(text) {
  if (!text) return null;

  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim().replace(",", ".");
  const kmMatch = normalized.match(/<?\s*([\d.]+)\s*km/);
  if (kmMatch) {
    return Math.round(Number(kmMatch[1]) * 100) / 100;
  }

  const meterMatch = normalized.match(/<?\s*([\d.]+)\s*m/);
  if (meterMatch) {
    return Math.round((Number(meterMatch[1]) / 1000) * 100) / 100;
  }

  return null;
}

function extractPrimaryRouteMetrics(text) {
  const segments = [];
  if (text.includes("Copiar link")) {
    segments.push(text.split("Copiar link").pop());
  }
  segments.push(text);

  for (const segment of segments) {
    const lines = segment
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const minutes = parseDurationTextToMinutes(lines[i]);
      if (minutes === null) continue;

      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const distanceKm = parseDistanceTextToKm(lines[j]);
        if (distanceKm === null) continue;

        const routeSummary = lines[j + 1] && lines[j + 1].toLowerCase().startsWith("via ")
          ? lines[j + 1]
          : "";

        return {
          durationText: lines[i],
          minutes,
          distanceLabel: lines[j],
          distanceKm,
          routeSummary,
        };
      }
    }
  }

  return null;
}

function getRouteFailureReason(text) {
  if (!text) return "Página vazia";
  if (text.includes("Não foi possível calcular uma rota")) return "Não foi possível calcular uma rota";
  if (text.includes("Nenhuma rota encontrada")) return "Nenhuma rota encontrada";
  if (text.includes("Antes de acessar o Google Maps")) return "Tela de consentimento do Google Maps";
  if (!text.includes("Copiar link") && !text.includes("Detalhes")) return "Painel de rotas não carregou";
  return "Métricas não reconhecidas";
}

function isDefinitiveRouteFailure(reason) {
  return DEFINITIVE_ROUTE_FAILURES.has(reason);
}

function isRouteModeResolved(metric, error) {
  return Boolean(metric || (error && isDefinitiveRouteFailure(error)));
}

function shouldRetryRouteEntry(entry) {
  return !["walking", "driving"].every((mode) => isRouteModeResolved(entry[mode], entry[`${mode}Error`]));
}

function assignModeRouteMetrics(bar, mode, metric) {
  const prefix = mode === "walking" ? "walking" : "driving";
  bar[`${prefix}Minutes`] = metric ? metric.minutes : null;
  bar[`${prefix}DurationText`] = metric ? metric.durationText : "";
  bar[`${prefix}DistanceKm`] = metric ? metric.distanceKm : null;
  bar[`${prefix}DistanceLabel`] = metric ? metric.distanceLabel : "";
  bar[`${prefix}RouteSummary`] = metric ? metric.routeSummary : "";
}

function applyHybridRanking(bar) {
  let selectedMode = null;

  if (bar.walkingMinutes !== null && bar.walkingMinutes <= WALKING_ROUTE_LIMIT_MINUTES) {
    selectedMode = "walking";
  } else if (bar.drivingMinutes !== null) {
    selectedMode = "driving";
  } else if (bar.walkingMinutes !== null) {
    selectedMode = "walking";
  }

  if (!selectedMode) {
    bar.rankingMode = "";
    bar.rankingMinutes = null;
    bar.rankingDurationText = "";
    bar.rankingDistanceKm = null;
    bar.rankingDistanceLabel = "";
    bar.rankingRouteSummary = "";
    bar.distanceKm = null;
    return;
  }

  const prefix = selectedMode === "walking" ? "walking" : "driving";
  bar.rankingMode = selectedMode;
  bar.rankingMinutes = bar[`${prefix}Minutes`];
  bar.rankingDurationText = bar[`${prefix}DurationText`];
  bar.rankingDistanceKm = bar[`${prefix}DistanceKm`];
  bar.rankingDistanceLabel = bar[`${prefix}DistanceLabel`];
  bar.rankingRouteSummary = bar[`${prefix}RouteSummary`];
  bar.distanceKm = bar.rankingDistanceKm;
}

function assignRouteMetricsFromCache(bar, entry) {
  assignModeRouteMetrics(bar, "walking", entry.walking || null);
  assignModeRouteMetrics(bar, "driving", entry.driving || null);
  applyHybridRanking(bar);
}

async function waitForDirectionsPanel(page) {
  await page.waitForFunction(() => {
    const text = document.body ? document.body.innerText : "";
    return (
      text.includes("Copiar link") ||
      text.includes("Detalhes") ||
      text.includes("Não foi possível calcular uma rota") ||
      text.includes("Nenhuma rota encontrada")
    );
  }, { timeout: 15000 }).catch(() => {});

  await page.waitForTimeout(750);
}

async function createGoogleMapsContext(browser) {
  const context = await browser.newContext({ locale: "pt-BR" });
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font"].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });
  return context;
}

function mergeRouteEntry(target, attemptEntry) {
  for (const mode of ["walking", "driving"]) {
    const errorKey = `${mode}Error`;

    if (attemptEntry[mode]) {
      target[mode] = attemptEntry[mode];
      target[errorKey] = "";
      continue;
    }

    if (target[mode]) continue;
    if (!attemptEntry[errorKey]) continue;

    if (!target[errorKey] || isDefinitiveRouteFailure(attemptEntry[errorKey])) {
      target[errorKey] = attemptEntry[errorKey];
    }
  }
}

function compareBarsByRanking(a, b) {
  if (a.rankingDistanceKm === null && b.rankingDistanceKm === null) {
    return a.name.localeCompare(b.name, "pt-BR");
  }
  if (a.rankingDistanceKm === null) return 1;
  if (b.rankingDistanceKm === null) return -1;
  if (a.rankingDistanceKm !== b.rankingDistanceKm) {
    return a.rankingDistanceKm - b.rankingDistanceKm;
  }

  if (a.rankingMinutes !== null && b.rankingMinutes !== null && a.rankingMinutes !== b.rankingMinutes) {
    return a.rankingMinutes - b.rankingMinutes;
  }

  return a.name.localeCompare(b.name, "pt-BR");
}

function formatDistanceKm(distanceKm) {
  if (distanceKm === null || distanceKm === undefined) return "";
  return `${distanceKm.toFixed(1).replace(".", ",")} km`;
}

function formatRankingDistance(bar) {
  if (bar.rankingDistanceLabel) return bar.rankingDistanceLabel;
  if (bar.rankingDistanceKm !== null) return formatDistanceKm(bar.rankingDistanceKm);
  return "";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function cleanAddressForMapsSearch(address) {
  return address
    .replace(/\|/g, ",")
    .replace(/–/g, "-")
    .replace(/\s*-\s*RJ\s*$/, ", RJ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMapsSearchQuery(bar) {
  return [bar.name, cleanAddressForMapsSearch(bar.address), bar.complement]
    .filter(Boolean)
    .join(" ");
}

function buildMapsSearchUrl(bar) {
  return `${GOOGLE_MAPS_SEARCH_BASE}${encodeURIComponent(buildMapsSearchQuery(bar))}`;
}

function buildRouteDestinationQuery(bar) {
  const placeLabel = getGoogleMapsPlaceLabel(bar.googleMapsUrl);
  return [
    placeLabel || bar.name,
    cleanAddressForMapsSearch(bar.address),
    bar.complement,
  ]
    .filter(Boolean)
    .join(", ");
}

function emptyRouteFields() {
  return {
    lat: null,
    lng: null,
    distanceKm: null,
    walkingMinutes: null,
    walkingDurationText: "",
    walkingDistanceKm: null,
    walkingDistanceLabel: "",
    walkingRouteSummary: "",
    drivingMinutes: null,
    drivingDurationText: "",
    drivingDistanceKm: null,
    drivingDistanceLabel: "",
    drivingRouteSummary: "",
    rankingMode: "",
    rankingMinutes: null,
    rankingDurationText: "",
    rankingDistanceKm: null,
    rankingDistanceLabel: "",
    rankingRouteSummary: "",
  };
}

async function createGoogleMapsContext(browser) {
  const context = await browser.newContext({ locale: "pt-BR" });
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font"].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });
  return context;
}

/**
 * @param {object} options
 * @param {string} options.dataDir           folder holding this site's caches
 * @param {(bar) => string} [options.getCacheKey]   key for maps/route caches
 * @param {string} [options.homeAddress]     address geocoded as "__HOME__"
 * @param {string} [options.homeRouteOrigin] origin used for Google Maps directions
 */
function createRouting(options) {
  const dataDir = options.dataDir;
  const homeAddress = options.homeAddress || DEFAULT_HOME_ADDRESS;
  const homeRouteOrigin = options.homeRouteOrigin || DEFAULT_HOME_ROUTE_ORIGIN;
  const getCacheKey = options.getCacheKey || ((bar) => `${bar.name}::${bar.address}`);

  const GEOCODE_CACHE_FILE = path.join(dataDir, "geocode-cache.json");
  const MAPS_CACHE_FILE = path.join(dataDir, "google-maps-cache.json");
  const ROUTE_CACHE_FILE = path.join(dataDir, "google-maps-route-cache.json");

  // --- Geocoding ---

  async function geocode(address) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=br`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "RioBarGuide-Builder/1.0" },
    });
    const data = await resp.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  }

  async function geocodeWithFallback(address, neighborhood) {
    let result = await geocode(cleanAddressForGeocode(address));
    if (result) return result;

    if (neighborhood) {
      result = await geocode(`${neighborhood}, Rio de Janeiro, RJ, Brasil`);
      if (result) return result;
    }
    return null;
  }

  async function geocodeBars(bars) {
    console.log("=== Geocoding ===\n");
    const cache = loadJsonFile(GEOCODE_CACHE_FILE, {});

    if (!cache["__HOME__"]) {
      console.log("Geocoding casa...");
      const homeCoords = await geocode(homeAddress);
      if (!homeCoords) {
        throw new Error("Nao conseguiu geocodar o endereco de casa");
      }
      cache["__HOME__"] = homeCoords;
      saveJsonFile(GEOCODE_CACHE_FILE, cache);
      await sleep(1100);
    }
    const home = cache["__HOME__"];
    console.log(`Casa: ${home.lat}, ${home.lng}\n`);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      const cacheKey = bar.name;

      if (cache[cacheKey]) {
        bar.lat = cache[cacheKey].lat;
        bar.lng = cache[cacheKey].lng;
        continue;
      }

      console.log(`[${i + 1}/${bars.length}] ${bar.name}`);
      const coords = await geocodeWithFallback(bar.address, bar.neighborhood);
      if (coords) {
        bar.lat = coords.lat;
        bar.lng = coords.lng;
        cache[cacheKey] = coords;
        console.log(`  ${coords.lat}, ${coords.lng}`);
      } else {
        console.log("  Nao encontrado");
      }
      saveJsonFile(GEOCODE_CACHE_FILE, cache);
      await sleep(1100);
    }
  }

  // --- Google Maps exact links ---

  async function resolveExactGoogleMapsUrl(page, bar) {
    const searchUrl = buildMapsSearchUrl(bar);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    let finalUrl = page.url();
    for (let attempt = 0; attempt < 16; attempt++) {
      if (isExactGoogleMapsUrl(finalUrl)) break;
      await page.waitForTimeout(500);
      finalUrl = page.url();
    }

    const exact = doesGoogleMapsPlaceMatchBar(bar, finalUrl);
    return {
      query: buildMapsSearchQuery(bar),
      searchUrl,
      resolvedUrl: exact ? finalUrl : bar.googleMapsUrl,
      exact,
    };
  }

  async function enrichGoogleMapsUrls(bars) {
    console.log("\n=== Resolvendo links exatos do Google Maps ===\n");

    // Bars without any link fall back to a plain Maps search URL.
    for (const bar of bars) {
      if (!bar.googleMapsUrl) bar.googleMapsUrl = buildMapsSearchUrl(bar);
    }

    const mapsCache = loadJsonFile(MAPS_CACHE_FILE, {});
    const saveMapsCache = () => saveJsonFile(MAPS_CACHE_FILE, mapsCache);
    let exactResolved = 0;
    let fallbackKept = 0;
    let fromCache = 0;

    const unresolvedBars = bars.filter((bar) => !isExactGoogleMapsUrl(bar.googleMapsUrl));
    if (!unresolvedBars.length) {
      console.log("Todos os bares ja possuem links exatos do Google Maps");
      return;
    }

    const barsToLookup = [];
    for (const bar of unresolvedBars) {
      const cacheKey = getCacheKey(bar);
      const cached = mapsCache[cacheKey];

      if (cached) {
        if (cached.exact && !doesGoogleMapsPlaceMatchBar(bar, cached.resolvedUrl)) {
          delete mapsCache[cacheKey];
          saveMapsCache();
        } else {
          bar.googleMapsUrl = cached.resolvedUrl;
          fromCache++;
          if (cached.exact) exactResolved++;
          else fallbackKept++;
          continue;
        }
      }
      barsToLookup.push(bar);
    }

    if (barsToLookup.length) {
      const browser = await chromium.launch({ headless: true });
      const context = await createGoogleMapsContext(browser);
      const page = await context.newPage();

      try {
        for (let i = 0; i < barsToLookup.length; i++) {
          const bar = barsToLookup[i];
          const cacheKey = getCacheKey(bar);

          console.log(`[${i + 1}/${barsToLookup.length}] ${bar.name}`);
          try {
            const result = await resolveExactGoogleMapsUrl(page, bar);
            bar.googleMapsUrl = result.resolvedUrl;
            mapsCache[cacheKey] = {
              query: result.query,
              searchUrl: result.searchUrl,
              resolvedUrl: result.resolvedUrl,
              exact: result.exact,
            };
            saveMapsCache();

            if (result.exact) {
              exactResolved++;
              console.log("  Link exato encontrado");
            } else {
              fallbackKept++;
              console.log("  Mantido link de busca");
            }
          } catch (err) {
            fallbackKept++;
            mapsCache[cacheKey] = {
              query: buildMapsSearchQuery(bar),
              searchUrl: buildMapsSearchUrl(bar),
              resolvedUrl: bar.googleMapsUrl,
              exact: false,
              error: err.message.split("\n")[0],
            };
            saveMapsCache();
            console.log(`  Mantido link de busca (${err.message.split("\n")[0]})`);
          }

          await page.waitForTimeout(500);
        }
      } finally {
        await context.close();
        await browser.close();
      }
    }

    console.log(`Links exatos: ${exactResolved}/${unresolvedBars.length}`);
    console.log(`Fallback mantido: ${fallbackKept}`);
    console.log(`Lidos do cache: ${fromCache}`);
  }

  // --- Google Maps route metrics ---

  function buildGoogleMapsDirectionsUrl(destinationQuery, mode) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(homeRouteOrigin)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=${ROUTE_MODE_CONFIG[mode].travelMode}`;
  }

  function createRouteCacheEntry(bar) {
    return {
      version: ROUTE_CACHE_VERSION,
      homeOrigin: homeRouteOrigin,
      googleMapsUrl: bar.googleMapsUrl,
      destinationQuery: buildRouteDestinationQuery(bar),
      walking: null,
      driving: null,
      walkingError: "",
      drivingError: "",
    };
  }

  function isRouteCacheEntryValid(entry, bar) {
    return Boolean(
      entry &&
      entry.version === ROUTE_CACHE_VERSION &&
      entry.homeOrigin === homeRouteOrigin &&
      entry.destinationQuery === buildRouteDestinationQuery(bar) &&
      entry.googleMapsUrl === bar.googleMapsUrl &&
      !shouldRetryRouteEntry(entry)
    );
  }

  async function readRouteMetric(page) {
    const bodyText = await page.locator("body").innerText();
    const metric = extractPrimaryRouteMetrics(bodyText);
    return { metric, error: metric ? "" : getRouteFailureReason(bodyText) };
  }

  async function resolveGoogleMapsRoute(page, bar, mode) {
    const destinationQuery = buildRouteDestinationQuery(bar);
    const directionsUrl = buildGoogleMapsDirectionsUrl(destinationQuery, mode);

    await page.goto(directionsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForDirectionsPanel(page);
    let result = await readRouteMetric(page);

    if (!result.metric && result.error === "Painel de rotas não carregou") {
      await page.waitForTimeout(ROUTE_PANEL_RECOVERY_WAIT_MS);
      result = await readRouteMetric(page);
    }

    if (!result.metric && result.error === "Painel de rotas não carregou") {
      await page.goto(directionsUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(ROUTE_FINAL_RECOVERY_WAIT_MS);
      result = await readRouteMetric(page);
    }

    return { destinationQuery, directionsUrl, ...result };
  }

  async function collectRouteMetricsForBar(browser, bar) {
    const mergedEntry = createRouteCacheEntry(bar);
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= ROUTE_LOOKUP_ATTEMPTS; attempt++) {
      attemptsUsed = attempt;
      const attemptEntry = createRouteCacheEntry(bar);
      const context = await createGoogleMapsContext(browser);
      const page = await context.newPage();

      try {
        for (const mode of ["walking", "driving"]) {
          try {
            const route = await resolveGoogleMapsRoute(page, bar, mode);
            if (route.metric) attemptEntry[mode] = route.metric;
            else attemptEntry[`${mode}Error`] = route.error;
          } catch (err) {
            attemptEntry[`${mode}Error`] = err.message.split("\n")[0];
          }
          await page.waitForTimeout(300);
        }
      } finally {
        await page.close().catch(() => {});
        await context.close();
      }

      mergeRouteEntry(mergedEntry, attemptEntry);
      if (!shouldRetryRouteEntry(mergedEntry)) break;
      if (attempt < ROUTE_LOOKUP_ATTEMPTS) await sleep(ROUTE_RETRY_DELAY_MS);
    }

    mergedEntry.attempts = attemptsUsed;
    return mergedEntry;
  }

  async function enrichRouteMetrics(bars) {
    console.log("\n=== Coletando rotas reais do Google Maps ===\n");

    const routeCache = loadJsonFile(ROUTE_CACHE_FILE, {});
    let fromCache = 0;
    const barsToLookup = [];

    for (const bar of bars) {
      const cached = routeCache[getCacheKey(bar)];
      if (isRouteCacheEntryValid(cached, bar)) {
        assignRouteMetricsFromCache(bar, cached);
        fromCache++;
        continue;
      }
      barsToLookup.push(bar);
    }

    if (barsToLookup.length) {
      const browser = await chromium.launch({ headless: true });
      try {
        for (let i = 0; i < barsToLookup.length; i++) {
          const bar = barsToLookup[i];
          console.log(`[${i + 1}/${barsToLookup.length}] ${bar.name}`);
          const entry = await collectRouteMetricsForBar(browser, bar);

          for (const mode of ["walking", "driving"]) {
            const label = mode === "walking" ? "A pé" : "Carro/Uber";
            if (entry[mode]) {
              console.log(`  ${label}: ${entry[mode].durationText} / ${entry[mode].distanceLabel}`);
            } else {
              const err = entry[`${mode}Error`];
              console.log(`  ${label}: sem rota confiável${err ? ` (${err})` : ""}`);
            }
          }
          if (entry.attempts > 1) console.log(`  Tentativas: ${entry.attempts}`);

          routeCache[getCacheKey(bar)] = entry;
          saveJsonFile(ROUTE_CACHE_FILE, routeCache);
          assignRouteMetricsFromCache(bar, entry);
        }
      } finally {
        await browser.close();
      }
    }

    console.log(`Ranking a pé: ${bars.filter((bar) => bar.rankingMode === "walking").length}`);
    console.log(`Ranking de carro/Uber: ${bars.filter((bar) => bar.rankingMode === "driving").length}`);
    console.log(`Sem rota principal: ${bars.filter((bar) => bar.rankingMinutes === null).length}`);
    console.log(`Lidos do cache: ${fromCache}`);
  }

  function printSummary(bars) {
    console.log("\n=== Resumo ===");
    const routed = bars.filter((bar) => bar.rankingDistanceKm !== null);
    const closest = routed[0];
    const farthest = routed[routed.length - 1];
    if (closest) console.log(`Mais perto: ${closest.name} (${closest.rankingDurationText}, ${formatRankingDistance(closest)})`);
    if (farthest) console.log(`Mais longe: ${farthest.name} (${farthest.rankingDurationText}, ${formatRankingDistance(farthest)})`);
    console.log(`Até ${WALKING_ROUTE_LIMIT_MINUTES} min a pé: ${bars.filter((bar) => bar.walkingMinutes !== null && bar.walkingMinutes <= WALKING_ROUTE_LIMIT_MINUTES).length} bares`);
    console.log(`Com carro/Uber no ranking: ${bars.filter((bar) => bar.rankingMode === "driving").length} bares`);
    console.log(`Sem rota principal: ${bars.length - routed.length} bares`);
  }

  /** Geocode, resolve Maps links, collect routes and sort bars in place. */
  async function rankBars(bars) {
    await geocodeBars(bars);
    await enrichGoogleMapsUrls(bars);
    await enrichRouteMetrics(bars);
    bars.sort(compareBarsByRanking);
    return bars;
  }

  return { geocodeBars, enrichGoogleMapsUrls, enrichRouteMetrics, rankBars, printSummary };
}

module.exports = {
  createRouting,
  emptyRouteFields,
  compareBarsByRanking,
  formatDistanceKm,
  formatRankingDistance,
  escapeHtml,
  saveJsonFile,
  loadJsonFile,
  WALKING_ROUTE_LIMIT_MINUTES,
};
