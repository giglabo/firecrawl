// Branding script for extracting brand design tokens from web pages
// Built at runtime using esbuild
import path from "path";
import fs from "fs";
import { config } from "../../../../config";

let cachedBuiltInScript: string | null = null;
let cachedCustomFileScript: string | null = null;

interface BrandingScriptOptions {
  customScript?: string;
  constants?: Record<string, number | string>;
}

function getBuiltInScript(): string {
  if (cachedBuiltInScript) {
    return cachedBuiltInScript;
  }

  // Determine the correct path to the branding script source files
  // Development: use .ts files directly
  // Production (Docker): use compiled .js files in dist/
  let entryPoint = path.join(__dirname, "branding-script", "index.ts");

  if (!fs.existsSync(entryPoint)) {
    // Fall back to compiled .js files (production Docker)
    entryPoint = path.join(__dirname, "branding-script", "index.js");
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const esbuild = require("esbuild");

  const result = esbuild.buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "__extractBrandDesign",
    target: ["es2020"],
    write: false,
  });

  const bundledCode = result.outputFiles[0].text;

  // Wrap in a self-executing function that returns the result
  cachedBuiltInScript = `(function __extractBrandDesign() {
${bundledCode}
return __extractBrandDesign.extractBrandDesign();
})();`;

  return cachedBuiltInScript;
}

function applyConstantsOverride(
  script: string,
  overrides: Record<string, number | string>,
): string {
  // Inject CONSTANTS overrides before the extraction call
  const preamble = `Object.assign(__extractBrandDesign.CONSTANTS, ${JSON.stringify(overrides)});`;
  return script.replace(
    "return __extractBrandDesign.extractBrandDesign();",
    `${preamble}\nreturn __extractBrandDesign.extractBrandDesign();`,
  );
}

export const getBrandingScript = (options?: BrandingScriptOptions): string => {
  // Layer C: per-request inline script -- return directly (no cache)
  if (options?.customScript) {
    return `(function() { ${options.customScript} })();`;
  }

  // Layer B: custom script file from env var -- read once, cache
  if (config.BRANDING_CUSTOM_SCRIPT_PATH) {
    if (!cachedCustomFileScript) {
      const content = fs.readFileSync(
        config.BRANDING_CUSTOM_SCRIPT_PATH,
        "utf-8",
      );
      cachedCustomFileScript = `(function() { ${content} })();`;
    }
    return cachedCustomFileScript;
  }

  // Layer A: constants override (per-request or env var)
  const constantsOverride =
    options?.constants ??
    (config.BRANDING_CONSTANTS_OVERRIDE
      ? JSON.parse(config.BRANDING_CONSTANTS_OVERRIDE)
      : null);

  if (constantsOverride) {
    const baseScript = getBuiltInScript();
    // Per-request constants produce a unique script, don't cache
    return applyConstantsOverride(baseScript, constantsOverride);
  }

  // Default: built-in script (cached)
  return getBuiltInScript();
};
