// Coleta os bares do Festival Botecar Rio a partir do pratos.js do site oficial.
// O site não tem páginas por bar: todos os dados ficam num array `pratos` no JS.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SITE_BASE = "https://www.festivalbotecar.com.br/rio/";
const SOURCE_URL = `${SITE_BASE}pratos.js`;
const DATA_DIR = path.join(__dirname, "..", "data");
const RAW_FILE = path.join(DATA_DIR, "bars-raw.json");

// Extract only the `var pratos = [ ... ];` literal, so no other site code runs.
function extractPratosLiteral(source) {
  const start = source.indexOf("var pratos = [");
  if (start === -1) throw new Error("Array `pratos` não encontrado em pratos.js");
  const open = source.indexOf("[", start);

  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error("Array `pratos` não terminou");
}

async function main() {
  console.log(`Baixando ${SOURCE_URL}...`);
  const resp = await fetch(SOURCE_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar pratos.js`);
  const source = await resp.text();

  const literal = extractPratosLiteral(source);
  // Object/array literal only, evaluated in an empty context with a timeout.
  const pratos = vm.runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 });

  const bars = pratos.map((p) => ({
    id: p.id,
    bar: p.bar,
    endereco: p.endereco,
    regiao: p.regiao,
    funcionamento: p.funcionamento,
    instagram: p.instagram,
    prato: p.prato,
    descricaoCurta: p.descricaoCurta,
    inspiracao: p.inspiracao,
    preco: p.preco,
    porcao: p.porcao,
    foto: p.foto ? new URL(p.foto, SITE_BASE).href : "",
  }));

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RAW_FILE, JSON.stringify(bars, null, 2), "utf-8");
  console.log(`${bars.length} bares salvos em ${RAW_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
