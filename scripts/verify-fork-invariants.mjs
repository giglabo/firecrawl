#!/usr/bin/env node
/**
 * Fork invariant verifier.
 *
 * This fork (giglabo/firecrawl) re-implements a large slice of functionality that
 * upstream (firecrawl/firecrawl) either never had or actively removed: DNA
 * extraction, scroll screenshots, pluggable screenshot storage, a self-contained
 * standalone-playwright scrape path, configurable waitUntil, and per-request proxy.
 *
 * Upstream merges silently erode those features. Textual conflicts are the easy
 * part -- git flags them. The dangerous cases are the ones git resolves "cleanly"
 * while dropping our semantics: an engine block that loses `dna`, a format schema
 * replaced by upstream's option-less variant, a transformer that falls out of the
 * stack, an import pointing at a file upstream deleted.
 *
 * This script asserts each invariant mechanically so a merge can be proven
 * non-destructive instead of eyeballed.
 *
 *   node scripts/verify-fork-invariants.mjs          # human output, exit 1 on failure
 *   node scripts/verify-fork-invariants.mjs --json   # machine output
 *   node scripts/verify-fork-invariants.mjs --group engines
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const API = "apps/api/src";
const ENGINES = `${API}/scraper/scrapeURL/engines`;
const PW_SERVICE = "apps/playwright-service-ts";

/** Read a repo-relative file, or null when it does not exist. */
function read(rel) {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

function fileExists(rel) {
  return existsSync(join(ROOT, rel));
}

/**
 * Pull the `features: { ... }` body of every engine block out of the
 * `engineOptions` map in engines/index.ts.
 * @returns {Array<{name: string, features: string}>}
 */
function parseEngineBlocks(src) {
  const region = src.match(/const engineOptions:[\s\S]*?\n\} = \{\n([\s\S]*?)\n\};/);
  if (!region) return [];
  return [
    ...region[1].matchAll(
      /\n?  ("?[\w;()@\-.]+"?): \{\n    features: \{([\s\S]*?)\n    \},/g,
    ),
  ].map(m => ({ name: m[1].replace(/"/g, ""), features: m[2] }));
}

/** Every check: { id, desc, group, run: () => true | string (failure reason) }. */
const checks = [];
const check = (group, id, desc, run) => checks.push({ group, id, desc, run });

/** Assert a file contains each of `needles`. */
const mustContain = (rel, needles) => () => {
  const src = read(rel);
  if (src === null) return `missing file: ${rel}`;
  const missing = needles.filter(n =>
    n instanceof RegExp ? !n.test(src) : !src.includes(n),
  );
  return missing.length === 0
    ? true
    : `${rel} is missing: ${missing.map(String).join(", ")}`;
};

/** Assert a file contains none of `needles`. */
const mustNotContain = (rel, needles) => () => {
  const src = read(rel);
  if (src === null) return `missing file: ${rel}`;
  const present = needles.filter(n =>
    n instanceof RegExp ? n.test(src) : src.includes(n),
  );
  return present.length === 0
    ? true
    : `${rel} unexpectedly contains: ${present.map(String).join(", ")}`;
};

// ---------------------------------------------------------------------------
// Group: engines -- the `dna` feature flag and the standalone playwright engine
// ---------------------------------------------------------------------------

check("engines", "dna-feature-flag", "`dna` is a registered feature flag", () => {
  const src = read(`${ENGINES}/index.ts`);
  if (src === null) return `missing file: ${ENGINES}/index.ts`;
  const flags = src.match(/const featureFlags = \[([\s\S]*?)\] as const;/);
  if (!flags) return "could not locate featureFlags array";
  if (!/"dna"/.test(flags[1])) return "`dna` absent from featureFlags";
  if (!/dna: \{ priority: \d+ \}/.test(src))
    return "`dna` absent from featureFlagOptions";
  return true;
});

check(
  "engines",
  "dna-on-every-engine",
  "every engine block declares `dna`",
  () => {
    const src = read(`${ENGINES}/index.ts`);
    if (src === null) return `missing file: ${ENGINES}/index.ts`;
    const blocks = parseEngineBlocks(src);
    if (blocks.length === 0) return "could not parse engineOptions blocks";
    const missing = blocks.filter(b => !/\bdna:/.test(b.features));
    return missing.length === 0
      ? true
      : `engine blocks missing \`dna\` (add \`dna: false\` unless the engine ` +
          `can execute JS): ${missing.map(b => b.name).join(", ")}`;
  },
);

check(
  "engines",
  "playwright-features-enabled",
  "standalone playwright keeps our enabled features",
  () => {
    const src = read(`${ENGINES}/index.ts`);
    if (src === null) return `missing file: ${ENGINES}/index.ts`;
    const block = parseEngineBlocks(src).find(b => b.name === "playwright");
    if (!block) return "no `playwright` engine block found";
    // Upstream ships these as false (they disabled the engine); we depend on them.
    const required = [
      "screenshot",
      '"screenshot@fullScreen"',
      "stealthProxy",
      "branding",
      "dna",
    ];
    const wrong = required.filter(
      f => !new RegExp(`${f.replace(/["@]/g, m => "\\" + m)}: true`).test(block.features),
    );
    return wrong.length === 0
      ? true
      : `playwright engine must set these to true (upstream defaults them to ` +
          `false): ${wrong.join(", ")}`;
  },
);

check(
  "engines",
  "engine-scrape-result-fields",
  "EngineScrapeResult carries our extra fields",
  mustContain(`${ENGINES}/index.ts`, [
    "screenshots?: string[]",
    "bytesDownloaded?: number",
  ]),
);

check(
  "engines",
  "index-skips-dna",
  "the index engine is skipped for `dna` requests",
  () => {
    const src = read(`${ENGINES}/index.ts`);
    if (src === null) return `missing file: ${ENGINES}/index.ts`;
    const fn = src.match(/export function shouldUseIndex\(meta: Meta\)[\s\S]*?\n\}/);
    if (!fn) return "could not locate shouldUseIndex";
    return /hasFormatOfType\(meta\.options\.formats, "dna"\)/.test(fn[0])
      ? true
      : "shouldUseIndex does not exclude the `dna` format -- cached index hits " +
          "would return documents with no dna payload";
  },
);

check(
  "engines",
  "no-fire-engine-playwright",
  "`fire-engine;playwright` stays removed",
  mustNotContain(`${ENGINES}/index.ts`, ["fire-engine;playwright"]),
);

check(
  "engines",
  "playwright-engine-request",
  "playwright engine forwards our scrape parameters",
  mustContain(`${ENGINES}/playwright/index.ts`, [
    "wait_until",
    "execute_javascript",
    "screenshot_full_page",
    "screenshot_scroll_capture",
    "screenshot_device",
    "getBrandingScript",
    "getDnaScript",
    "resolvePlaywrightProxy",
    "screenshots: z.array(z.string()).optional()",
  ]),
);

check(
  "engines",
  "scrapeurl-flag-and-propagation",
  "scrapeURL raises the `dna` flag and propagates screenshots/bytes",
  () => {
    const rel = `${API}/scraper/scrapeURL/index.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const missing = [
      ['`dna` feature flag', /hasFormatOfType\(options\.formats, "dna"\)[\s\S]{0,60}flags\.add\("dna"\)/],
      ["screenshots propagation", /screenshots: engineResult\.screenshots/],
      ["bytesDownloaded propagation", /engineResult\.bytesDownloaded/],
    ].filter(([, re]) => !re.test(src));
    return missing.length === 0
      ? true
      : `${rel} lost: ${missing.map(([n]) => n).join(", ")} -- without the flag ` +
          `no engine advertises dna support and every dna request falls through`;
  },
);

check(
  "engines",
  "chrome-cdp-dna-actions",
  "chrome-cdp injects the DNA script (with its lazy-load scroll)",
  () => {
    const rel = `${ENGINES}/fire-engine/index.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const missing = [
      ["getDnaScript import", 'from "./dnaScript"'],
      ["dna format lookup", 'hasFormatOfType(meta.options.formats, "dna")'],
      ["getDnaScript call", "getDnaScript({"],
    ].filter(([, n]) => !src.includes(n));
    return missing.length === 0
      ? true
      : `${rel} lost: ${missing.map(([n]) => n).join(", ")}`;
  },
);

// ---------------------------------------------------------------------------
// Group: formats -- request/response schema surface
// ---------------------------------------------------------------------------

check(
  "formats",
  "branding-format-options",
  "branding format keeps customScript/skipProcessor/constants",
  () => {
    const rel = `${API}/controllers/v2/types.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const decl = src.match(
      /const brandingFormatWithOptions = z\.[\s\S]*?\n\}\);/,
    );
    if (!decl) return "brandingFormatWithOptions not declared";
    const missing = ["customScript", "skipProcessor", "constants"].filter(
      f => !decl[0].includes(f),
    );
    if (missing.length) return `brandingFormatWithOptions lost: ${missing.join(", ")}`;
    // Upstream declares branding as an option-less strictObject. If that variant
    // lands in the union it shadows ours and silently rejects our options.
    if (/z\.strictObject\(\{ type: z\.literal\("branding"\) \}\)/.test(src))
      return "upstream's option-less `z.strictObject({ type: z.literal(\"branding\") })` " +
        "is present -- it must be replaced by brandingFormatWithOptions";
    return true;
  },
);

check(
  "formats",
  "dna-format-options",
  "dna format schema is declared",
  mustContain(`${API}/controllers/v2/types.ts`, [
    "const dnaFormatWithOptions",
    'type: z.literal("dna")',
  ]),
);

check(
  "formats",
  "formats-union-registered",
  "branding + dna are in the formats discriminated union",
  () => {
    const rel = `${API}/controllers/v2/types.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    // The formats array is a z.union([...]) today; upstream has used
    // .discriminatedUnion("type", [...]) in the past. Accept either shape, and
    // identify it by the markdown member so we don't match some other union.
    const union = [
      ...src.matchAll(
        /(?:z\s*\.union|\.discriminatedUnion\("type",)\s*\(?\[([\s\S]*?)\]\)/g,
      ),
    ].find(m => m[1].includes('z.literal("markdown")'));
    if (!union) return "could not locate the formats union/discriminatedUnion";
    const missing = ["brandingFormatWithOptions", "dnaFormatWithOptions"].filter(
      f => !union[1].includes(f),
    );
    return missing.length === 0
      ? true
      : `formats union is missing: ${missing.join(", ")}`;
  },
);

check(
  "formats",
  "screenshot-format-options",
  "screenshot format keeps scroll-capture options",
  mustContain(`${API}/controllers/v2/types.ts`, [
    "scrollCapture",
    "maxScrollScreenshots",
    "scrollWaitMs",
  ]),
);

check(
  "formats",
  "storage-request-field",
  "per-request `storage` config survives",
  mustContain(`${API}/controllers/v2/types.ts`, [
    "storage: z",
    'provider: z.enum(["s3", "local"])',
  ]),
);

check(
  "formats",
  "document-response-fields",
  "Document exposes our response fields",
  mustContain(`${API}/controllers/v2/types.ts`, [
    "screenshots?: string[]",
    "screenshotPath?: string",
    "screenshotPaths?: string[]",
    "dna?:",
  ]),
);

for (const v of ["v1", "v2"]) {
  check(
    "formats",
    `${v}-waituntil-and-proxy`,
    `${v} scrape options expose waitUntil + proxyConfig`,
    mustContain(`${API}/controllers/${v}/types.ts`, [
      'waitUntil: z.enum(["load", "domcontentloaded", "networkidle"])',
      "proxyConfig: z",
    ]),
  );
}

check(
  "formats",
  "v1-document-screenshots",
  "v1 Document exposes screenshots[]",
  mustContain(`${API}/controllers/v1/types.ts`, ["screenshots?: string[]"]),
);

check(
  "formats",
  "track-bytes-downloaded",
  "`trackBytesDownloaded` opt-in survives",
  mustContain(`${API}/controllers/v2/types.ts`, ["trackBytesDownloaded"]),
);

// ---------------------------------------------------------------------------
// Group: transformers -- pipeline wiring
// ---------------------------------------------------------------------------

check(
  "transformers",
  "transformer-stack-wiring",
  "uploadScreenshot + deriveDnaFromActions are in the stack",
  () => {
    const rel = `${API}/scraper/scrapeURL/transformers/index.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const stack = src.match(/const transformerStack: Transformer\[\] = \[([\s\S]*?)\n\];/);
    if (!stack) return "could not locate transformerStack";
    const missing = ["uploadScreenshot", "deriveDnaFromActions"].filter(
      f => !stack[1].includes(f),
    );
    if (missing.length)
      return `transformerStack is missing: ${missing.join(", ")} -- upstream ` +
        `removed uploadScreenshot from the pipeline, so a merge drops it silently`;
    if (!src.includes('from "./uploadScreenshot"'))
      return "uploadScreenshot import is missing";
    return true;
  },
);

check(
  "transformers",
  "transformer-stack-order",
  "uploadScreenshot runs before anything that strips or prunes it",
  () => {
    const rel = `${API}/scraper/scrapeURL/transformers/index.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const stack = src.match(/const transformerStack: Transformer\[\] = \[([\s\S]*?)\n\];/);
    if (!stack) return "could not locate transformerStack";
    const at = name => stack[1].indexOf(name);
    const upload = at("uploadScreenshot");
    if (upload < 0) return "uploadScreenshot is not in transformerStack";
    // Both of these destroy the data uploadScreenshot needs:
    // removeBase64Images strips the data: URIs it uploads from, and
    // coerceFieldsToFormats prunes screenshots that aren't in formats.
    // Upstream orders its stack differently, so a merge can float these above us
    // while every "is it present?" check still passes.
    const after = [
      ["removeBase64Images", "strips the data: URIs before they are uploaded"],
      ["coerceFieldsToFormats", "prunes screenshots before they are uploaded"],
    ].filter(([n]) => {
      const i = at(n);
      return i >= 0 && i < upload;
    });
    return after.length === 0
      ? true
      : `transformerStack order is wrong -- ${after
          .map(([n, why]) => `${n} runs before uploadScreenshot and ${why}`)
          .join("; ")}`;
  },
);

check(
  "transformers",
  "coerce-fields-handles-ours",
  "coerceFieldsToFormats prunes/validates screenshots + dna",
  mustContain(`${API}/scraper/scrapeURL/transformers/index.ts`, [
    "document.screenshots",
    "document.dna",
  ]),
);

// ---------------------------------------------------------------------------
// Group: storage -- pluggable screenshot storage
// ---------------------------------------------------------------------------

for (const rel of [
  `${API}/lib/storage/provider.interface.ts`,
  `${API}/lib/storage/factory.ts`,
  `${API}/lib/storage/providers/s3.provider.ts`,
  `${API}/lib/storage/providers/local.provider.ts`,
]) {
  check("storage", `exists:${rel.split("/").pop()}`, `${rel} exists`, () =>
    fileExists(rel) ? true : `missing file: ${rel}`,
  );
}

check(
  "storage",
  "upload-screenshot-uses-providers",
  "uploadScreenshot resolves a pluggable provider",
  mustContain(`${API}/scraper/scrapeURL/transformers/uploadScreenshot.ts`, [
    "resolveProvider",
  ]),
);

check(
  "storage",
  "no-static-supabase-import",
  "uploadScreenshot does not statically import services/supabase",
  () => {
    const rel = `${API}/scraper/scrapeURL/transformers/uploadScreenshot.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    // Upstream's Drizzle migration deleted apps/api/src/services/supabase.ts.
    // A top-level import of it breaks the build the moment upstream is merged,
    // and because upstream also deleted this whole file the conflict shows up as
    // UD (not UU) -- git will not point at the broken import for us.
    return /^import .*from "\.\.\/\.\.\/\.\.\/services\/supabase";$/m.test(src)
      ? `${rel} statically imports ../../../services/supabase, which upstream ` +
          `deleted in the Drizzle migration -- make the Supabase fallback lazy`
      : true;
  },
);

check(
  "storage",
  "batched-uploads-and-select",
  "batched uploads, screenshot selection and returned paths survive",
  () => {
    const rel = `${API}/scraper/scrapeURL/transformers/uploadScreenshot.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const missing = [
      ["upload concurrency", "SCREENSHOT_UPLOAD_CONCURRENCY"],
      ["screenshot select parsing", "parseScreenshotSelect"],
      ["screenshotPaths response", "document.screenshotPaths"],
    ].filter(([, n]) => !src.includes(n));
    return missing.length === 0
      ? true
      : `${rel} lost: ${missing.map(([n]) => n).join(", ")}`;
  },
);

check(
  "storage",
  "config-env-vars",
  "storage/branding/DNA/proxy env vars are declared in config",
  mustContain(`${API}/config.ts`, [
    "SCREENSHOT_STORAGE_PROVIDER",
    "SCREENSHOT_STORAGE_S3_BUCKET",
    "SCREENSHOT_STORAGE_S3_PREFIX",
    "SCREENSHOT_STORAGE_LOCAL_DIR",
    "SCREENSHOT_UPLOAD_CONCURRENCY",
    "BRANDING_CUSTOM_SCRIPT_PATH",
    "BRANDING_CONSTANTS_OVERRIDE",
    "DNA_CUSTOM_SCRIPT_PATH",
    "DNA_CONSTANTS_OVERRIDE",
    "PLAYWRIGHT_PROXY_BASIC",
    "PLAYWRIGHT_PROXY_STEALTH",
  ]),
);

// ---------------------------------------------------------------------------
// Group: scripts -- browser-side branding / DNA extraction
// ---------------------------------------------------------------------------

check(
  "scripts",
  "dna-script-bundle",
  "DNA script bundler and sources exist",
  () => {
    const missing = [
      `${ENGINES}/fire-engine/dnaScript.ts`,
      `${ENGINES}/fire-engine/dna-script/index.ts`,
      `${ENGINES}/fire-engine/dna-script/types.ts`,
    ].filter(f => !fileExists(f));
    return missing.length === 0 ? true : `missing: ${missing.join(", ")}`;
  },
);

check(
  "scripts",
  "branding-script-layers",
  "brandingScript keeps the 3-layer override chain",
  () => {
    const rel = `${ENGINES}/fire-engine/brandingScript.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const layers = [
      ["per-request customScript", "options?.customScript"],
      ["env script path", "config.BRANDING_CUSTOM_SCRIPT_PATH"],
      ["constants override", "options?.constants"],
    ];
    const missing = layers.filter(([, needle]) => !src.includes(needle));
    return missing.length === 0
      ? true
      : `brandingScript lost override layer(s): ${missing.map(([n]) => n).join(", ")}`;
  },
);

check(
  "scripts",
  "branding-skip-llm",
  "BRANDING_SKIP_LLM heuristic-only path survives",
  () => {
    const rel = `${API}/lib/branding/transformer.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    // Self-hosted collects raw branding data with no LLM calls; upstream always
    // enhances via LLM. Losing this makes self-hosted branding require an API key.
    return src.includes("config.BRANDING_SKIP_LLM")
      ? true
      : `${rel} lost the BRANDING_SKIP_LLM branch -- self-hosted branding would ` +
          `start requiring an LLM provider`;
  },
);

check(
  "scripts",
  "extract-worker-optional-rabbitmq",
  "extract worker stays alive without NUQ_RABBITMQ_URL",
  () => {
    const rel = `${API}/services/extract-worker.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    // Without this the harness treats the worker as crashed in self-hosted setups.
    return src.includes("NUQ_RABBITMQ_URL")
      ? true
      : `${rel} lost the NUQ_RABBITMQ_URL guard -- the test harness reads the ` +
          `worker exit as a crash`;
  },
);

check(
  "scripts",
  "webp-converter",
  "native convertImageToWebp is exported",
  () => {
    const lib = read("apps/api/native/src/lib.rs");
    if (lib === null) return "missing file: apps/api/native/src/lib.rs";
    if (!fileExists("apps/api/native/src/image_converter.rs"))
      return "missing file: apps/api/native/src/image_converter.rs";
    return lib.includes("image_converter")
      ? true
      : "lib.rs does not register the image_converter module";
  },
);

// ---------------------------------------------------------------------------
// Group: playwright-service -- the standalone browser microservice
// ---------------------------------------------------------------------------

check(
  "playwright-service",
  "request-model-fields",
  "UrlModel accepts our request fields",
  mustContain(`${PW_SERVICE}/api.ts`, [
    "execute_javascript?: string",
    "screenshot_scroll_capture?: boolean",
    "screenshot_device?: string",
    "dismiss_cookie_banners?: boolean",
    "wait_until?:",
    "proxy?:",
  ]),
);

check(
  "playwright-service",
  "wait-until-not-hardcoded",
  "scrapePage takes waitUntil instead of hardcoding 'load'",
  () => {
    const rel = `${PW_SERVICE}/api.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    if (!/scrapePage\([\s\S]{0,200}?wait_until/.test(src))
      return "the /scrape handler does not pass wait_until into scrapePage " +
        "(upstream hardcodes waitUntil: 'load')";
    // page.goto must take the variable, not a literal. Upstream ships
    // `page.goto(url, { waitUntil: 'load', timeout })`.
    if (!/page\.goto\(url, \{ waitUntil,/.test(src))
      return "page.goto does not use the waitUntil variable -- upstream " +
        "hardcodes `waitUntil: 'load'` there";
    return true;
  },
);

check(
  "playwright-service",
  "cookie-dismissal",
  "cookie banner dismissal helper is wired in",
  () => {
    if (!fileExists(`${PW_SERVICE}/helpers/dismiss_cookie_banners.ts`))
      return `missing file: ${PW_SERVICE}/helpers/dismiss_cookie_banners.ts`;
    const src = read(`${PW_SERVICE}/api.ts`);
    return src && src.includes("getCookieDismissScript")
      ? true
      : "api.ts does not import getCookieDismissScript";
  },
);

check(
  "playwright-service",
  "scroll-screenshots",
  "scroll screenshot capture survives",
  mustContain(`${PW_SERVICE}/api.ts`, ["screenshot_scroll_capture", "screenshots"]),
);

check(
  "playwright-service",
  "devices-endpoint",
  "/devices discovery endpoint survives",
  mustContain(`${PW_SERVICE}/api.ts`, [/app\.get\(\s*['"]\/devices['"]/]),
);

check(
  "playwright-service",
  "per-request-proxy",
  "createContext accepts a per-request proxy",
  () => {
    const rel = `${PW_SERVICE}/api.ts`;
    const src = read(rel);
    if (src === null) return `missing file: ${rel}`;
    const fn = src.match(/const createContext = async \(([\s\S]*?)\) *(?::[\s\S]*?)?=> \{/);
    if (!fn) return "could not locate createContext";
    const missing = ["proxyConfig", "deviceName", "blockMedia"].filter(
      p => !fn[1].includes(p),
    );
    return missing.length === 0
      ? true
      : `createContext lost parameter(s): ${missing.join(", ")}`;
  },
);

// ---------------------------------------------------------------------------
// Group: tests -- our e2e coverage must still be present
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Group: screenshot URL modes
//
// The proxy route is our ONE deviation from "no new public routes" (see
// CLAUDE.md). Upstream has no reason to keep it, so a merge that rewrites
// routes/v2.ts can drop it and screenshots silently go back to bare object
// URLs -- which 403 against a private bucket.
// ---------------------------------------------------------------------------

check(
  "screenshot-url",
  "proxy-route",
  "GET /v2/screenshot/:token is registered",
  mustContain(`${API}/routes/v2.ts`, [
    "screenshotProxyController",
    '"/screenshot/:token"',
  ]),
);

check(
  "screenshot-url",
  "proxy-helpers",
  "signed proxy token helpers survive",
  mustContain(`${API}/lib/storage/proxy-url.ts`, [
    "verifyScreenshotToken",
    "timingSafeEqual",
  ]),
);

check(
  "screenshot-url",
  "url-mode",
  "SCREENSHOT_STORAGE_URL_MODE offers public/signed/proxy",
  mustContain(`${API}/config.ts`, [
    "SCREENSHOT_STORAGE_URL_MODE",
    '"public", "signed", "proxy"',
  ]),
);

for (const name of [
  "scrape-dna",
  "scrape-storage",
  "scrape-waituntil",
  "scrape-proxy",
  "scrape-bytes-downloaded",
  "scrape-async-queue",
  "scrape-screenshot-url",
]) {
  check("tests", `snips:${name}`, `${name}.test.ts exists`, () =>
    fileExists(`${API}/__tests__/snips/v2/${name}.test.ts`)
      ? true
      : `missing test: ${API}/__tests__/snips/v2/${name}.test.ts`,
  );
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const groupFilter = argv.includes("--group")
  ? argv[argv.indexOf("--group") + 1]
  : null;

const selected = groupFilter
  ? checks.filter(c => c.group === groupFilter)
  : checks;

const results = selected.map(c => {
  let outcome;
  try {
    outcome = c.run();
  } catch (err) {
    outcome = `check threw: ${err.message}`;
  }
  return { ...c, ok: outcome === true, reason: outcome === true ? null : outcome };
});

const failed = results.filter(r => !r.ok);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        total: results.length,
        passed: results.length - failed.length,
        failed: failed.length,
        failures: failed.map(({ group, id, desc, reason }) => ({
          group,
          id,
          desc,
          reason,
        })),
      },
      null,
      2,
    ),
  );
} else {
  let lastGroup = null;
  for (const r of results) {
    if (r.group !== lastGroup) {
      console.log(`\n${r.group}`);
      lastGroup = r.group;
    }
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.desc}`);
    if (!r.ok) console.log(`        ${r.reason}`);
  }
  console.log(
    `\n${results.length - failed.length}/${results.length} invariants hold` +
      (failed.length ? ` -- ${failed.length} FAILED` : ""),
  );
}

process.exit(failed.length ? 1 : 0);
