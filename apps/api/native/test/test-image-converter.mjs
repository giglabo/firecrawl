import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load the native module - in Docker the .node file is in the same dir
const { convertImageToWebp } = require(
  process.env.NATIVE_MODULE_PATH || "@mendable/firecrawl-rs",
);

const pngBuffer = readFileSync(join(__dirname, "fixtures", "sample.png"));
const jpegBuffer = readFileSync(join(__dirname, "fixtures", "sample.jpeg"));

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

function isWebP(buf) {
  return (
    buf.length > 12 &&
    buf[0] === 0x52 && // R
    buf[1] === 0x49 && // I
    buf[2] === 0x46 && // F
    buf[3] === 0x46 && // F
    buf[8] === 0x57 && // W
    buf[9] === 0x45 && // E
    buf[10] === 0x42 && // B
    buf[11] === 0x50 // P
  );
}

console.log("Test: PNG to WebP conversion");
{
  const result = convertImageToWebp(pngBuffer, 80);
  assert(result.length > 0, "output is non-empty");
  assert(isWebP(result), "output has WebP magic bytes (RIFF...WEBP)");
  assert(
    result.length < pngBuffer.length * 2,
    `output is reasonably sized (${result.length} bytes vs ${pngBuffer.length} input)`,
  );
}

console.log("\nTest: JPEG to WebP conversion");
{
  const result = convertImageToWebp(jpegBuffer, 80);
  assert(result.length > 0, "output is non-empty");
  assert(isWebP(result), "output has WebP magic bytes (RIFF...WEBP)");
}

console.log("\nTest: quality affects output size");
{
  const lowQ = convertImageToWebp(pngBuffer, 10);
  const highQ = convertImageToWebp(pngBuffer, 95);
  assert(
    lowQ.length < highQ.length,
    `quality 10 (${lowQ.length}B) < quality 95 (${highQ.length}B)`,
  );
}

console.log("\nTest: invalid input throws");
{
  let threw = false;
  try {
    convertImageToWebp(Buffer.from("not an image"), 80);
  } catch (e) {
    threw = true;
  }
  assert(threw, "throws on invalid input");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
