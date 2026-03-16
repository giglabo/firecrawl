import express, { Request, Response } from 'express';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page, devices } from 'playwright';
import dotenv from 'dotenv';
import UserAgent from 'user-agents';
import { getError } from './helpers/get_error';
import { getCookieDismissScript } from './helpers/dismiss_cookie_banners';

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(express.json());

const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const DISMISS_COOKIE_BANNERS = (process.env.DISMISS_COOKIE_BANNERS ?? 'TRUE').toUpperCase() === 'TRUE';
const COOKIE_DISMISS_SCRIPT = getCookieDismissScript();
const MAX_CONCURRENT_PAGES = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT_PAGES ?? '10', 10) || 10);

const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;
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
  'amazon-adsystem.com'
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
      '--disable-gpu'
    ]
  });
};

const createContext = async (
  skipTlsVerification: boolean = false,
  blockMedia: boolean = BLOCK_MEDIA,
  deviceName?: string,
  proxyConfig?: { server: string; username?: string; password?: string },
) => {
  const deviceDescriptor = deviceName ? devices[deviceName] : undefined;
  const userAgent = deviceDescriptor?.userAgent ?? new UserAgent().toString();
  const viewport = deviceDescriptor?.viewport ?? { width: 1280, height: 800 };

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
  };

  // Proxy resolution: per-request > global env > none
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
  }

  const newContext = await browser.newContext(contextOptions);

  if (blockMedia) {
    await newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', async (route: Route, request: PlaywrightRequest) => {
      await route.abort();
    });
  }

  // Intercept all requests to avoid loading ads
  await newContext.route('**/*', (route: Route, request: PlaywrightRequest) => {
    const requestUrl = new URL(request.url());
    const hostname = requestUrl.hostname;

    if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
      console.log(hostname);
      return route.abort();
    }
    return route.continue();
  });
  
  return newContext;
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

const scrapePage = async (page: Page, url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle', waitAfterLoad: number, timeout: number, checkSelector: string | undefined) => {
  console.log(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
  const response = await page.goto(url, { waitUntil, timeout });

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

  let headers = null, content = await page.content();
  let ct: string | undefined = undefined;
  if (response) {
    headers = await response.allHeaders();
    ct = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
    if (ct && (ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/plain"))) {
      content = (await response.body()).toString("utf8"); // TODO: determine real encoding
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
    
    const testContext = await createContext();
    const testPage = await testContext.newPage();
    await testPage.close();
    await testContext.close();
    
    res.status(200).json({ 
      status: 'healthy',
      maxConcurrentPages: MAX_CONCURRENT_PAGES,
      activePages: MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

async function captureScrollScreenshots(page: Page, options: {
  quality?: number;
  scrollWait: number;
  maxScrolls: number;
}): Promise<string[]> {
  // Force-enable scrolling: remove overflow:hidden and nuke fixed overlays
  await page.evaluate(() => {
    // Use setProperty with !important directly on elements — wins over <style> tags
    document.documentElement.style.setProperty('overflow', 'auto', 'important');
    document.documentElement.style.setProperty('height', 'auto', 'important');
    document.documentElement.style.setProperty('position', 'static', 'important');
    document.body.style.setProperty('overflow', 'auto', 'important');
    document.body.style.setProperty('height', 'auto', 'important');
    document.body.style.setProperty('position', 'static', 'important');

    // Remove fixed/sticky overlays that block content (cookie banners, modals)
    document.querySelectorAll('*').forEach(el => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') return;
      const cs = window.getComputedStyle(el);
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const rect = (el as HTMLElement).getBoundingClientRect();
        // Only remove large overlays (covering >40% of viewport)
        if (rect.width > window.innerWidth * 0.4 && rect.height > window.innerHeight * 0.4) {
          (el as HTMLElement).remove();
        }
      }
    });
  });
  await page.waitForTimeout(200);

  const viewportHeight = page.viewportSize()!.height;
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const totalPositions = Math.min(
    Math.ceil(scrollHeight / viewportHeight),
    options.maxScrolls
  );

  const screenshots: string[] = [];
  for (let i = 0; i < totalPositions; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * viewportHeight);
    await page.waitForTimeout(options.scrollWait);

    // Verify the scroll actually moved
    const actualY = await page.evaluate(() => window.scrollY);
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
  await page.evaluate(() => window.scrollTo(0, 0));
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

  if (!PROXY_SERVER) {
    console.warn('⚠️ WARNING: No proxy server provided. Your IP address may be blocked.');
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
  let page: Page | null = null;
  let byteTracker: { total: number; session: any } | null = null;

  try {
    const shouldBlockMedia = execute_javascript ? false : BLOCK_MEDIA;
    requestContext = await createContext(skip_tls_verification, shouldBlockMedia, screenshot_device, request_proxy);
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
      await page.setExtraHTTPHeaders(headers);
    }

    const result = await scrapePage(page, url, wait_until, wait_after_load, timeout, check_selector);
    const pageError = result.status !== 200 ? getError(result.status) : undefined;

    if (!pageError) {
      console.log(`✅ Scrape successful!`);
    } else {
      console.log(`🚨 Scrape failed with status code: ${result.status} ${pageError}`);
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

    if (screenshot_scroll_capture && (screenshot_requested || screenshot_full_page)) {
      try {
        if (screenshot_viewport) {
          await page.setViewportSize(screenshot_viewport);
        }
        screenshotsData = await captureScrollScreenshots(page, {
          quality: screenshot_quality,
          scrollWait: screenshot_scroll_wait ?? 300,
          maxScrolls: screenshot_max_scrolls ?? 20,
        });
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
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'An error occurred while fetching the page.' });
  } finally {
    if (byteTracker?.session) {
      try { await byteTracker.session.detach(); } catch (_) {}
    }
    if (page) await page.close();
    if (requestContext) await requestContext.close();
    pageSemaphore.release();
  }
});

app.listen(port, () => {
  initializeBrowser().then(() => {
    console.log(`Server is running on port ${port}`);
  });
});

if (require.main === module) {
  process.on('SIGINT', () => {
    shutdownBrowser().then(() => {
      console.log('Browser closed');
      process.exit(0);
    });
  });
}
