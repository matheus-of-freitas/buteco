const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const DATA_DIR = path.join(__dirname, "..", "data");
const RAW_FILE = path.join(DATA_DIR, "bars-raw.json");
const GEOCODE_CACHE_FILE = path.join(DATA_DIR, "geocode-cache.json");
const MAPS_CACHE_FILE = path.join(DATA_DIR, "google-maps-cache.json");
const ROUTE_CACHE_FILE = path.join(DATA_DIR, "google-maps-route-cache.json");
const OUTPUT_FILE = path.join(DATA_DIR, "bars-final.json");

const HOME_ADDRESS = "Rua do Bispo, 295, Rio Comprido, Rio de Janeiro, RJ, Brasil";
const HOME_ROUTE_ORIGIN = "Rua do Bispo, 295 - Rio Comprido, Rio de Janeiro - RJ, 20261-067, Brasil";
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

// --- Parsing ---

function parsePageContent(pageContent) {
  if (!pageContent) return {};

  // Split at "Endereço:" to separate dish block from details block
  const parts = pageContent.split(/\nEndereço:\s*\n/);
  if (parts.length < 2) return {};

  const dishBlock = parts[0];
  const detailsBlock = parts.slice(1).join("\nEndereço:\n");

  // Parse dish block: first non-empty line after ALL CAPS name = dish name, rest = description
  const dishLines = dishBlock
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Line 0 is the ALL CAPS bar name, skip it
  const dishName = dishLines[1] || "";
  const dishDescription = dishLines.slice(2).join(" ").trim();

  // Parse details block with regex
  const getField = (text, label) => {
    const regex = new RegExp(`${label}\\s*\\n([\\s\\S]*?)(?=\\n(?:Complemento|Telefone|Hor[aá]rio|$))`, "i");
    const match = text.match(regex);
    return match ? match[1].trim() : "";
  };

  const addressFromPage = detailsBlock.split("\n").filter(Boolean)[0] || "";

  const complementMatch = detailsBlock.match(/Complemento:\s*\n([\s\S]*?)(?=\n(?:Telefone|Hor[aá]rio))/i);
  const complement = complementMatch ? complementMatch[1].trim() : "";

  const phoneMatch = detailsBlock.match(/Telefone:\s*\n([\s\S]*?)(?=\n(?:Hor[aá]rio))/i);
  const phone = phoneMatch ? phoneMatch[1].trim() : "";

  const hoursMatch = detailsBlock.match(/Hor[aá]rio:\s*\n([\s\S]*?)$/i);
  const hours = hoursMatch ? hoursMatch[1].trim().replace(/\|\s*$/, "").trim() : "";

  // Extract neighborhood from address
  let neighborhood = "";
  const addrSource = addressFromPage || "";
  const pipeMatch = addrSource.match(/\|\s*([^,]+)/);
  if (pipeMatch) {
    neighborhood = pipeMatch[1].trim();
  }

  return {
    dishName,
    dishDescription,
    addressFromPage,
    complement,
    phone,
    hours,
    neighborhood,
  };
}

// --- Cache helpers ---

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

// --- Geocoding ---

function loadGeocodeCache() {
  return loadJsonFile(GEOCODE_CACHE_FILE, {});
}

function saveGeocodeCache(cache) {
  saveJsonFile(GEOCODE_CACHE_FILE, cache);
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

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=br`;

  const resp = await fetch(url, {
    headers: { "User-Agent": "ComidaDiButeco2026-Builder/1.0" },
  });
  const data = await resp.json();

  if (data.length > 0) {
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }
  return null;
}

async function geocodeWithFallback(address, neighborhood) {
  const cleaned = cleanAddressForGeocode(address);
  let result = await geocode(cleaned);
  if (result) return result;

  // Fallback: just neighborhood + city
  if (neighborhood) {
    const fallback = `${neighborhood}, Rio de Janeiro, RJ, Brasil`;
    result = await geocode(fallback);
    if (result) return result;
  }

  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Google Maps exact links ---

function loadMapsCache() {
  return loadJsonFile(MAPS_CACHE_FILE, {});
}

function saveMapsCache(cache) {
  saveJsonFile(MAPS_CACHE_FILE, cache);
}

function loadRouteCache() {
  return loadJsonFile(ROUTE_CACHE_FILE, {});
}

function saveRouteCache(cache) {
  saveJsonFile(ROUTE_CACHE_FILE, cache);
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

function buildMapsSearchQuery(bar) {
  return [bar.name, cleanAddressForMapsSearch(bar.address), bar.complement]
    .filter(Boolean)
    .join(" ");
}

function buildMapsSearchUrl(bar) {
  return `${GOOGLE_MAPS_SEARCH_BASE}${encodeURIComponent(buildMapsSearchQuery(bar))}`;
}

function getMapsCacheKey(bar) {
  return getSlug(bar.comidaDeButecoUrl) || `${bar.name}::${bar.address}`;
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

async function resolveExactGoogleMapsUrl(page, bar) {
  const searchUrl = buildMapsSearchUrl(bar);

  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

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

  const mapsCache = loadMapsCache();
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
    const cacheKey = getMapsCacheKey(bar);
    const cached = mapsCache[cacheKey];

    if (cached) {
      if (cached.exact && !doesGoogleMapsPlaceMatchBar(bar, cached.resolvedUrl)) {
        delete mapsCache[cacheKey];
        saveMapsCache(mapsCache);
      } else {
        bar.googleMapsUrl = cached.resolvedUrl;
        fromCache++;
        if (cached.exact) {
          exactResolved++;
        } else {
          fallbackKept++;
        }
        continue;
      }
    }

    barsToLookup.push(bar);
  }

  if (!barsToLookup.length) {
    console.log(`Links exatos: ${exactResolved}/${unresolvedBars.length}`);
    console.log(`Fallback mantido: ${fallbackKept}`);
    console.log(`Lidos do cache: ${fromCache}`);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "pt-BR" });
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font"].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();

  try {
    for (let i = 0; i < barsToLookup.length; i++) {
      const bar = barsToLookup[i];
      const cacheKey = getMapsCacheKey(bar);

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
        saveMapsCache(mapsCache);

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
        saveMapsCache(mapsCache);
        console.log(`  Mantido link de busca (${err.message.split("\n")[0]})`);
      }

      await page.waitForTimeout(500);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`Links exatos: ${exactResolved}/${unresolvedBars.length}`);
  console.log(`Fallback mantido: ${fallbackKept}`);
  console.log(`Lidos do cache: ${fromCache}`);
}

// --- Google Maps route metrics ---

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

function buildGoogleMapsDirectionsUrl(destinationQuery, mode) {
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(HOME_ROUTE_ORIGIN)}&destination=${encodeURIComponent(destinationQuery)}&travelmode=${ROUTE_MODE_CONFIG[mode].travelMode}`;
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

function createRouteCacheEntry(bar) {
  return {
    version: ROUTE_CACHE_VERSION,
    homeOrigin: HOME_ROUTE_ORIGIN,
    googleMapsUrl: bar.googleMapsUrl,
    destinationQuery: buildRouteDestinationQuery(bar),
    walking: null,
    driving: null,
    walkingError: "",
    drivingError: "",
  };
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

function isRouteCacheEntryValid(entry, bar) {
  return Boolean(
    entry &&
    entry.version === ROUTE_CACHE_VERSION &&
    entry.homeOrigin === HOME_ROUTE_ORIGIN &&
    entry.destinationQuery === buildRouteDestinationQuery(bar) &&
    entry.googleMapsUrl === bar.googleMapsUrl &&
    !shouldRetryRouteEntry(entry)
  );
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

async function resolveGoogleMapsRoute(page, bar, mode) {
  const destinationQuery = buildRouteDestinationQuery(bar);
  const directionsUrl = buildGoogleMapsDirectionsUrl(destinationQuery, mode);

  await page.goto(directionsUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await waitForDirectionsPanel(page);
  let bodyText = await page.locator("body").innerText();
  let metric = extractPrimaryRouteMetrics(bodyText);
  let error = metric ? "" : getRouteFailureReason(bodyText);

  if (!metric && error === "Painel de rotas não carregou") {
    await page.waitForTimeout(ROUTE_PANEL_RECOVERY_WAIT_MS);
    bodyText = await page.locator("body").innerText();
    metric = extractPrimaryRouteMetrics(bodyText);
    error = metric ? "" : getRouteFailureReason(bodyText);
  }

  if (!metric && error === "Painel de rotas não carregou") {
    await page.goto(directionsUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(ROUTE_FINAL_RECOVERY_WAIT_MS);
    bodyText = await page.locator("body").innerText();
    metric = extractPrimaryRouteMetrics(bodyText);
    error = metric ? "" : getRouteFailureReason(bodyText);
  }

  return {
    destinationQuery,
    directionsUrl,
    metric,
    error,
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

async function collectRouteMetricsForBar(browser, bar) {
  const mergedEntry = createRouteCacheEntry(bar);
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= ROUTE_LOOKUP_ATTEMPTS; attempt++) {
    attemptsUsed = attempt;
    const attemptEntry = createRouteCacheEntry(bar);
    const context = await createGoogleMapsContext(browser);
    const page = await context.newPage();

    try {
      try {
        const walking = await resolveGoogleMapsRoute(page, bar, "walking");
        if (walking.metric) {
          attemptEntry.walking = walking.metric;
        } else {
          attemptEntry.walkingError = walking.error;
        }
      } catch (err) {
        attemptEntry.walkingError = err.message.split("\n")[0];
      }

      await page.waitForTimeout(300);

      try {
        const driving = await resolveGoogleMapsRoute(page, bar, "driving");
        if (driving.metric) {
          attemptEntry.driving = driving.metric;
        } else {
          attemptEntry.drivingError = driving.error;
        }
      } catch (err) {
        attemptEntry.drivingError = err.message.split("\n")[0];
      }
    } finally {
      await page.close().catch(() => {});
      await context.close();
    }

    mergeRouteEntry(mergedEntry, attemptEntry);

    if (!shouldRetryRouteEntry(mergedEntry)) {
      break;
    }

    if (attempt < ROUTE_LOOKUP_ATTEMPTS) {
      await sleep(ROUTE_RETRY_DELAY_MS);
    }
  }

  mergedEntry.attempts = attemptsUsed;
  return mergedEntry;
}

async function enrichRouteMetrics(bars) {
  console.log("\n=== Coletando rotas reais do Google Maps ===\n");

  const routeCache = loadRouteCache();
  let fromCache = 0;
  const barsToLookup = [];

  for (const bar of bars) {
    const cacheKey = getMapsCacheKey(bar);
    const cached = routeCache[cacheKey];

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
        const cacheKey = getMapsCacheKey(bar);

        console.log(`[${i + 1}/${barsToLookup.length}] ${bar.name}`);
        const entry = await collectRouteMetricsForBar(browser, bar);

        if (entry.walking) {
          console.log(`  A pé: ${entry.walking.durationText} / ${entry.walking.distanceLabel}`);
        } else if (entry.walkingError) {
          console.log(`  A pé: sem rota confiável (${entry.walkingError})`);
        } else {
          console.log("  A pé: sem rota confiável");
        }

        if (entry.driving) {
          console.log(`  Carro/Uber: ${entry.driving.durationText} / ${entry.driving.distanceLabel}`);
        } else if (entry.drivingError) {
          console.log(`  Carro/Uber: sem rota confiável (${entry.drivingError})`);
        } else {
          console.log("  Carro/Uber: sem rota confiável");
        }

        if (entry.attempts > 1) {
          console.log(`  Tentativas: ${entry.attempts}`);
        }

        routeCache[cacheKey] = entry;
        saveRouteCache(routeCache);
        assignRouteMetricsFromCache(bar, entry);
      }
    } finally {
      await browser.close();
    }
  }

  const walkingRanked = bars.filter((bar) => bar.rankingMode === "walking").length;
  const drivingRanked = bars.filter((bar) => bar.rankingMode === "driving").length;
  const unrouted = bars.filter((bar) => bar.rankingMinutes === null).length;

  console.log(`Ranking a pé: ${walkingRanked}`);
  console.log(`Ranking de carro/Uber: ${drivingRanked}`);
  console.log(`Sem rota principal: ${unrouted}`);
  console.log(`Lidos do cache: ${fromCache}`);
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

// --- Main ---

async function main() {
  const rawBars = JSON.parse(fs.readFileSync(RAW_FILE, "utf-8"));
  console.log(`Processando ${rawBars.length} bares...\n`);

  // Step 1: Parse all pageContent
  console.log("=== Parsing pageContent ===\n");
  const parsedBars = rawBars.map((bar) => {
    const parsed = parsePageContent(bar.pageContent);
    // Fallback neighborhood from listing address
    if (!parsed.neighborhood && bar.address) {
      const pipeMatch = bar.address.match(/\|\s*([^,]+)/);
      if (pipeMatch) parsed.neighborhood = pipeMatch[1].trim();
    }

    return {
      name: bar.name,
      neighborhood: parsed.neighborhood || "",
      address: parsed.addressFromPage || bar.address || "",
      complement: parsed.complement || "",
      dishName: parsed.dishName || "",
      dishDescription: parsed.dishDescription || "",
      phone: parsed.phone || "",
      hours: parsed.hours || "",
      comidaDeButecoUrl: bar.comidaDeButecoUrl || "",
      googleMapsUrl: bar.googleMapsUrl || "",
      photoUrl: bar.photoUrl || "",
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
      googleRating: null,
      price: "R$ 40,00",
    };
  });

  // Verify parsing
  const missingDish = parsedBars.filter((b) => !b.dishName).map((b) => b.name);
  const missingPhone = parsedBars.filter((b) => !b.phone).map((b) => b.name);
  if (missingDish.length) console.log("Sem prato:", missingDish);
  if (missingPhone.length) console.log("Sem telefone:", missingPhone);
  console.log(`Parsing OK: ${parsedBars.length} bares\n`);

  // Step 2: Geocode
  console.log("=== Geocoding ===\n");
  const cache = loadGeocodeCache();

  // Geocode home address
  if (!cache["__HOME__"]) {
    console.log("Geocoding casa...");
      const homeCoords = await geocode(HOME_ADDRESS);
      if (homeCoords) {
        cache["__HOME__"] = homeCoords;
        saveGeocodeCache(cache);
        console.log(`  Casa: ${homeCoords.lat}, ${homeCoords.lng}`);
      } else {
      console.error("ERRO: nao conseguiu geocodar o endereco de casa!");
      process.exit(1);
    }
    await sleep(1100);
  }
  const home = cache["__HOME__"];
  console.log(`Casa: ${home.lat}, ${home.lng}\n`);

  // Geocode bars
  for (let i = 0; i < parsedBars.length; i++) {
    const bar = parsedBars[i];
    const cacheKey = bar.name;

    if (cache[cacheKey]) {
      bar.lat = cache[cacheKey].lat;
      bar.lng = cache[cacheKey].lng;
      continue;
    }

    console.log(`[${i + 1}/${parsedBars.length}] ${bar.name}`);
    const coords = await geocodeWithFallback(bar.address, bar.neighborhood);
    if (coords) {
      bar.lat = coords.lat;
      bar.lng = coords.lng;
      cache[cacheKey] = coords;
      console.log(`  ${coords.lat}, ${coords.lng}`);
    } else {
      console.log("  Nao encontrado");
    }
    saveGeocodeCache(cache);
    await sleep(1100);
  }

  // Step 3: Resolve exact Google Maps pages
  await enrichGoogleMapsUrls(parsedBars);

  // Step 4: Resolve route metrics and hybrid ranking
  await enrichRouteMetrics(parsedBars);

  // Sort by main route distance (nulls at end)
  parsedBars.sort(compareBarsByRanking);

  // Use smaller photo URLs (768w instead of full size)
  for (const bar of parsedBars) {
    if (bar.photoUrl && bar.photoUrl.includes("-scaled.")) {
      bar.photoUrl = bar.photoUrl.replace("-scaled.", "-768x512.");
    }
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(parsedBars, null, 2), "utf-8");
  console.log(`\nSalvo: ${OUTPUT_FILE} (${parsedBars.length} bares)`);

  // Step 5: Generate individual bar pages
  console.log("\n=== Gerando paginas individuais ===\n");
  const BUTECO_DIR = path.join(__dirname, "..", "buteco");
  let generated = 0;

  for (const bar of parsedBars) {
    const slug = getSlug(bar.comidaDeButecoUrl);
    if (!slug) continue;

    const dir = path.join(BUTECO_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), generateBarPage(bar), "utf-8");
    generated++;
  }
  console.log(`${generated} paginas geradas em buteco/`);

  // Summary
  console.log("\n=== Resumo ===");
  const closest = parsedBars.find((bar) => bar.rankingDistanceKm !== null);
  const farthest = [...parsedBars].reverse().find((bar) => bar.rankingDistanceKm !== null);
  if (closest) {
    console.log(`Mais perto: ${closest.name} (${closest.rankingDurationText}, ${formatRankingDistance(closest)})`);
  }
  if (farthest) {
    console.log(`Mais longe: ${farthest.name} (${farthest.rankingDurationText}, ${formatRankingDistance(farthest)})`);
  }
  console.log(`Até ${WALKING_ROUTE_LIMIT_MINUTES} min a pé: ${parsedBars.filter((bar) => bar.walkingMinutes !== null && bar.walkingMinutes <= WALKING_ROUTE_LIMIT_MINUTES).length} bares`);
  console.log(`Com carro/Uber no ranking: ${parsedBars.filter((bar) => bar.rankingMode === "driving").length} bares`);
  console.log(`Sem rota principal: ${parsedBars.filter((bar) => bar.rankingDistanceKm === null).length} bares`);
}

function getSlug(url) {
  if (!url) return "";
  const match = url.match(/\/buteco\/([^/]+)/);
  return match ? match[1] : "";
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

function formatHoursHtml(hours) {
  if (!hours) return "";
  return hours.split("|").map(d => d.trim()).filter(Boolean).map(d => `<li>${escapeHtml(d)}</li>`).join("");
}

function formatPhoneHtml(phone) {
  if (!phone) return "";
  return phone.split("|").map(p => p.trim()).filter(Boolean).map(p => {
    const digits = p.replace(/\D/g, "");
    return `<a href="tel:+55${digits}">${escapeHtml(p)}</a>`;
  }).join(" | ");
}

function generateBarPage(bar) {
  const distanceText = formatRankingDistance(bar);
  const addressLine = [bar.address, bar.complement].filter(Boolean).join(" — ");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bar.name)} — Comida di Buteco 2026</title>
  <link rel="icon" href="https://cdb-static-files.s3.amazonaws.com/wp-content/uploads/2022/03/25112702/logo-comida-di-buteco-150x150.webp" sizes="32x32">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" rel="stylesheet">
  <link href="../../css/style.css" rel="stylesheet">
</head>
<body class="single single-buteco">
  <header id="header">
    <section class="header-top">
      <div class="container">
        <div class="row">
          <div class="d-flex justify-content-between align-items-center">
            <div class="logo d-flex align-items-center">
              <a href="../../" class="custom-logo-link" rel="home" role="link"><img width="325" height="235" src="https://cdb-static-files.s3.amazonaws.com/wp-content/uploads/2022/03/25112702/logo-comida-di-buteco.webp" class="custom-logo" alt="Comida di Buteco"></a><a href="../../" role="link"></a><p>O maior concurso de butecos do Brasil!</p>
            </div>
            <aside class="widget widget_text">
              <div class="textwidget"><div class="banner">O maior concurso de butecos do Brasil!</div></div>
            </aside>
            <aside class="widget widget_widget_social_network">
              <div class="widget-social">
                <p class="widget-title">Acompanhe</p>
                <ul class="social-networks-widget">
                  <li><a href="http://www.facebook.com/comidadibuteco" title="Facebook" target="_blank" class="facebook" role="link"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12 2C6.5 2 2 6.5 2 12c0 5 3.7 9.1 8.4 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7C18.3 21.1 22 17 22 12c0-5.5-4.5-10-10-10z"></path></svg></span><span class="text">Facebook</span></a></li>
                  <li><a href="http://www.instagr.am/_comidadibuteco" title="Instagram" target="_blank" class="instagram" role="link"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M12,4.622c2.403,0,2.688,0.009,3.637,0.052c0.877,0.04,1.354,0.187,1.671,0.31c0.42,0.163,0.72,0.358,1.035,0.673 c0.315,0.315,0.51,0.615,0.673,1.035c0.123,0.317,0.27,0.794,0.31,1.671c0.043,0.949,0.052,1.234,0.052,3.637 s-0.009,2.688-0.052,3.637c-0.04,0.877-0.187,1.354-0.31,1.671c-0.163,0.42-0.358,0.72-0.673,1.035 c-0.315,0.315-0.615,0.51-1.035,0.673c-0.317,0.123-0.794,0.27-1.671,0.31c-0.949,0.043-1.233,0.052-3.637,0.052 s-2.688-0.009-3.637-0.052c-0.877-0.04-1.354-0.187-1.671-0.31c-0.42-0.163-0.72-0.358-1.035-0.673 c-0.315-0.315-0.51-0.615-0.673-1.035c-0.123-0.317-0.27-0.794-0.31-1.671C4.631,14.688,4.622,14.403,4.622,12 s0.009-2.688,0.052-3.637c0.04-0.877,0.187-1.354,0.31-1.671c0.163-0.42,0.358-0.72,0.673-1.035 c0.315-0.315,0.615-0.51,1.035-0.673c0.317-0.123,0.794-0.27,1.671-0.31C9.312,4.631,9.597,4.622,12,4.622 M12,3 C9.556,3,9.249,3.01,8.289,3.054C7.331,3.098,6.677,3.25,6.105,3.472C5.513,3.702,5.011,4.01,4.511,4.511 c-0.5,0.5-0.808,1.002-1.038,1.594C3.25,6.677,3.098,7.331,3.054,8.289C3.01,9.249,3,9.556,3,12c0,2.444,0.01,2.751,0.054,3.711 c0.044,0.958,0.196,1.612,0.418,2.185c0.23,0.592,0.538,1.094,1.038,1.594c0.5,0.5,1.002,0.808,1.594,1.038 c0.572,0.222,1.227,0.375,2.185,0.418C9.249,20.99,9.556,21,12,21s2.751-0.01,3.711-0.054c0.958-0.044,1.612-0.196,2.185-0.418 c0.592-0.23,1.094-0.538,1.594-1.038c0.5-0.5,0.808-1.002,1.038-1.594c0.222-0.572,0.375-1.227,0.418-2.185 C20.99,14.751,21,14.444,21,12s-0.01-2.751-0.054-3.711c-0.044-0.958-0.196-1.612-0.418-2.185c-0.23-0.592-0.538-1.094-1.038-1.594 c-0.5-0.5-1.002-0.808-1.594-1.038c-0.572-0.222-1.227-0.375-2.185-0.418C14.751,3.01,14.444,3,12,3L12,3z M12,7.378 c-2.552,0-4.622,2.069-4.622,4.622S9.448,16.622,12,16.622s4.622-2.069,4.622-4.622S14.552,7.378,12,7.378z M12,15 c-1.657,0-3-1.343-3-3s1.343-3,3-3s3,1.343,3,3S13.657,15,12,15z M16.804,6.116c-0.596,0-1.08,0.484-1.08,1.08 s0.484,1.08,1.08,1.08c0.596,0,1.08-0.484,1.08-1.08S17.401,6.116,16.804,6.116z"></path></svg></span><span class="text">Instagram</span></a></li>
                  <li><a href="http://www.twitter.com/_comidadibuteco" title="Twitter" target="_blank" class="twitter" role="link"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M13.982 10.622 20.54 3h-1.554l-5.693 6.618L8.745 3H3.5l6.876 10.007L3.5 21h1.554l6.012-6.989L15.868 21h5.245l-7.131-10.378Zm-2.128 2.474-.697-.997-5.543-7.93H8l4.474 6.4.697.996 5.815 8.318h-2.387l-4.745-6.787Z"></path></svg></span><span class="text">Twitter</span></a></li>
                  <li><a href="https://www.youtube.com/user/canaldocomida" title="Youtube" target="_blank" class="youtube" role="link"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><path d="M21.8,8.001c0,0-0.195-1.378-0.795-1.985c-0.76-0.797-1.613-0.801-2.004-0.847c-2.799-0.202-6.997-0.202-6.997-0.202 h-0.009c0,0-4.198,0-6.997,0.202C4.608,5.216,3.756,5.22,2.995,6.016C2.395,6.623,2.2,8.001,2.2,8.001S2,9.62,2,11.238v1.517 c0,1.618,0.2,3.237,0.2,3.237s0.195,1.378,0.795,1.985c0.761,0.797,1.76,0.771,2.205,0.855c1.6,0.153,6.8,0.201,6.8,0.201 s4.203-0.006,7.001-0.209c0.391-0.047,1.243-0.051,2.004-0.847c0.6-0.607,0.795-1.985,0.795-1.985s0.2-1.618,0.2-3.237v-1.517 C22,9.62,21.8,8.001,21.8,8.001z M9.935,14.594l-0.001-5.62l5.404,2.82L9.935,14.594z"></path></svg></span><span class="text">Youtube</span></a></li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  </header>

  <main class="single-buteco-wrap">
    <div class="container">
      <a href="../../" class="btn-back"><i class="bi bi-arrow-left"></i> Voltar para a lista</a>
      <article class="buteco-detail">
        <div class="detail-photo-wrap">
          <img src="${escapeHtml(bar.photoUrl)}" alt="${escapeHtml(bar.name)}" class="detail-photo">
        </div>
        <div class="detail-body">
          <h1 class="section-title">${escapeHtml(bar.name)}</h1>
          <strong>${escapeHtml(bar.dishName)}</strong>
          <p class="dish-desc">${escapeHtml(bar.dishDescription)}</p>
          <div class="detail-meta">
            <span class="price-tag">${escapeHtml(bar.price)}</span>
            ${distanceText ? `<span class="distance-tag">${escapeHtml(distanceText)}</span>` : ""}
          </div>

          <div class="detail-grid">
            <div class="detail-row">
              <i class="bi bi-geo-alt-fill"></i>
              <span>${escapeHtml(addressLine)}</span>
            </div>

            <div class="detail-row">
              <i class="bi bi-telephone-fill"></i>
              <span>${formatPhoneHtml(bar.phone)}</span>
            </div>

            <div class="detail-row">
              <i class="bi bi-clock-fill"></i>
              <div><ul class="hours-list">${formatHoursHtml(bar.hours)}</ul></div>
            </div>
          </div>

          <div class="detail-actions">
            <a href="${escapeHtml(bar.comidaDeButecoUrl)}" target="_blank" class="btn btn-buteco">
              <i class="bi bi-link-45deg"></i> Ver no Comida di Buteco
            </a>
            <a href="${escapeHtml(bar.googleMapsUrl)}" target="_blank" class="btn btn-maps">
              <i class="bi bi-map-fill"></i> Abrir no Google Maps
            </a>
          </div>
        </div>
      </article>
    </div>
  </main>

  <footer id="footer">
    <div class="footer-top">
      <div class="container">
        <div class="row">
          <div class="col-12 col-md-4 column-1 d-flex flex-column align-items-center align-items-md-start">
            <div class="widget widget_text">
              <a href="https://comidadibuteco.com.br/" target="_blank"><img src="https://cdb-static-files.s3.amazonaws.com/wp-content/uploads/2022/03/25112702/logo-comida-di-buteco.webp" alt="Comida di Buteco" width="171" height="124"></a>
              <p class="mt-2">O maior concurso de<br>butecos do Brasil!</p>
              <a href="https://comidadibuteco.com.br/mecanica-e-calendario/" target="_blank">Veja como funciona</a>
            </div>
          </div>
          <div class="col-12 col-md-4 text-center py-3">
            <p class="footer-note">Dados do <a href="https://comidadibuteco.com.br/butecos/rio-de-janeiro/" target="_blank">Comida di Buteco 2026</a>.<br>Rotas reais a partir da Rua do Bispo, 295.</p>
          </div>
          <div class="col-12 col-md-4">
            <div class="widget-social widget-social-footer">
              <p class="widget-title">Acompanhe nossas redes sociais</p>
              <ul class="social-networks-widget">
                <li><a href="http://www.facebook.com/comidadibuteco" title="Facebook" target="_blank" class="facebook"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 2C6.5 2 2 6.5 2 12c0 5 3.7 9.1 8.4 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.3v7C18.3 21.1 22 17 22 12c0-5.5-4.5-10-10-10z"></path></svg></span><span class="text">Facebook</span></a></li>
                <li><a href="http://www.instagr.am/_comidadibuteco" title="Instagram" target="_blank" class="instagram"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12,4.622c2.403,0,2.688,0.009,3.637,0.052c0.877,0.04,1.354,0.187,1.671,0.31c0.42,0.163,0.72,0.358,1.035,0.673c0.315,0.315,0.51,0.615,0.673,1.035c0.123,0.317,0.27,0.794,0.31,1.671c0.043,0.949,0.052,1.234,0.052,3.637s-0.009,2.688-0.052,3.637c-0.04,0.877-0.187,1.354-0.31,1.671c-0.163,0.42-0.358,0.72-0.673,1.035c-0.315,0.315-0.615,0.51-1.035,0.673c-0.317,0.123-0.794,0.27-1.671,0.31c-0.949,0.043-1.233,0.052-3.637,0.052s-2.688-0.009-3.637-0.052c-0.877-0.04-1.354-0.187-1.671-0.31c-0.42-0.163-0.72-0.358-1.035-0.673c-0.315-0.315-0.51-0.615-0.673-1.035c-0.123-0.317-0.27-0.794-0.31-1.671C4.631,14.688,4.622,14.403,4.622,12s0.009-2.688,0.052-3.637c0.04-0.877,0.187-1.354,0.31-1.671c0.163-0.42,0.358-0.72,0.673-1.035c0.315-0.315,0.615-0.51,1.035-0.673c0.317-0.123,0.794-0.27,1.671-0.31C9.312,4.631,9.597,4.622,12,4.622 M12,3C9.556,3,9.249,3.01,8.289,3.054C7.331,3.098,6.677,3.25,6.105,3.472C5.513,3.702,5.011,4.01,4.511,4.511c-0.5,0.5-0.808,1.002-1.038,1.594C3.25,6.677,3.098,7.331,3.054,8.289C3.01,9.249,3,9.556,3,12c0,2.444,0.01,2.751,0.054,3.711c0.044,0.958,0.196,1.612,0.418,2.185c0.23,0.592,0.538,1.094,1.038,1.594c0.5,0.5,1.002,0.808,1.594,1.038c0.572,0.222,1.227,0.375,2.185,0.418C9.249,20.99,9.556,21,12,21s2.751-0.01,3.711-0.054c0.958-0.044,1.612-0.196,2.185-0.418c0.592-0.23,1.094-0.538,1.594-1.038c0.5-0.5,0.808-1.002,1.038-1.594c0.222-0.572,0.375-1.227,0.418-2.185C20.99,14.751,21,14.444,21,12s-0.01-2.751-0.054-3.711c-0.044-0.958-0.196-1.612-0.418-2.185c-0.23-0.592-0.538-1.094-1.038-1.594c-0.5-0.5-1.002-0.808-1.594-1.038c-0.572-0.222-1.227-0.375-2.185-0.418C14.751,3.01,14.444,3,12,3L12,3z M12,7.378c-2.552,0-4.622,2.069-4.622,4.622S9.448,16.622,12,16.622s4.622-2.069,4.622-4.622S14.552,7.378,12,7.378z M12,15c-1.657,0-3-1.343-3-3s1.343-3,3-3s3,1.343,3,3S13.657,15,12,15z M16.804,6.116c-0.596,0-1.08,0.484-1.08,1.08s0.484,1.08,1.08,1.08c0.596,0,1.08-0.484,1.08-1.08S17.401,6.116,16.804,6.116z"></path></svg></span><span class="text">Instagram</span></a></li>
                <li><a href="http://www.twitter.com/_comidadibuteco" title="Twitter" target="_blank" class="twitter"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M13.982 10.622 20.54 3h-1.554l-5.693 6.618L8.745 3H3.5l6.876 10.007L3.5 21h1.554l6.012-6.989L15.868 21h5.245l-7.131-10.378Zm-2.128 2.474-.697-.997-5.543-7.93H8l4.474 6.4.697.996 5.815 8.318h-2.387l-4.745-6.787Z"></path></svg></span><span class="text">Twitter</span></a></li>
                <li><a href="https://www.youtube.com/user/canaldocomida" title="Youtube" target="_blank" class="youtube"><span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M21.8,8.001c0,0-0.195-1.378-0.795-1.985c-0.76-0.797-1.613-0.801-2.004-0.847c-2.799-0.202-6.997-0.202-6.997-0.202h-0.009c0,0-4.198,0-6.997,0.202C4.608,5.216,3.756,5.22,2.995,6.016C2.395,6.623,2.2,8.001,2.2,8.001S2,9.62,2,11.238v1.517c0,1.618,0.2,3.237,0.2,3.237s0.195,1.378,0.795,1.985c0.761,0.797,1.76,0.771,2.205,0.855c1.6,0.153,6.8,0.201,6.8,0.201s4.203-0.006,7.001-0.209c0.391-0.047,1.243-0.051,2.004-0.847c0.6-0.607,0.795-1.985,0.795-1.985s0.2-1.618,0.2-3.237v-1.517C22,9.62,21.8,8.001,21.8,8.001z M9.935,14.594l-0.001-5.62l5.404,2.82L9.935,14.594z"></path></svg></span><span class="text">Youtube</span></a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  </footer>
</body>
</html>`;
}

main().catch(console.error);
