/**
 * Scraper dla Bechcicki.pl
 * Hurtownia materiałów budowlanych i wykończeniowych
 */
import { Page } from 'puppeteer';
import { BaseScraper } from './base';
import { ScrapedProduct } from '../db/prices';
import { Kategoria, SELLERS } from '../config';
import logger from '../utils/logger';

/** Mapowanie kategorii na URL-e Bechcicki */
const CATEGORY_URLS: Partial<Record<Kategoria, string[]>> = {
  cement: ['/cement-i-beton'],
  ceramika: ['/plytki-ceramiczne', '/plytki-gresowe'],
  'chemia-budowlana': ['/chemia-budowlana', '/kleje-do-plytek'],
  izolacja: ['/izolacje'],
  instalacje: ['/instalacje-sanitarne'],
};

export class BechcickiScraper extends BaseScraper {
  constructor() {
    super('Bechcicki', SELLERS.bechcicki.baseUrl);
  }

  /**
   * Scrapuj produkty z bechcicki.pl
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
            `❌ [Bechcicki] Błąd scrapingu ${category}: ${(error as Error).message}`
          );
        }
      }
    }

    return allProducts;
  }

  /**
   * Scrapuj jedną kategorię z bechcicki.pl
   */
  private async scrapeCategory(
    page: Page,
    category: Kategoria,
    urlPath: string
  ): Promise<ScrapedProduct[]> {
    const fullUrl = `${this.baseUrl}${urlPath}`;
    logger.info(`🔍 [Bechcicki] Scrapuję: ${fullUrl}`);

    await page.goto(fullUrl, { waitUntil: 'networkidle2' });
    await this.closeCookiePopup(page);

    // Poczekaj na produkty
    await page.waitForSelector(
      '.product-item, .product-card, .product, [class*="product"]',
      { timeout: 10_000 }
    ).catch(() => {
      logger.warn(`⚠️ [Bechcicki] Brak produktów na: ${urlPath}`);
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
        '.product-item, .product-card, .product, [class*="product-list"] > *, [class*="productCard"]'
      );

      cards.forEach((card) => {
        const nameEl = card.querySelector(
          '.product-name, .name, h2, h3, [class*="title"], a[class*="name"]'
        ) as HTMLElement;
        const priceEl = card.querySelector(
          '.product-price, .price, [class*="price"]:not([class*="old"]):not([class*="crossed"])'
        ) as HTMLElement;
        const originalPriceEl = card.querySelector(
          '.old-price, .price-old, [class*="crossed"], del'
        ) as HTMLElement;
        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement;
        const unitEl = card.querySelector(
          '.unit, [class*="unit"], [class*="measure"]'
        ) as HTMLElement;

        if (nameEl && priceEl) {
          items.push({
            name: nameEl.textContent?.trim() || '',
            price: priceEl.textContent?.trim() || '',
            originalPrice: originalPriceEl?.textContent?.trim() || '',
            url: linkEl?.href || '',
            unit: unitEl?.textContent?.trim() || 'szt.',
            id: card.getAttribute('data-product-id') || card.getAttribute('data-id') || linkEl?.href?.split('/').pop() || '',
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
          sellerSlug: 'bechcicki',
          categorySlug: category,
          externalId: item.id || `bech-${item.name.substring(0, 50)}`,
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
