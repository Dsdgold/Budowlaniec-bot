/**
 * Scraper dla Castorama.pl
 * Pobiera ceny materiałów budowlanych ze strony Castorama
 * Używa HTTP fetch zamiast Puppeteer dla większej niezawodności
 */
import { Page } from 'puppeteer';
import { BaseScraper } from './base';
import { ScrapedProduct } from '../db/prices';
import { Kategoria, SELLERS } from '../config';
import logger from '../utils/logger';

/** Mapowanie kategorii na słowa kluczowe wyszukiwania */
const CATEGORY_KEYWORDS: Partial<Record<Kategoria, string[]>> = {
  cement: ['cement portlandzki', 'zaprawa murarska', 'beton gotowy'],
  stal: ['profil stalowy', 'kątownik stalowy', 'pręt zbrojeniowy'],
  drewno: ['deska budowlana', 'belka drewniana', 'łata dachowa'],
  izolacja: ['styropian', 'wełna mineralna', 'pianka izolacyjna'],
  ceramika: ['płytki ceramiczne', 'gres', 'terakota'],
  'chemia-budowlana': ['klej do płytek', 'fuga', 'silikon budowlany'],
  dachy: ['blachodachówka', 'papa', 'gont bitumiczny'],
  'okna-drzwi': ['okno PCV', 'drzwi wewnętrzne'],
  narzedzia: ['wiertarka', 'szlifierka kątowa', 'piła'],
};

export class CastoramaScraper extends BaseScraper {
  constructor() {
    super('Castorama', SELLERS.castorama.baseUrl, { maxRetries: 1 });
  }

  /**
   * Scrapuj produkty z Castorama.pl przez wyszukiwarkę
   */
  async scrapeProducts(page: Page): Promise<ScrapedProduct[]> {
    const allProducts: ScrapedProduct[] = [];

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        try {
          const products = await this.searchProducts(
            page,
            category as Kategoria,
            keyword
          );
          allProducts.push(...products);
        } catch (error) {
          logger.error(
            `[Castorama] Blad wyszukiwania "${keyword}" w ${category}: ${(error as Error).message}`
          );
        }

        // Krótka pauza między zapytaniami
        await this.sleep(2000);
      }
    }

    return allProducts;
  }

  /**
   * Wyszukaj produkty po słowie kluczowym
   */
  private async searchProducts(
    page: Page,
    category: Kategoria,
    keyword: string
  ): Promise<ScrapedProduct[]> {
    const searchUrl = `${this.baseUrl}/search?term=${encodeURIComponent(keyword)}`;
    logger.info(`[Castorama] Szukam: ${keyword} -> ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20_000 });

    // Zamknij popup cookies
    await this.closeCookiePopup(page);

    // Poczekaj na załadowanie produktów - próbujemy kilka selektorów
    await page.waitForSelector(
      '.product-card, [data-product-id], .c-product, [data-testid="product-card"]',
      { timeout: 10_000 }
    ).catch(() => {
      logger.warn(`[Castorama] Brak wynikow dla: ${keyword}`);
    });

    // Wyciągnij dane produktów
    const products = await page.evaluate((baseUrl: string) => {
      const items: Array<{
        name: string;
        price: string;
        originalPrice: string;
        url: string;
        unit: string;
        id: string;
      }> = [];

      // Selektory produktów Castorama - kilka wariantów
      const cards = document.querySelectorAll(
        '.product-card, [data-product-id], .c-product, [data-testid="product-card"], [class*="ProductCard"]'
      );

      cards.forEach((card) => {
        const nameEl = (
          card.querySelector('.product-card__title, .product-name, [data-testid="product-title"], h2 a, h3 a') as HTMLElement
        );
        const priceEl = (
          card.querySelector('.product-price__value, [data-price], [data-testid="product-price"], [class*="price"] .value') as HTMLElement
        );
        const originalPriceEl = (
          card.querySelector('.product-price__old, .original-price, [class*="crossed"], [data-testid="original-price"]') as HTMLElement
        );
        const linkEl = card.querySelector('a[href]') as HTMLAnchorElement;
        const unitEl = (
          card.querySelector('.product-price__unit, .product-unit, [class*="unit"]') as HTMLElement
        );

        if (nameEl && priceEl) {
          const href = linkEl?.href || '';
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;
          items.push({
            name: nameEl.textContent?.trim() || '',
            price: priceEl.textContent?.trim() || '',
            originalPrice: originalPriceEl?.textContent?.trim() || '',
            url: fullUrl,
            unit: unitEl?.textContent?.trim() || 'szt.',
            id: card.getAttribute('data-product-id') || card.getAttribute('data-sku') || '',
          });
        }
      });

      return items;
    }, this.baseUrl);

    logger.info(`[Castorama] Znaleziono ${products.length} produktow dla "${keyword}"`);

    // Parsowanie wyników
    return products
      .map((item) => {
        const price = this.parsePrice(item.price);
        if (!price || price <= 0) return null;

        const originalPrice = this.parsePrice(item.originalPrice);

        return {
          sellerSlug: 'castorama',
          categorySlug: category,
          externalId: item.id || `casto-${item.name.substring(0, 50).replace(/\s+/g, '-')}`,
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
