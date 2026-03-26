/**
 * Abstrakcyjna klasa bazowa dla scraperów
 * Zawiera logikę retry, obsługę proxy i wspólne narzędzia
 */
import puppeteer, { Browser, Page } from 'puppeteer';
import { config } from '../config';
import { ScrapedProduct } from '../db/prices';
import logger from '../utils/logger';

/** Opcje scrapera */
export interface ScraperOptions {
  /** Maksymalna liczba prób */
  maxRetries?: number;
  /** Opóźnienie między próbami (ms) */
  retryDelay?: number;
  /** Timeout ładowania strony (ms) */
  pageTimeout?: number;
  /** URL proxy (opcjonalny) */
  proxyUrl?: string;
}

export abstract class BaseScraper {
  protected name: string;
  protected baseUrl: string;
  protected options: Required<ScraperOptions>;
  protected browser: Browser | null = null;

  constructor(name: string, baseUrl: string, options?: ScraperOptions) {
    this.name = name;
    this.baseUrl = baseUrl;
    this.options = {
      maxRetries: options?.maxRetries ?? config.SCRAPE_RETRY_COUNT,
      retryDelay: options?.retryDelay ?? config.SCRAPE_RETRY_DELAY_MS,
      pageTimeout: options?.pageTimeout ?? 30_000,
      proxyUrl: options?.proxyUrl ?? config.PROXY_URL ?? '',
    };
  }

  /**
   * Metoda abstrakcyjna - implementacja scrapingu dla konkretnego sklepu
   */
  abstract scrapeProducts(page: Page): Promise<ScrapedProduct[]>;

  /**
   * Uruchom przeglądarkę Puppeteer
   */
  protected async launchBrowser(): Promise<Browser> {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1920,1080',
    ];

    // Dodaj proxy jeśli skonfigurowany
    if (this.options.proxyUrl) {
      args.push(`--proxy-server=${this.options.proxyUrl}`);
    }

    this.browser = await puppeteer.launch({
      headless: true,
      args,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    return this.browser;
  }

  /**
   * Zamknij przeglądarkę
   */
  protected async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Utwórz nową stronę z domyślnymi ustawieniami
   */
  protected async createPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();

    // Ustaw viewport i user-agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Timeout strony
    page.setDefaultNavigationTimeout(this.options.pageTimeout);
    page.setDefaultTimeout(this.options.pageTimeout);

    // Blokuj niepotrzebne zasoby (szybszy scraping)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  /**
   * Wykonaj scraping z retry
   */
  async scrape(): Promise<ScrapedProduct[]> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxRetries; attempt++) {
      try {
        logger.info(`🔄 [${this.name}] Scraping - próba ${attempt}/${this.options.maxRetries}`);

        const browser = await this.launchBrowser();
        const page = await this.createPage(browser);

        try {
          const products = await this.scrapeProducts(page);
          logger.info(`✅ [${this.name}] Zescrapowano ${products.length} produktów`);
          return products;
        } finally {
          await this.closeBrowser();
        }
      } catch (error) {
        lastError = error as Error;
        logger.warn(
          `⚠️ [${this.name}] Próba ${attempt} nie powiodła się: ${lastError.message}`
        );

        if (attempt < this.options.maxRetries) {
          const delay = this.options.retryDelay * attempt; // Rosnące opóźnienie
          logger.info(`⏳ [${this.name}] Czekam ${delay}ms przed kolejną próbą...`);
          await this.sleep(delay);
        }
      }
    }

    logger.error(`❌ [${this.name}] Scraping nie powiódł się po ${this.options.maxRetries} próbach`);
    throw lastError || new Error(`Scraping ${this.name} nie powiódł się`);
  }

  /**
   * Bezpieczne kliknięcie z oczekiwaniem na element
   */
  protected async safeClick(page: Page, selector: string): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Zamknij popup cookies (typowe dla polskich sklepów)
   */
  protected async closeCookiePopup(page: Page): Promise<void> {
    const cookieSelectors = [
      '[data-testid="cookie-accept"]',
      '#cookie-accept',
      '.cookie-accept',
      'button[class*="cookie"]',
      '[id*="onetrust"] button',
      '.cmp-accept-all',
      'button:has-text("Akceptuję")',
      'button:has-text("Zgadzam się")',
      'button:has-text("Rozumiem")',
    ];

    for (const selector of cookieSelectors) {
      const closed = await this.safeClick(page, selector);
      if (closed) {
        logger.debug(`🍪 [${this.name}] Zamknięto popup cookies`);
        await this.sleep(1000);
        return;
      }
    }
  }

  /**
   * Wyciągnij cenę z tekstu (obsługa polskiego formatu)
   */
  protected parsePrice(text: string): number | null {
    if (!text) return null;
    // Obsługa formatów: "123,45 zł", "1 234,56", "123.45"
    const cleaned = text
      .replace(/[^\d,.\s]/g, '') // Usuń wszystko poza cyframi, przecinkami, kropkami
      .replace(/\s/g, '')        // Usuń spacje
      .replace(',', '.');        // Zamień przecinek na kropkę
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }

  /**
   * Opóźnienie (sleep)
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Przewiń stronę w dół (lazy loading)
   */
  protected async scrollPage(page: Page, scrolls: number = 5): Promise<void> {
    for (let i = 0; i < scrolls; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight);
      });
      await this.sleep(1000);
    }
  }
}
