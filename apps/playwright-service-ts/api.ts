import express, { Request, Response } from 'express';
import {
  chromium,
  Browser,
  BrowserContext,
  Route,
  Request as PlaywrightRequest,
  Page,
  devices,
} from 'playwright';
import dotenv from 'dotenv';
import UserAgent from 'user-agents';
import { getError } from './helpers/get_error';
import { getCookieDismissScript } from './helpers/dismiss_cookie_banners';
import { lookup } from 'dns/promises';
import IPAddr from 'ipaddr.js';
import { Server, RequestError } from 'proxy-chain';

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(express.json());

const BLOCK_MEDIA =
  (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const DISMISS_COOKIE_BANNERS =
  (process.env.DISMISS_COOKIE_BANNERS ?? 'TRUE').toUpperCase() === 'TRUE';
const COOKIE_DISMISS_SCRIPT = getCookieDismissScript();
const MAX_CONCURRENT_PAGES = Math.max(
  1,
  Number.parseInt(process.env.MAX_CONCURRENT_PAGES ?? '10', 10) || 10,
);
const ALLOW_LOCAL_WEBHOOKS =
  (process.env.ALLOW_LOCAL_WEBHOOKS || 'False').toUpperCase() === 'TRUE';

const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;

class InsecureConnectionError extends Error {
  constructor(
    public readonly blockedUrl: string,
    reason: string,
  ) {
    super(`Blocked insecure target URL "${blockedUrl}": ${reason}`);
    this.name = 'InsecureConnectionError';
  }
}

const isInternalHost = async (hostname: string): Promise<boolean> => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;

  let addresses: string[];
  if (IPAddr.isValid(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return true;
    }
  }
  return (
    addresses.length === 0 ||
    addresses.some((a) => IPAddr.parse(a).range() !== 'unicast')
  );
};

const assertSafeTargetUrl = async (urlString: string): Promise<void> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new InsecureConnectionError(urlString, 'URL is invalid');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new InsecureConnectionError(
      urlString,
      `unsupported protocol "${parsedUrl.protocol}"`,
    );
  }
  if (!ALLOW_LOCAL_WEBHOOKS && (await isInternalHost(parsedUrl.hostname))) {
    throw new InsecureConnectionError(
      urlString,
      'resolves to a private/internal address',
    );
  }
};

const buildUpstreamProxyUrl = (): string | undefined => {
  if (!PROXY_SERVER) return undefined;
  const server = PROXY_SERVER.includes('://')
    ? PROXY_SERVER
    : `http://${PROXY_SERVER}`;
  const url = new URL(server);
  if (PROXY_USERNAME) url.username = PROXY_USERNAME;
  if (PROXY_PASSWORD) url.password = PROXY_PASSWORD;
  return url.toString();
};

const startSSRFProxy = async (): Promise<number> => {
  const server = new Server({
    port: 0,
    host: '127.0.0.1',
    prepareRequestFunction: async ({ hostname }) => {
      if (!ALLOW_LOCAL_WEBHOOKS && (await isInternalHost(hostname))) {
        throw new RequestError(
          'Blocked: target resolves to a private/internal address',
          403,
        );
      }
      return { upstreamProxyUrl: buildUpstreamProxyUrl() };
    },
  });
  await server.listen();
  return server.port;
};

let ssrfProxyPort: number;

type ContextSecurityState = {
  blockedNavigationRequestUrl: string | null;
};
class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        this.permits--;
        nextResolve();
      }
    }
  }

  getAvailablePermits(): number {
    return this.permits;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);

const AD_SERVING_DOMAINS = [
  'doubleclick.net',
  'adservice.google.com',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adsystem.com',
  'adservice.com',
  'adnxs.com',
  'ads-twitter.com',
  'facebook.net',
  'fbcdn.net',
  'amazon-adsystem.com',
];

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
  execute_javascript?: string;
  screenshot?: boolean;
  screenshot_full_page?: boolean;
  screenshot_quality?: number;
  screenshot_viewport?: { width: number; height: number };
  screenshot_scroll_capture?: boolean;
  screenshot_scroll_wait?: number;
  screenshot_max_scrolls?: number;
  screenshot_device?: string;
  dismiss_cookie_banners?: boolean;
  wait_until?: 'load' | 'domcontentloaded' | 'networkidle';
  track_bytes_downloaded?: boolean;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
}

let browser: Browser;

const initializeBrowser = async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  });
};

const createContext = async (
  skipTlsVerification: boolean = false,
  blockMedia: boolean = BLOCK_MEDIA,
  deviceName?: string,
  proxyConfig?: { server: string; username?: string; password?: string },
  userAgentOverride?: string,
): Promise<{
  context: BrowserContext;
  securityState: ContextSecurityState;
}> => {
  const deviceDescriptor = deviceName ? devices[deviceName] : undefined;
  const userAgent =
    userAgentOverride || deviceDescriptor?.userAgent || new UserAgent().toString();
  const viewport = deviceDescriptor?.viewport ?? { width: 1280, height: 800 };
  const securityState: ContextSecurityState = {
    blockedNavigationRequestUrl: null,
  };

  const contextOptions: any = {
    userAgent,
    viewport,
    ignoreHTTPSErrors: skipTlsVerification,
    ...(deviceDescriptor ? {
      screen: (deviceDescriptor as any).screen,
      deviceScaleFactor: deviceDescriptor.deviceScaleFactor,
      isMobile: deviceDescriptor.isMobile,
      hasTouch: deviceDescriptor.hasTouch,
    } : {}),
    serviceWorkers: 'block',
  };

  // Proxy resolution: per-request > global env > upstream SSRF proxy.
  // The SSRF proxy is the hardened default; an explicit per-request or env
  // proxy overrides it. Navigation is still guarded by the assertSafeTargetUrl
  // route interception below regardless of which proxy is used.
  if (proxyConfig) {
    contextOptions.proxy = proxyConfig;
  } else if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
      username: PROXY_USERNAME,
      password: PROXY_PASSWORD,
    };
  } else if (PROXY_SERVER) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
    };
  } else {
    contextOptions.proxy = {
      server: `http://127.0.0.1:${ssrfProxyPort}`,
    };
  }

  const newContext = await browser.newContext(contextOptions);

  if (blockMedia) {
    await newContext.route(
      '**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}',
      async (route: Route, request: PlaywrightRequest) => {
        await route.abort();
      },
    );
  }

  // Intercept all requests to avoid loading ads
  await newContext.route(
    '**/*',
    async (route: Route, request: PlaywrightRequest) => {
      const requestUrlString = request.url();
      try {
        await assertSafeTargetUrl(requestUrlString);
      } catch (error) {
        if (error instanceof InsecureConnectionError) {
          if (request.isNavigationRequest()) {
            securityState.blockedNavigationRequestUrl = requestUrlString;
          }
          console.warn(`Blocked request: ${requestUrlString}`);
          return route.abort('blockedbyclient');
        }
        throw error;
      }

      const hostname = new URL(requestUrlString).hostname.toLowerCase();

      if (AD_SERVING_DOMAINS.some((domain) => hostname.includes(domain))) {
        console.log(hostname);
        return route.abort();
      }
      return route.continue();
    },
  );

  return { context: newContext, securityState };
};

const shutdownBrowser = async () => {
  if (browser) {
    await browser.close();
  }
};

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

const scrapePage = async (
  page: Page,
  url: string,
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle',
  waitAfterLoad: number,
  timeout: number,
  checkSelector: string | undefined,
  securityState: ContextSecurityState,
) => {
  console.log(
    `Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`,
  );
  let response;
  try {
    response = await page.goto(url, { waitUntil, timeout });
  } catch (error) {
    if (securityState.blockedNavigationRequestUrl) {
      throw new InsecureConnectionError(
        securityState.blockedNavigationRequestUrl,
        'navigation to private/internal resource is not allowed',
      );
    }
    throw error;
  }

  if (waitAfterLoad > 0) {
    await page.waitForTimeout(waitAfterLoad);
  }

  if (checkSelector) {
    try {
      await page.waitForSelector(checkSelector, { timeout });
    } catch (error) {
      throw new Error('Required selector not found');
    }
  }

  let headers = null,
    content = await page.content();
  let ct: string | undefined = undefined;
  if (response) {
    headers = await response.allHeaders();
    ct = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === 'content-type',
    )?.[1];
    if (
      ct &&
      (ct.toLowerCase().includes('application/json') ||
        ct.toLowerCase().includes('text/plain'))
    ) {
      content = (await response.body()).toString('utf8'); // TODO: determine real encoding
    }
  }

  return {
    content,
    status: response ? response.status() : null,
    headers,
    contentType: ct,
  };
};

app.get('/health', async (req: Request, res: Response) => {
  try {
    if (!browser) {
      await initializeBrowser();
    }

    const { context: testContext } = await createContext();
    const testPage = await testContext.newPage();
    await testPage.close();
    await testContext.close();

    res.status(200).json({
      status: 'healthy',
      maxConcurrentPages: MAX_CONCURRENT_PAGES,
      activePages: MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits(),
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

async function captureScrollScreenshots(page: Page, options: {
  quality?: number;
  scrollWait: number;
  maxScrolls: number;
}): Promise<string[]> {
  // Detect the real scroll container: some sites use a custom scrollable div
  // instead of body scroll (overflow:hidden on html/body, overflow:auto on a child).
  // We find the deepest element whose scrollHeight significantly exceeds viewport.
  const scrollContainerSelector: string | null = await page.evaluate(() => {
    const vh = window.innerHeight;
    // Check if normal body scrolling works
    const bodyScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    if (bodyScroll > vh * 1.5) return null; // body scroll works fine

    // Find the custom scroll container
    let best: HTMLElement | null = null;
    let bestHeight = 0;
    const candidates = document.querySelectorAll('main, [class*="scroll"], [class*="content"], [class*="wrapper"], [class*="app"], #root, #app, #__next');
    candidates.forEach(el => {
      const h = el.scrollHeight;
      if (h > vh * 1.5 && h > bestHeight) {
        best = el as HTMLElement;
        bestHeight = h;
      }
    });
    // Fallback: check direct children of body
    if (!best) {
      for (const child of document.body.children) {
        const h = (child as HTMLElement).scrollHeight;
        if (h > vh * 1.5 && h > bestHeight) {
          best = child as HTMLElement;
          bestHeight = h;
        }
      }
    }
    if (!best) return null;
    // Generate a selector for the element
    if (best.id) return '#' + best.id;
    // Tag + classes
    const tag = best.tagName.toLowerCase();
    const cls = Array.from(best.classList).slice(0, 3).map(c => '.' + c).join('');
    return tag + cls;
  });

  const useCustomContainer = scrollContainerSelector !== null;
  console.log(`Scroll container: ${useCustomContainer ? scrollContainerSelector : 'window (body scroll)'}`);

  // Remove fixed/sticky overlays that block content (cookie banners, modals)
  // Hide them (display:none) instead of removing to avoid layout collapse.
  await page.evaluate(() => {
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') return;
      const cs = window.getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.4 && rect.height > window.innerHeight * 0.4) {
          (el as HTMLElement).style.setProperty('display', 'none', 'important');
        }
      }
    });
  });

  // Disable smooth scrolling so scrollTo is instant
  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
  });

  if (!useCustomContainer) {
    // Only unlock overflow if it's actually hidden/clip — don't touch if already scrollable
    await page.evaluate(() => {
      const htmlOverflow = getComputedStyle(document.documentElement).overflow;
      const bodyOverflow = getComputedStyle(document.body).overflow;
      if (htmlOverflow === 'hidden' || htmlOverflow === 'clip') {
        document.documentElement.style.setProperty('overflow', 'auto', 'important');
      }
      if (bodyOverflow === 'hidden' || bodyOverflow === 'clip') {
        document.body.style.setProperty('overflow', 'auto', 'important');
      }
    });
  }
  await page.waitForTimeout(200);

  const viewportHeight = page.viewportSize()!.height;

  // Helper functions that work with either window scroll or custom container
  const getScrollHeight = async () => {
    if (useCustomContainer) {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.scrollHeight : 0;
      }, scrollContainerSelector!);
    }
    return page.evaluate(() => Math.max(
      document.body.scrollHeight, document.documentElement.scrollHeight,
      document.body.offsetHeight, document.documentElement.offsetHeight,
    ));
  };
  const scrollTo = async (y: number) => {
    if (useCustomContainer) {
      return page.evaluate(([sel, scrollY]) => {
        const el = document.querySelector(sel as string);
        if (el) {
          el.scrollTop = scrollY as number;
          el.dispatchEvent(new Event('scroll'));
        }
        window.dispatchEvent(new Event('scroll'));
      }, [scrollContainerSelector!, y] as const);
    }
    return page.evaluate((scrollY) => {
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
      window.dispatchEvent(new Event('scroll'));
    }, y);
  };
  const getScrollY = async () => {
    if (useCustomContainer) {
      return page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.scrollTop : 0;
      }, scrollContainerSelector!);
    }
    return page.evaluate(() => window.scrollY);
  };

  // Pre-scroll: walk the entire page to trigger lazy-loaded content
  let preScrollHeight = await getScrollHeight();
  for (let y = 0; y < preScrollHeight && y < options.maxScrolls * viewportHeight; y += viewportHeight) {
    await scrollTo(y);
    await page.waitForTimeout(150);
    preScrollHeight = await getScrollHeight();
  }
  // Scroll to very bottom
  await scrollTo(preScrollHeight);
  await page.waitForTimeout(options.scrollWait);
  // Back to top — force multiple times to ensure it sticks
  await scrollTo(0);
  await page.waitForTimeout(300);
  // Verify we're at top, retry if not
  const resetY = await getScrollY();
  if (resetY > 0) {
    console.log(`Scroll reset incomplete (at ${resetY}), forcing again`);
    await page.evaluate(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await page.waitForTimeout(300);
  }

  // Now measure the fully-expanded page
  const scrollHeight = await getScrollHeight();
  const totalPositions = Math.min(
    Math.ceil(scrollHeight / viewportHeight),
    options.maxScrolls
  );
  console.log(`Scroll metrics: viewportHeight=${viewportHeight}, scrollHeight=${scrollHeight}, totalPositions=${totalPositions}`);

  const screenshots: string[] = [];
  for (let i = 0; i < totalPositions; i++) {
    await scrollTo(i * viewportHeight);
    await page.waitForTimeout(options.scrollWait);

    // Verify the scroll actually moved
    const actualY = await getScrollY();
    if (i > 0 && actualY === 0) {
      console.log(`Scroll stuck at position 0 after ${i} attempts, stopping`);
      break;
    }

    const screenshotOptions: any = { type: 'png' as const, fullPage: false };
    if (options.quality !== undefined) {
      screenshotOptions.type = 'jpeg';
      screenshotOptions.quality = options.quality;
    }
    const buffer = await page.screenshot(screenshotOptions);
    const mime = screenshotOptions.type === 'jpeg' ? 'image/jpeg' : 'image/png';
    screenshots.push(`data:${mime};base64,${buffer.toString('base64')}`);
  }

  // Scroll back to top
  await scrollTo(0);
  return screenshots;
}

app.get('/devices', (_req: Request, res: Response) => {
  const deviceList = Object.entries(devices).map(([name, desc]) => ({
    name,
    viewport: desc.viewport,
    isMobile: desc.isMobile,
    hasTouch: desc.hasTouch,
    deviceScaleFactor: desc.deviceScaleFactor,
  }));
  res.json(deviceList);
});

app.post('/scrape', async (req: Request, res: Response) => {
  const {
    url,
    wait_after_load = 0,
    timeout = 15000,
    headers,
    check_selector,
    skip_tls_verification = false,
    execute_javascript,
    screenshot: screenshot_requested,
    screenshot_full_page,
    screenshot_quality,
    screenshot_viewport,
    screenshot_scroll_capture,
    screenshot_scroll_wait,
    screenshot_max_scrolls,
    screenshot_device,
    dismiss_cookie_banners = true,
    wait_until = 'load',
    track_bytes_downloaded = false,
    proxy: request_proxy,
  }: UrlModel = req.body;

  console.log(`================= Scrape Request =================`);
  console.log(`URL: ${url}`);
  console.log(`Wait After Load: ${wait_after_load}`);
  console.log(`Timeout: ${timeout}`);
  console.log(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
  console.log(`Check Selector: ${check_selector ? check_selector : 'None'}`);
  console.log(`Skip TLS Verification: ${skip_tls_verification}`);
  console.log(`==================================================`);

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    await assertSafeTargetUrl(url);
  } catch (error) {
    if (error instanceof InsecureConnectionError) {
      return res.json({
        content: '',
        pageStatusCode: 403,
        pageError: error.message,
      });
    }
    throw error;
  }

  if (!PROXY_SERVER) {
    console.warn(
      '⚠️ WARNING: No proxy server provided. Your IP address may be blocked.',
    );
  }

  if (screenshot_device && !devices[screenshot_device]) {
    return res.status(400).json({
      error: `Unknown device "${screenshot_device}". Use Playwright device names like "iPhone 14", "iPad Pro 11", "Galaxy S9+", etc.`,
    });
  }

  if (!browser) {
    await initializeBrowser();
  }

  await pageSemaphore.acquire();

  let requestContext: BrowserContext | null = null;
  let securityState: ContextSecurityState | null = null;
  let page: Page | null = null;
  let byteTracker: { total: number; session: any } | null = null;

  try {
    const shouldBlockMedia = execute_javascript ? false : BLOCK_MEDIA;
    // Extract user-agent from request headers (case-insensitive) so it can
    // be applied at the context level.  Playwright ignores user-agent in
    // setExtraHTTPHeaders when the context already defines one (#2802).
    const userAgentOverride = headers
      ? Object.entries(headers).find(
          ([k]) => k.toLowerCase() === 'user-agent',
        )?.[1]
      : undefined;

    const contextBundle = await createContext(
      skip_tls_verification,
      shouldBlockMedia,
      screenshot_device,
      request_proxy,
      userAgentOverride,
    );
    requestContext = contextBundle.context;
    securityState = contextBundle.securityState;
    page = await requestContext.newPage();

    // CDP byte tracking (opt-in)
    byteTracker = track_bytes_downloaded ? { total: 0, session: null as any } : null;
    if (byteTracker) {
      const tracker = byteTracker;
      const cdpSession = await requestContext.newCDPSession(page);
      await cdpSession.send('Network.enable');
      cdpSession.on('Network.loadingFinished', (params: any) => {
        tracker.total += params.encodedDataLength ?? 0;
      });
      tracker.session = cdpSession;
    }

    if (headers) {
      // A Cookie header passed through setExtraHTTPHeaders is sent on the first
      // request but DROPPED on any redirect hop (the browser regenerates the
      // redirected request from its cookie jar, which is empty). Authenticated
      // sites that 302 (e.g. to /signin when the session looks absent) then
      // land on the login page. Seed the cookie jar instead so Chromium re-sends
      // it on every request, including redirects — matching what a raw HTTP
      // client does.
      const cookieHeader = Object.entries(headers).find(
        ([k]) => k.toLowerCase() === 'cookie',
      )?.[1];
      if (cookieHeader) {
        // Scope cookies to the registrable domain (e.g. ".example.com"), not
        // host-only. Authenticated pages often 302 across sibling subdomains
        // (example.com -> app.example.com); a host-only cookie set for the
        // original host would not be sent to the redirect target, leaving the
        // request unauthenticated. The Cookie header carries no domain info, so
        // we apply the eTLD+1 — broad enough to follow the redirect, and these
        // are first-party cookies being returned to their own origin anyway.
        let cookieDomain: string | undefined;
        try {
          const host = new URL(url).hostname;
          const labels = host.split('.');
          cookieDomain = labels.length > 2 ? labels.slice(-2).join('.') : host;
        } catch {
          cookieDomain = undefined;
        }
        type SeedCookie = {
          name: string;
          value: string;
          url?: string;
          domain?: string;
          path?: string;
        };
        const cookies = cookieHeader
          .split(';')
          .map((pair) => pair.trim())
          .filter(Boolean)
          .map((pair): SeedCookie | null => {
            const eq = pair.indexOf('=');
            if (eq === -1) return null;
            const name = pair.slice(0, eq).trim();
            const value = pair.slice(eq + 1).trim();
            return cookieDomain
              ? { name, value, domain: `.${cookieDomain}`, path: '/' }
              : { name, value, url };
          })
          .filter((c): c is SeedCookie => c !== null);
        if (cookies.length > 0) {
          try {
            await requestContext.addCookies(cookies);
          } catch (error) {
            console.warn('Failed to seed cookies from Cookie header:', error);
          }
        }
      }

      // Remove user-agent (already applied at the context level) and cookie
      // (now seeded into the jar) before forwarding the rest verbatim.
      const filteredHeaders = Object.fromEntries(
        Object.entries(headers).filter(([k]) => {
          const lower = k.toLowerCase();
          return lower !== 'user-agent' && lower !== 'cookie';
        }),
      );
      if (Object.keys(filteredHeaders).length > 0) {
        await page.setExtraHTTPHeaders(filteredHeaders);
      }
    }

    const result = await scrapePage(
      page,
      url,
      wait_until,
      wait_after_load,
      timeout,
      check_selector,
      securityState,
    );
    const pageError =
      result.status !== 200 ? getError(result.status) : undefined;

    if (!pageError) {
      console.log(`✅ Scrape successful!`);
    } else {
      console.log(
        `🚨 Scrape failed with status code: ${result.status} ${pageError}`,
      );
    }

    // Cookie banner dismissal
    const shouldDismissCookies = dismiss_cookie_banners && DISMISS_COOKIE_BANNERS;
    if (shouldDismissCookies) {
      try {
        const dismissResult = await page.evaluate(COOKIE_DISMISS_SCRIPT) as { dismissed: boolean; method: string } | null;
        if (dismissResult?.dismissed) {
          console.log(`Cookie banner dismissed via: ${dismissResult.method}`);
        }
        await page.waitForTimeout(500);
      } catch (error) {
        console.error('Cookie dismissal error (non-fatal):', error);
      }
    }

    // JavaScript execution
    let javascriptReturn: string | undefined;
    if (execute_javascript) {
      try {
        const jsResult = await page.evaluate(execute_javascript);
        javascriptReturn = JSON.stringify({ type: typeof jsResult, value: jsResult });
      } catch (error) {
        console.error('JavaScript execution error:', error);
      }
    }

    // Screenshot capture
    let screenshotData: string | undefined;
    let screenshotsData: string[] | undefined;

    console.log(`Screenshot flags: scroll_capture=${screenshot_scroll_capture}, requested=${screenshot_requested}, full_page=${screenshot_full_page}`);
    if (screenshot_scroll_capture && (screenshot_requested || screenshot_full_page)) {
      try {
        if (screenshot_viewport) {
          await page.setViewportSize(screenshot_viewport);
        }
        console.log(`Starting scroll capture with maxScrolls=${screenshot_max_scrolls ?? 20}`);
        screenshotsData = await captureScrollScreenshots(page, {
          quality: screenshot_quality,
          scrollWait: screenshot_scroll_wait ?? 300,
          maxScrolls: screenshot_max_scrolls ?? 20,
        });
        console.log(`Scroll capture complete: ${screenshotsData.length} screenshots`);
        screenshotData = screenshotsData[0]; // backward compat
      } catch (error) {
        console.error('Scroll screenshot error:', error);
      }
    } else if (screenshot_requested || screenshot_full_page) {
      try {
        if (screenshot_viewport) {
          await page.setViewportSize(screenshot_viewport);
        }
        const screenshotOptions: any = {
          type: 'png' as const,
          fullPage: !!screenshot_full_page,
        };
        if (screenshot_quality !== undefined) {
          screenshotOptions.type = 'jpeg';
          screenshotOptions.quality = screenshot_quality;
        }
        const buffer = await page.screenshot(screenshotOptions);
        const mimeType = screenshotOptions.type === 'jpeg' ? 'image/jpeg' : 'image/png';
        screenshotData = `data:${mimeType};base64,${buffer.toString('base64')}`;
      } catch (error) {
        console.error('Screenshot error:', error);
      }
    }

    res.json({
      content: result.content,
      pageStatusCode: result.status,
      contentType: result.contentType,
      ...(pageError && { pageError }),
      ...(javascriptReturn !== undefined && { javascriptReturn }),
      ...(screenshotData !== undefined && { screenshot: screenshotData }),
      ...(screenshotsData !== undefined && { screenshots: screenshotsData }),
      ...(byteTracker ? { bytesDownloaded: byteTracker.total } : {}),
    });
  } catch (error) {
    if (error instanceof InsecureConnectionError) {
      return res.json({
        content: '',
        pageStatusCode: 403,
        pageError: error.message,
      });
    }
    console.error('Scrape error:', error);
    res
      .status(500)
      .json({ error: 'An error occurred while fetching the page.' });
  } finally {
    if (byteTracker?.session) {
      try { await byteTracker.session.detach(); } catch (_) {}
    }
    if (page) await page.close();
    if (requestContext) await requestContext.close();
    pageSemaphore.release();
  }
});

const start = async () => {
  ssrfProxyPort = await startSSRFProxy();
  await initializeBrowser();
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
};
start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

if (require.main === module) {
  process.on('SIGINT', () => {
    shutdownBrowser().then(() => {
      console.log('Browser closed');
      process.exit(0);
    });
  });
}
