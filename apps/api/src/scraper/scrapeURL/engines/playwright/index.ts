import { z } from "zod";
import { config } from "../../../../config";
import { EngineScrapeResult } from "..";
import { Meta } from "../..";
import { robustFetch } from "../../lib/fetch";
import { getInnerJson } from "@mendable/firecrawl-rs";
import { hasFormatOfType } from "../../../../lib/format-utils";
import { getBrandingScript } from "../fire-engine/brandingScript";
import { getDnaScript } from "../fire-engine/dnaScript";

export async function scrapeURLWithPlaywright(
  meta: Meta,
): Promise<EngineScrapeResult> {
  const hasBranding = hasFormatOfType(meta.options.formats, "branding");
  const hasDna = hasFormatOfType(meta.options.formats, "dna");
  const hasScreenshot = hasFormatOfType(meta.options.formats, "screenshot");

  const BRANDING_DEFAULT_WAIT_MS = 2000;
  const effectiveWait =
    hasBranding || hasDna
      ? Math.max(meta.options.waitFor ?? 0, BRANDING_DEFAULT_WAIT_MS)
      : (meta.options.waitFor ?? 0);

  // Smart default: use 'load' when visual formats need full resources,
  // 'domcontentloaded' otherwise (faster, avoids hanging on slow resources)
  const needsFullLoad = hasScreenshot || hasBranding || hasDna;
  const waitUntil =
    meta.options.waitUntil ?? (needsFullLoad ? "load" : "domcontentloaded");

  const response = await robustFetch({
    url: config.PLAYWRIGHT_MICROSERVICE_URL!,
    headers: {
      "Content-Type": "application/json",
    },
    body: {
      url: meta.rewrittenUrl ?? meta.url,
      wait_after_load: effectiveWait,
      timeout: meta.abort.scrapeTimeout(),
      headers: meta.options.headers,
      skip_tls_verification: meta.options.skipTlsVerification,
      dismiss_cookie_banners: true,
      wait_until: waitUntil,
      ...(() => {
        const brandingScript = hasBranding
          ? getBrandingScript({
              customScript: hasBranding.customScript,
              constants: hasBranding.constants,
            })
          : null;
        const dnaScript = hasDna
          ? getDnaScript({
              customScript: hasDna.customScript,
              constants: hasDna.constants,
            })
          : null;

        // Lazy-load scroll preamble for DNA: scroll to bottom and back to trigger deferred content
        const dnaScrollPreamble = `window.scrollTo(0,document.body.scrollHeight);`;
        const dnaScrollPostamble = `window.scrollTo(0,0);`;

        if (brandingScript && dnaScript) {
          // Combine both into a single IIFE with lazy-load scroll before DNA extraction
          return {
            execute_javascript: `(function() { ${dnaScrollPreamble} ${dnaScrollPostamble} var a = ${brandingScript}; var b = ${dnaScript}; return Object.assign({}, a, b); })();`,
          };
        }
        if (brandingScript) return { execute_javascript: brandingScript };
        if (dnaScript)
          return {
            execute_javascript: `(function() { ${dnaScrollPreamble} ${dnaScrollPostamble} return ${dnaScript}; })();`,
          };
        return {};
      })(),
      ...(hasScreenshot
        ? {
            screenshot: true,
            screenshot_full_page: hasScreenshot.fullPage || false,
            ...(hasScreenshot.format === "jpeg"
              ? {
                  screenshot_type: "jpeg",
                  screenshot_quality: hasScreenshot.quality ?? 90,
                }
              : hasScreenshot.quality !== undefined
                ? { screenshot_quality: hasScreenshot.quality }
                : {}),
            ...(hasScreenshot.viewport
              ? { screenshot_viewport: hasScreenshot.viewport }
              : {}),
            ...(hasScreenshot.scrollCapture
              ? {
                  screenshot_scroll_capture: true,
                  screenshot_scroll_wait: hasScreenshot.scrollWaitMs ?? 300,
                  screenshot_max_scrolls:
                    hasScreenshot.maxScrollScreenshots ?? 20,
                }
              : {}),
            ...(hasScreenshot.device
              ? { screenshot_device: hasScreenshot.device }
              : {}),
          }
        : {}),
    },
    method: "POST",
    logger: meta.logger.child("scrapeURLWithPlaywright/robustFetch"),
    schema: z.object({
      content: z.string(),
      pageStatusCode: z.number(),
      pageError: z.string().optional(),
      contentType: z.string().optional(),
      javascriptReturn: z.string().optional(),
      screenshot: z.string().optional(),
      screenshots: z.array(z.string()).optional(),
    }),
    mock: meta.mock,
    abort: meta.abort.asSignal(),
  });

  if (response.contentType?.includes("application/json")) {
    response.content = await getInnerJson(response.content);
  }

  // Parse javascriptReturn into actions structure (mirrors fire-engine pattern)
  let actions: EngineScrapeResult["actions"] | undefined;
  if (response.javascriptReturn) {
    try {
      const parsed = JSON.parse(response.javascriptReturn);
      let jsReturn: { type: string; value: unknown };
      if (
        parsed &&
        typeof parsed === "object" &&
        "type" in parsed &&
        typeof (parsed as any).type === "string" &&
        "value" in parsed
      ) {
        jsReturn = {
          type: String((parsed as any).type),
          value: (parsed as any).value,
        };
      } else {
        jsReturn = {
          type: "unknown",
          value: parsed,
        };
      }
      actions = {
        screenshots: [],
        scrapes: [],
        javascriptReturns: [jsReturn],
        pdfs: [],
      };
    } catch (error) {
      meta.logger.warn("Failed to parse javascriptReturn from playwright", {
        error,
      });
    }
  }

  return {
    url: meta.rewrittenUrl ?? meta.url, // TODO: impove redirect following
    html: response.content,
    statusCode: response.pageStatusCode,
    error: response.pageError,
    contentType: response.contentType,
    ...(actions ? { actions } : {}),
    ...(response.screenshot ? { screenshot: response.screenshot } : {}),
    ...(response.screenshots ? { screenshots: response.screenshots } : {}),

    proxyUsed: "basic",
  };
}

export function playwrightMaxReasonableTime(meta: Meta): number {
  return (meta.options.waitFor ?? 0) + 30000;
}
