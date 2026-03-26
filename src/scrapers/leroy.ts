/**
 * Scraper dla Leroy Merlin Polska (leroymerlin.pl)
 * Pobiera ceny materiałów budowlanych
 */
import { Page } from 'puppeteer';
import { BaseScraper } from './base';
import { ScrapedProduct } from '../db/prices';
import { Kategoria, SELLERS } from '../config';
import logger from '../utils/logger';

/** Mapowanie kategorii na URL-e Leroy Merlin */
const CATEGORY_URLS: Partial<Record<Kategoria, string[]>> = {
  cement: [
    '/produkty/cement-i-zaprawy/',
    '/produkty/beton-gotowy/',
  ],
  stal: [
    '/produkty/profile-stalowe/',
  ],
  drewno: [
    '/produkty/drewno-konstrukcyjne/',
    '/produkty/deski-podlogowe/',
  ],
  izolacja: [
    '/produkty/izolacja-termiczna/',
    '/produkty/styropian/',
    '/produkty/welna-mineralna/',
  ],
  ceramika: [
    '/produkty/plytki-ceramiczne/',
    '/produkty/plytki-podlogowe/',
  ],
  'chemia-budowlana': [
    '/produkty/chemia-budowlana/',
    '/produkty/kleje-i-fugi/',
  ],
  instalacje: [
    '/produkty/rury-i-zlaczki/',
    '/produkty/instalacje-elektryczne/',
  ],
  dachy: [
    '/produkty/pokrycia-dachowe/',
    '/produkty/rynny/',
  ],
  'okna-drzwi': [
    '/produkty/okna/',
    '/produkty/drzwi/',
  ],
  narzedzia: [
    '/produkty/narzedzia-reczne/',
    '/produkty/elektronarzedzia/',
  ],
};

export class LeroyScraper extends BaseScraper {
  constructor() {
    super('Leroy Merlin', SELLERS.leroy.baseUrl);
  }

  /**
   * Scrapuj produkty z leroymerlin.pl
   */
  async scrapeProducts(page: Page): Promise<ScrapedProduct[]> {
    const allProducts: ScrapedProduct[] = [];

    for (const [category, urls] of Object.entries(CATEGORY_URLS)) {
      for (const url of urls) {
        try {
          const products = await this.scrapeCategory(
            page,
            category as Kategoria,
            url
          );
          allProducts.push(...products);
        } catch (error) {
          logger.error(
            `❌ [Leroy Merlin] Błąd scrapingu ${category}: ${(error as Error).message}`
          );
        }
      }
    }

    return allProducts;
  }

  /**
   * Scrapuj jedną kategorię ze strony Leroy Merlin
   */
  private async scrapeCategory(
    page: Page,
    category: Kategoria,
    urlPath: string
  ): Promise<ScrapedProduct[]> {
    const fullUrl = `${this.baseUrl}${urlPath}`;
    logger.info(`🔍 [Leroy Merlin] Scrapuję: ${fullUrl}`);

    await page.goto(fullUrl, { waitUntil: 'networkidle2' });

    // Zamknij cookies
    await this.closeCookiePopup(page);

    // Poczekaj na listę produktów
    await page.waitForSelector(
      '[class*="product-card"], [class*="ProductCard"], .mc-card, [data-testid*="product"]',
      { timeout: 10_000 }
    ).catch(() => {
      logger.warn(`⚠️ [Leroy Merlin] Brak produktów na: ${urlPath}`);
    });

    // Lazy loading - przewiń stronę
    await this.scrollPage(page, 4);

    // Wyciągnij dane produktów z DOM
    const products = await page.evaluate(() => {
      const items: Array<{
        name: string;
        price: string;
        originalPrice: string;
        url: string;
        unit: string;
        id: string;
      }> = [];

      const cards = document.querySelectorAll(
        '[class*="product-card"], [class*="ProductCard"], .mc-card, [data-testid*="product"]'
      );

      cards.forEach((card) => {
        const nameEl = card.querySelector(
          '[class*="product-name"], [class*="title"], h2, h3, [data-testid="product-name"]'
        ) as HTMLElement;
        const priceEl = card.querySelector(
          '[class*="price-integer"], [class*="price__main"], [data-testid="product-price"]'
        ) as HTMLElement;
        const decimalEl = card.querySelector(
          '[class*="price-decimal"]'
        ) as HTMLElement;
        const originalPriceEl = card.querySelector(
          '[class*="price--old"], [class*="crossed-price"], [class*="price-before"]'
        ) as HTMLElement;
        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement;
        const unitEl = card.querySelector(
          '[class*="unit"], [class*="price-per"]'
        ) as HTMLElement;

        if (nameEl && priceEl) {
          // Leroy Merlin rozdziela cenę na część całkowitą i dziesiętną
          let priceText = priceEl.textContent?.trim() || '';
          if (decimalEl) {
            priceText += ',' + decimalEl.textContent?.trim();
          }

          items.push({
            name: nameEl.textContent?.trim() || '',
            price: priceText,
            originalPrice: originalPriceEl?.textContent?.trim() || '',
            url: linkEl?.href || '',
            unit: unitEl?.textContent?.trim() || 'szt.',
            id:
              card.getAttribute('data-product-id') ||
              card.getAttribute('data-sku') ||
              linkEl?.href?.split('/').pop() ||
              '',
          });
        }
      });

      return items;
    });

    // Parsowanie wyników
    return products
      .map((item) => {
        const price = this.parsePrice(item.price);
        if (!price || price <= 0) return null;

        const originalPrice = this.parsePrice(item.originalPrice);

        return {
          sellerSlug: 'leroy',
          categorySlug: category,
          externalId: item.id || `leroy-${item.name.substring(0, 50)}`,
          name: item.name,
          price,
          originalPrice: originalPrice || undefined,
          isPromo: originalPrice != null && originalPrice > price,
          url: item.url,
          unit: item.unit || 'szt.',
        } as ScrapedProduct;
      })
      .filter((p): p is ScrapedProduct => p !== null);
  }
}
