// DNA script for extracting design tokens from web pages
// Built at runtime using esbuild
import path from "path";
import fs from "fs";
import { config } from "../../../../config";

let cachedBuiltInScript: string | null = null;
let cachedCustomFileScript: string | null = null;

interface DnaScriptOptions {
  customScript?: string;
  constants?: Record<string, number | string>;
}

function getBuiltInScript(): string {
  if (cachedBuiltInScript) {
    return cachedBuiltInScript;
  }

  let entryPoint = path.join(__dirname, "dna-script", "index.ts");

  if (!fs.existsSync(entryPoint)) {
    entryPoint = path.join(__dirname, "dna-script", "index.js");
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const esbuild = require("esbuild");

  const result = esbuild.buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "__extractDna",
    target: ["es2020"],
    write: false,
  });

  const bundledCode = result.outputFiles[0].text;

  cachedBuiltInScript = `(function __extractDna() {
${bundledCode}
return __extractDna.extractDna();
})();`;

  return cachedBuiltInScript;
}

function applyConstantsOverride(
  script: string,
  overrides: Record<string, number | string>,
): string {
  const preamble = `Object.assign(__extractDna.CONSTANTS, ${JSON.stringify(overrides)});`;
  return script.replace(
    "return __extractDna.extractDna();",
    `${preamble}\nreturn __extractDna.extractDna();`,
  );
}

export const getDnaScript = (options?: DnaScriptOptions): string => {
  // Layer C: per-request inline script -- return directly (no cache)
  if (options?.customScript) {
    return `(function() { ${options.customScript} })();`;
  }

  // Layer B: custom script file from env var -- read once, cache
  if (config.DNA_CUSTOM_SCRIPT_PATH) {
    if (!cachedCustomFileScript) {
      const content = fs.readFileSync(config.DNA_CUSTOM_SCRIPT_PATH, "utf-8");
      cachedCustomFileScript = `(function() { ${content} })();`;
    }
    return cachedCustomFileScript;
  }

  // Layer A: constants override (per-request or env var)
  const constantsOverride =
    options?.constants ??
    (config.DNA_CONSTANTS_OVERRIDE
      ? JSON.parse(config.DNA_CONSTANTS_OVERRIDE)
      : null);

  if (constantsOverride) {
    const baseScript = getBuiltInScript();
    return applyConstantsOverride(baseScript, constantsOverride);
  }

  // Default: built-in script (cached)
  return getBuiltInScript();
};
