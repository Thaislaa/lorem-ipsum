import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import handler from "serve-handler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

/**
 * Viewport padrão. O viewport real de cada rota vem das dimensões da print de
 * referência, para que a captura e a print tenham sempre o mesmo tamanho.
 */
const FALLBACK_VIEWPORT = { width: 1920, height: 1080 };
const MIN_SCORE = 0.75;
const PIXELMATCH_THRESHOLD = 0.15;

/** Diferença máxima tolerada em cada dimensão (proporção da print de referência). */
const MAX_SIZE_DIFF_RATIO = 0.4;

/**
 * Peso da penalidade aplicada à área que não é coberta pelas duas imagens.
 * 0 = ignora diferença de tamanho, 1 = penaliza integralmente.
 */
const SIZE_PENALTY_WEIGHT = 0.25;

const REQUIRED_PAGES_FILE = path.join(ROOT, "required_pages.txt");
const PRINTS_DIR = path.join(ROOT, "prints");
const RESULTS_DIR = path.join(ROOT, "visual-results");
const UPDATE = process.argv.includes("--update");

/** Pastas onde o HTML do aluno pode estar (relativas à raiz do projeto). */
const HTML_SEARCH_DIRS = ["", "src", "pages"];

/**
 * Nome do arquivo HTML correspondente à rota (sem pasta).
 * / -> index.html
 * /about -> about.html
 * /products/detail -> products/detail.html
 */
function routeToHtmlFileName(route) {
  if (route === "/") {
    return "index.html";
  }
  const cleaned = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${cleaned}.html`;
}

/**
 * Procura o HTML da rota em HTML_SEARCH_DIRS (raiz, src/, pages/).
 * Retorna o caminho relativo à raiz, ou null se não encontrar.
 */
function resolveHtmlPath(route) {
  const fileName = routeToHtmlFileName(route);
  for (const dir of HTML_SEARCH_DIRS) {
    const relative = dir ? path.join(dir, fileName) : fileName;
    if (fs.existsSync(path.join(ROOT, relative))) {
      return relative;
    }
  }
  return null;
}

/**
 * Lista os caminhos candidatos (para mensagens de erro).
 */
function htmlCandidatePaths(route) {
  const fileName = routeToHtmlFileName(route);
  return HTML_SEARCH_DIRS.map((dir) =>
    dir ? path.join(dir, fileName) : fileName,
  );
}

/**
 * Converte uma rota no caminho do PNG de referência.
 * / -> prints/index.png
 * /about -> prints/about.png
 * /products/detail -> prints/products/detail.png
 */
function routeToPrintPath(route) {
  if (route === "/") {
    return path.join(PRINTS_DIR, "index.png");
  }
  const cleaned = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return path.join(PRINTS_DIR, `${cleaned}.png`);
}

function routeToResultSlug(route) {
  if (route === "/") {
    return "index";
  }
  return route.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, "__");
}

function normalizeRoute(raw) {
  let route = raw.trim();
  if (!route.startsWith("/")) {
    route = `/${route}`;
  }
  if (route.length > 1 && route.endsWith("/")) {
    route = route.slice(0, -1);
  }
  return route;
}

function isValidRoute(route) {
  if (route === "/") {
    return true;
  }
  // Apenas segmentos alfanuméricos, hífen e underscore
  return /^\/[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(route);
}

function readRequiredPages() {
  if (!fs.existsSync(REQUIRED_PAGES_FILE)) {
    console.error("❌ Arquivo required_pages.txt não encontrado.");
    process.exit(1);
  }

  const content = fs.readFileSync(REQUIRED_PAGES_FILE, "utf8");
  const routes = [];
  const seen = new Set();

  for (const line of content.split(/\r?\n/)) {
    const withoutComment = line.split("#")[0].trim();
    if (!withoutComment) {
      continue;
    }

    const route = normalizeRoute(withoutComment);

    if (!isValidRoute(route)) {
      console.error(
        `❌ Rota inválida em required_pages.txt: "${withoutComment}"`,
      );
      process.exit(1);
    }

    if (seen.has(route)) {
      console.error(`❌ Rota duplicada em required_pages.txt: "${route}"`);
      process.exit(1);
    }

    seen.add(route);
    routes.push(route);
  }

  if (routes.length === 0) {
    console.error("❌ Nenhuma rota listada em required_pages.txt.");
    process.exit(1);
  }

  return routes;
}

function validateAssets(routes) {
  let failed = false;
  const resolved = new Map();

  for (const route of routes) {
    const htmlRel = resolveHtmlPath(route);
    const printAbs = routeToPrintPath(route);

    if (!htmlRel) {
      console.error(`❌ HTML não encontrado para ${route}. Procurado em:`);
      for (const candidate of htmlCandidatePaths(route)) {
        console.error(`     - ${candidate}`);
      }
      failed = true;
    } else {
      resolved.set(route, htmlRel);
      console.log(`  HTML ${route} -> ${htmlRel}`);
    }

    if (!UPDATE && !fs.existsSync(printAbs)) {
      console.error(
        `❌ Print de referência não encontrada para ${route}: ${path.relative(ROOT, printAbs)}`,
      );
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }

  return resolved;
}

async function startServer() {
  const server = http.createServer((request, response) =>
    handler(request, response, {
      public: ROOT,
      cleanUrls: false,
      directoryListing: false,
    }),
  );

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** Dimensões da print de referência, usadas como viewport da captura. */
function readPrintSize(printPath) {
  if (!fs.existsSync(printPath)) {
    return FALLBACK_VIEWPORT;
  }

  const png = PNG.sync.read(fs.readFileSync(printPath));
  return { width: png.width, height: png.height };
}

/** Recorta a região superior esquerda da imagem no tamanho informado. */
function cropTo(png, width, height) {
  if (png.width === width && png.height === height) {
    return png;
  }

  const cropped = new PNG({ width, height });
  const rowBytes = width * 4;

  for (let y = 0; y < height; y += 1) {
    const sourceStart = y * png.width * 4;
    png.data.copy(
      cropped.data,
      y * rowBytes,
      sourceStart,
      sourceStart + rowBytes,
    );
  }

  return cropped;
}

function comparePngs(expectedPath, actualPath, diffPath) {
  const expected = PNG.sync.read(fs.readFileSync(expectedPath));
  const actual = PNG.sync.read(fs.readFileSync(actualPath));

  const expectedSize = `${expected.width}x${expected.height}`;
  const actualSize = `${actual.width}x${actual.height}`;

  const widthDiffRatio =
    Math.abs(expected.width - actual.width) / expected.width;
  const heightDiffRatio =
    Math.abs(expected.height - actual.height) / expected.height;

  if (
    widthDiffRatio > MAX_SIZE_DIFF_RATIO ||
    heightDiffRatio > MAX_SIZE_DIFF_RATIO
  ) {
    return {
      score: 0,
      sizeMismatch: true,
      expectedSize,
      actualSize,
      widthDiffRatio,
      heightDiffRatio,
    };
  }

  // Compara a área comum às duas imagens; a diferença de tamanho entra como penalidade.
  const width = Math.min(expected.width, actual.width);
  const height = Math.min(expected.height, actual.height);

  const expectedCrop = cropTo(expected, width, height);
  const actualCrop = cropTo(actual, width, height);

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    expectedCrop.data,
    actualCrop.data,
    diff.data,
    width,
    height,
    { threshold: PIXELMATCH_THRESHOLD, includeAA: false },
  );

  fs.writeFileSync(diffPath, PNG.sync.write(diff));

  const comparedPixels = width * height;
  const largestPixels = Math.max(
    expected.width * expected.height,
    actual.width * actual.height,
  );

  const rawScore = 1 - diffPixels / comparedPixels;
  const coverage = comparedPixels / largestPixels;
  const sizePenalty = (1 - coverage) * SIZE_PENALTY_WEIGHT;
  const score = Math.max(0, rawScore * (1 - sizePenalty));

  return {
    score,
    rawScore,
    coverage,
    diffPixels,
    comparedPixels,
    sizeMismatch: false,
    expectedSize,
    actualSize,
  };
}

async function captureRoute(page, baseUrl, htmlRel, outputPath, viewport) {
  // Serve a raiz do projeto; abre o HTML no caminho resolvido (ex.: src/index.html).
  const urlPath = htmlRel.split(path.sep).join("/");
  const url = `${baseUrl}/${urlPath}`;
  await page.setViewportSize(viewport);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });
  // Pequena estabilização para animações/layout
  await new Promise((resolve) => setTimeout(resolve, 200));
  ensureDir(path.dirname(outputPath));
  // Ao gerar a print, captura a página inteira (define o tamanho da referência).
  // Ao comparar, captura apenas o viewport, que já tem o tamanho da print.
  await page.screenshot({
    path: outputPath,
    fullPage: UPDATE,
    type: "png",
  });
}

async function main() {
  console.log(
    UPDATE
      ? `Viewport: ${FALLBACK_VIEWPORT.width}x${FALLBACK_VIEWPORT.height} (página inteira)`
      : "Viewport: dimensões da print de referência",
  );
  console.log(`Score mínimo: ${(MIN_SCORE * 100).toFixed(0)}%`);
  console.log(
    `Tolerância de dimensões: ${(MAX_SIZE_DIFF_RATIO * 100).toFixed(0)}% por dimensão`,
  );
  console.log(`Modo: ${UPDATE ? "update (atualizar prints)" : "compare"}`);
  console.log("");

  const routes = readRequiredPages();
  console.log(`Rotas em required_pages.txt: ${routes.length}`);
  for (const r of routes) {
    console.log(`  - ${r}`);
  }
  console.log("");

  const resolvedHtml = validateAssets(routes);

  ensureDir(RESULTS_DIR);

  const { server, baseUrl } = await startServer();
  console.log(`Servidor local: ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: FALLBACK_VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  let failed = false;

  try {
    for (const route of routes) {
      const slug = routeToResultSlug(route);
      const printPath = routeToPrintPath(route);
      const actualPath = path.join(RESULTS_DIR, `${slug}.actual.png`);
      const diffPath = path.join(RESULTS_DIR, `${slug}.diff.png`);
      const htmlRel = resolvedHtml.get(route);

      const viewport = UPDATE ? FALLBACK_VIEWPORT : readPrintSize(printPath);

      console.log(
        `\n▶ Capturando ${route} (${htmlRel}) em ${viewport.width}x${viewport.height}...`,
      );
      await captureRoute(page, baseUrl, htmlRel, actualPath, viewport);

      if (UPDATE) {
        ensureDir(path.dirname(printPath));
        fs.copyFileSync(actualPath, printPath);
        console.log(`  ✅ Print atualizada: ${path.relative(ROOT, printPath)}`);
        continue;
      }

      const result = comparePngs(printPath, actualPath, diffPath);

      if (result.sizeMismatch) {
        console.error(
          `  ❌ Dimensões muito diferentes (esperado ${result.expectedSize}, atual ${result.actualSize})`,
        );
        console.error(
          `     Tolerância por dimensão: ${(MAX_SIZE_DIFF_RATIO * 100).toFixed(0)}% ` +
            `(largura ${(result.widthDiffRatio * 100).toFixed(1)}%, altura ${(result.heightDiffRatio * 100).toFixed(1)}%)`,
        );
        failed = true;
        continue;
      }

      const pct = (result.score * 100).toFixed(2);
      const rawPct = (result.rawScore * 100).toFixed(2);

      if (result.coverage < 1) {
        console.log(
          `  ⚠ Tamanhos diferentes (esperado ${result.expectedSize}, atual ${result.actualSize}); ` +
            `comparando área comum (${(result.coverage * 100).toFixed(1)}% da maior imagem)`,
        );
      }

      if (result.score >= MIN_SCORE) {
        console.log(
          `  ✅ Score ${pct}% (similaridade ${rawPct}% em ${result.comparedPixels} pixels comparados)`,
        );
      } else {
        console.error(
          `  ❌ Score ${pct}% abaixo do mínimo ${(MIN_SCORE * 100).toFixed(0)}% ` +
            `(similaridade ${rawPct}%)`,
        );
        console.error(`     Diff: ${path.relative(ROOT, diffPath)}`);
        failed = true;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("");

  if (UPDATE) {
    console.log("Prints de referência atualizadas.");
    process.exit(0);
  }

  if (failed) {
    console.error("Validação visual falhou. Veja visual-results/ para diffs.");
    process.exit(1);
  }

  console.log("Todas as rotas passaram na validação visual.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Erro inesperado na validação visual:", err);
  process.exit(1);
});
