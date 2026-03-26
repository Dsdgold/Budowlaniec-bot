/**
 * Scraper dla Castorama.pl
 * Pobiera ceny materiałów budowlanych ze strony Castorama
 */
import { Page } from 'puppeteer';
import { BaseScraper } from './base';
import { ScrapedProduct } from '../db/prices';
import { Kategoria, SELLERS } from '../config';
import logger from '../utils/logger';

/** Mapowanie kategorii na URL-e Castorama */
const CATEGORY_URLS: Partial<Record<Kategoria, string[]>> = {
  cement: [
    '/c/budowa/cementy-zaprawy-i-mieszanki/cementy.html',
    '/c/budowa/cementy-zaprawy-i-mieszanki/zaprawy.html',
  ],
  stal: [
    '/c/budowa/profile-i-ksztaltowniki-stalowe.html',
  ],
  drewno: [
    '/c/budowa/drewno-budowlane.html',
    '/c/budowa/deski-i-listwy.html',
  ],
  izolacja: [
    '/c/budowa/izolacje-termiczne.html',
    '/c/budowa/styropian.html',
  ],
  ceramika: [
    '/c/lazienka/plytki-lazienkowe.html',
    '/c/kuchnia/plytki-kuchenne.html',
  ],
  'chemia-budowlana': [
    '/c/budowa/chemia-budowlana.html',
  ],
  dachy: [
    '/c/budowa/pokrycia-dachowe.html',
  ],
  'okna-drzwi': [
    '/c/okna-i-drzwi.html',
  ],
  narzedzia: [
    '/c/narzedzia.html',
  ],
};

export class CastoramaScraper extends BaseScraper {
  constructor() {
    super('Castorama', SELLERS.castorama.baseUrl);
  }

  /**
   * Scrapuj produkty z Castorama.pl
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
            `❌ [Castorama] Błąd scrapingu kategorii ${category}: ${(error as Error).message}`
          );
        }
      }
    }

    return allProducts;
  }

  /**
   * Scrapuj jedną kategorię
   */
  private async scrapeCategory(
    page: Page,
    category: Kategoria,
    urlPath: string
  ): Promise<ScrapedProduct[]> {
    const fullUrl = `${this.baseUrl}${urlPath}`;
    logger.info(`🔍 [Castorama] Scrapuję: ${fullUrl}`);

    await page.goto(fullUrl, { waitUntil: 'networkidle2' });

    // Zamknij popup cookies
    await this.closeCookiePopup(page);

    // Poczekaj na załadowanie produktów
    await page.waitForSelector('[data-testid="product-card"], .product-card, .product-tile', {
      timeout: 10_000,
    }).catch(() => {
      logger.warn(`⚠️ [Castorama] Brak produktów na: ${urlPath}`);
    });

    // Przewiń stronę (lazy loading)
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

      // Selektory produktów Castorama
      const cards = document.querySelectorAll(
        '[data-testid="product-card"], .product-card, .product-tile, [class*="ProductCard"]'
      );

      cards.forEach((card) => {
        const nameEl =
          card.querySelector('[data-testid="product-title"], .product-name, h2, h3') as HTMLElement;
        const priceEl =
          card.querySelector('[data-testid="product-price"], .product-price, [class*="price"]') as HTMLElement;
        const originalPriceEl =
          card.querySelector('[data-testid="original-price"], .original-price, [class*="crossed"]') as HTMLElement;
        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement;
        const unitEl =
          card.querySelector('[data-testid="product-unit"], .product-unit, [class*="unit"]') as HTMLElement;

        if (nameEl && priceEl) {
          items.push({
            name: nameEl.textContent?.trim() || '',
            price: priceEl.textContent?.trim() || '',
            originalPrice: originalPriceEl?.textContent?.trim() || '',
            url: linkEl?.href || '',
            unit: unitEl?.textContent?.trim() || 'szt.',
            id: card.getAttribute('data-product-id') || linkEl?.href?.split('/').pop() || '',
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
          sellerSlug: 'castorama',
          categorySlug: category,
          externalId: item.id || `casto-${item.name.substring(0, 50)}`,
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
