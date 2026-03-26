/**
 * Scraper dla 3wdb.pl (3W Dystrybucja Budowlana)
 * Hurtownia materiałów budowlanych
 */
import { Page } from 'puppeteer';
import { BaseScraper } from './base';
import { ScrapedProduct } from '../db/prices';
import { Kategoria, SELLERS } from '../config';
import logger from '../utils/logger';

/** Mapowanie kategorii na URL-e 3W */
const CATEGORY_URLS: Partial<Record<Kategoria, string[]>> = {
  cement: ['/kategoria/cementy-i-zaprawy'],
  izolacja: ['/kategoria/izolacje', '/kategoria/styropian'],
  'chemia-budowlana': ['/kategoria/chemia-budowlana'],
  dachy: ['/kategoria/pokrycia-dachowe'],
  instalacje: ['/kategoria/instalacje'],
};

export class TrzywScraper extends BaseScraper {
  constructor() {
    super('3W', SELLERS.trzyw.baseUrl);
  }

  /**
   * Scrapuj produkty z 3wdb.pl
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
            `❌ [3W] Błąd scrapingu ${category}: ${(error as Error).message}`
          );
        }
      }
    }

    return allProducts;
  }

  /**
   * Scrapuj jedną kategorię z 3wdb.pl
   */
  private async scrapeCategory(
    page: Page,
    category: Kategoria,
    urlPath: string
  ): Promise<ScrapedProduct[]> {
    const fullUrl = `${this.baseUrl}${urlPath}`;
    logger.info(`🔍 [3W] Scrapuję: ${fullUrl}`);

    await page.goto(fullUrl, { waitUntil: 'networkidle2' });
    await this.closeCookiePopup(page);

    // Poczekaj na produkty
    await page.waitForSelector(
      '.product-item, .product-card, [class*="product"]',
      { timeout: 10_000 }
    ).catch(() => {
      logger.warn(`⚠️ [3W] Brak produktów na: ${urlPath}`);
    });

    await this.scrollPage(page, 3);

    // Wyciągnij dane produktów
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
        '.product-item, .product-card, [class*="product-list"] > div, [class*="ProductCard"]'
      );

      cards.forEach((card) => {
        const nameEl = card.querySelector(
          '.product-name, .product-title, h2, h3, a[class*="name"]'
        ) as HTMLElement;
        const priceEl = card.querySelector(
          '.product-price, .price, [class*="price"]:not([class*="old"])'
        ) as HTMLElement;
        const originalPriceEl = card.querySelector(
          '.old-price, .price-old, [class*="old-price"], [class*="crossed"]'
        ) as HTMLElement;
        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement;
        const unitEl = card.querySelector(
          '.product-unit, [class*="unit"]'
        ) as HTMLElement;

        if (nameEl && priceEl) {
          items.push({
            name: nameEl.textContent?.trim() || '',
            price: priceEl.textContent?.trim() || '',
            originalPrice: originalPriceEl?.textContent?.trim() || '',
            url: linkEl?.href || '',
            unit: unitEl?.textContent?.trim() || 'szt.',
            id: card.getAttribute('data-id') || linkEl?.href?.split('/').pop() || '',
          });
        }
      });

      return items;
    });

    return products
      .map((item) => {
        const price = this.parsePrice(item.price);
        if (!price || price <= 0) return null;

        const originalPrice = this.parsePrice(item.originalPrice);

        return {
          sellerSlug: 'trzyw',
          categorySlug: category,
          externalId: item.id || `3w-${item.name.substring(0, 50)}`,
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
