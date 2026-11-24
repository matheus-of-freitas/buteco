const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://comidadibuteco.com.br/butecos/rio-de-janeiro/";
const DATA_DIR = path.join(__dirname, "..", "data");
const PROFILE_DIR = path.join(__dirname, "..", ".chrome-profile");
const TOTAL_PAGES = 9;

async function waitForItems(page) {
  console.log("  Aguardando conteudo...");
  try {
    await page.waitForSelector(".item", { timeout: 120_000 });
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}

async function extractBarsFromPage(page) {
  return page.evaluate(() => {
    const items = document.querySelectorAll(".item");
    return Array.from(items).map((item) => {
      const h2 = item.querySelector("h2");
      const p = item.querySelector(".caption p");
      const detailsLink = item.querySelector('a[href*="/buteco/"]');
      const mapsLink = item.querySelector("a.address");
      const img = item.querySelector("img");

      return {
        name: h2 ? h2.textContent.trim() : "",
        address: p ? p.textContent.trim() : "",
        comidaDeButecoUrl: detailsLink ? detailsLink.href : "",
        googleMapsUrl: mapsLink ? mapsLink.href : "",
        photoUrl: img ? img.src : "",
      };
    });
  });
}

async function scrapeBarDetail(page, bar) {
  if (!bar.comidaDeButecoUrl) return bar;

  try {
    await page.goto(bar.comidaDeButecoUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForSelector("main", { timeout: 15_000 });
    await page.waitForTimeout(1000);

    const details = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      return {
        pageContent: main.innerText.substring(0, 3000),
        images: Array.from(main.querySelectorAll("img")).map((img) => img.src),
      };
    });

    return { ...bar, pageContent: details.pageContent, detailImages: details.images };
  } catch (err) {
    console.error(`  Erro: ${bar.name} — ${err.message.split("\n")[0]}`);
    return bar;
  }
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log("Abrindo navegador com perfil persistente...");
  console.log("Se o Cloudflare aparecer, resolva manualmente. O script aguarda.\n");

  // Use persistent context — cookies survive between runs
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const page = context.pages()[0] || (await context.newPage());

  try {
    // Step 1: Scrape all listing pages
    console.log("=== Coletando listagem de bares ===\n");
    const allBars = [];

    for (let pageNum = 1; pageNum <= TOTAL_PAGES; pageNum++) {
      const url = pageNum === 1 ? BASE_URL : `${BASE_URL}page/${pageNum}/`;
      console.log(`Pagina ${pageNum}/${TOTAL_PAGES}`);

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

      const found = await waitForItems(page);
      if (!found) {
        console.log("  Conteudo nao carregou. Resolva o Cloudflare e pressione Enter...");
        // Wait longer — user might need to solve Cloudflare
        await page.waitForSelector(".item", { timeout: 300_000 });
      }

      if (pageNum === 1) {
        await page.screenshot({
          path: path.join(DATA_DIR, "screenshot-listing.png"),
          fullPage: true,
        });
      }

      const bars = await extractBarsFromPage(page);
      console.log(`  ${bars.length} bares encontrados`);
      allBars.push(...bars);

      // Save progress
      fs.writeFileSync(
        path.join(DATA_DIR, "bars-listing.json"),
        JSON.stringify(allBars, null, 2),
        "utf-8"
      );

      await page.waitForTimeout(2000);
    }

    console.log(`\nTotal: ${allBars.length} bares\n`);

    if (allBars.length === 0) {
      console.log("Nenhum bar encontrado.");
      return;
    }

    // Step 2: Scrape detail pages
    console.log("=== Coletando detalhes de cada bar ===\n");
    const detailedBars = [];

    for (let i = 0; i < allBars.length; i++) {
      const bar = allBars[i];
      console.log(`[${i + 1}/${allBars.length}] ${bar.name}`);
      const detailed = await scrapeBarDetail(page, bar);
      detailedBars.push(detailed);

      if ((i + 1) % 10 === 0 || i === allBars.length - 1) {
        fs.writeFileSync(
          path.join(DATA_DIR, "bars-raw.json"),
          JSON.stringify(detailedBars, null, 2),
          "utf-8"
        );
      }
      await page.waitForTimeout(1500);
    }

    // Save clean data
    const cleanBars = detailedBars.map(
      ({ pageContent, detailImages, ...rest }) => rest
    );
    fs.writeFileSync(
      path.join(DATA_DIR, "bars.json"),
      JSON.stringify(cleanBars, null, 2),
      "utf-8"
    );

    console.log(`\nDados salvos em data/bars.json (${cleanBars.length} bares)`);
    console.log("Dados brutos em data/bars-raw.json");
  } finally {
    await context.close();
  }
}

main().catch(console.error);
