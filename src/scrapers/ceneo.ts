/**
 * Scraper dla Ceneo.pl — największa porównywarka cen w Polsce
 * Scrapuje ceny materiałów budowlanych z wielu sklepów jednocześnie
 */
import { Page } from 'puppeteer';
import { BaseScraper } from './base';
import { ScrapedProduct } from '../db/prices';
import { Kategoria, SELLERS } from '../config';
import logger from '../utils/logger';

/** Mapowanie kategorii na słowa kluczowe wyszukiwania Ceneo */
const CATEGORY_KEYWORDS: Partial<Record<Kategoria, string[]>> = {
  cement: ['cement portlandzki', 'zaprawa murarska', 'beton'],
  stal: ['pręt zbrojeniowy', 'profil stalowy', 'kątownik'],
  drewno: ['deska budowlana', 'belka drewniana', 'łata dachowa'],
  izolacja: ['styropian', 'wełna mineralna', 'pianka pur'],
  ceramika: ['płytki ceramiczne', 'gres', 'terakota'],
  'chemia-budowlana': ['klej do płytek', 'fuga', 'silikon'],
  dachy: ['blachodachówka', 'papa', 'gont bitumiczny'],
  'okna-drzwi': ['okno PCV', 'drzwi wewnętrzne'],
  narzedzia: ['wiertarka', 'szlifierka', 'piła'],
};

export class CeneoScraper extends BaseScraper {
  constructor() {
    super('Ceneo', SELLERS.ceneo.baseUrl, { maxRetries: 1 });
  }

  /**
   * Scrapuj produkty z Ceneo.pl
   */
  async scrapeProducts(page: Page): Promise<ScrapedProduct[]> {
    const allProducts: ScrapedProduct[] = [];

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      for (const keyword of keywords) {
        try {
          const products = await this.searchCeneo(
            page,
            category as Kategoria,
            keyword
          );
          allProducts.push(...products);
        } catch (error) {
          logger.error(
            `[Ceneo] Blad wyszukiwania "${keyword}" w ${category}: ${(error as Error).message}`
          );
        }

        // Pauza między zapytaniami — unikamy rate-limiting
        await this.sleep(3000);
      }
    }

    return allProducts;
  }

  /**
   * Wyszukaj produkty na Ceneo.pl po słowie kluczowym
   */
  private async searchCeneo(
    page: Page,
    category: Kategoria,
    keyword: string
  ): Promise<ScrapedProduct[]> {
    // Format URL wyszukiwania Ceneo: /;szukaj-slowo+kluczowe
    const searchTerm = keyword.replace(/\s+/g, '+');
    const searchUrl = `${this.baseUrl}/;szukaj-${encodeURIComponent(searchTerm)}`;
    logger.info(`[Ceneo] Szukam: ${keyword} -> ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 20_000 });

    // Zamknij popup cookies
    await this.closeCookiePopup(page);

    // Poczekaj na załadowanie produktów
    await page.waitForSelector(
      '.cat-prod-row, .category-list-body .cat-prod-row, [data-pid], .product-row',
      { timeout: 10_000 }
    ).catch(() => {
      logger.warn(`[Ceneo] Brak wynikow dla: ${keyword}`);
    });

    // Wyciągnij dane produktów
    const products = await page.evaluate((baseUrl: string) => {
      const items: Array<{
        name: string;
        priceValue: string;
        pricePenny: string;
        url: string;
        id: string;
        shopName: string;
      }> = [];

      // Selektory produktów Ceneo
      const rows = document.querySelectorAll(
        '.cat-prod-row, [data-pid], .product-row'
      );

      rows.forEach((row) => {
        // Nazwa produktu
        const nameEl = (
          row.querySelector('.go-to-product, .cat-prod-row__name, .product-name a, a.go-to-product') as HTMLElement
        );

        // Cena - Ceneo dzieli cenę na wartość i grosze
        const priceValueEl = (
          row.querySelector('.price-format .value, .price .value, .product-price .value') as HTMLElement
        );
        const pricePennyEl = (
          row.querySelector('.price-format .penny, .price .penny, .product-price .penny') as HTMLElement
        );

        // Fallback: cała cena w jednym elemencie
        const priceFull = (
          row.querySelector('.price-format, .product-price, [class*="price"]') as HTMLElement
        );

        // Link do produktu
        const linkEl = row.querySelector('a.go-to-product, a[href*="/"]') as HTMLAnchorElement;

        // ID produktu
        const productId = row.getAttribute('data-pid') || row.getAttribute('data-productid') || '';

        // Nazwa sklepu (jeśli widoczna)
        const shopEl = (
          row.querySelector('.btn-compare-locker, .product-shop, .shop-name') as HTMLElement
        );

        if (nameEl) {
          const href = linkEl?.getAttribute('href') || '';
          const fullUrl = href.startsWith('http') ? href : `${baseUrl}${href}`;

          let priceText = '';
          if (priceValueEl) {
            const value = priceValueEl.textContent?.trim() || '0';
            const penny = pricePennyEl?.textContent?.trim().replace(',', '') || '00';
            priceText = `${value}.${penny}`;
          } else if (priceFull) {
            priceText = priceFull.textContent?.trim() || '';
          }

          items.push({
            name: nameEl.textContent?.trim() || '',
            priceValue: priceText,
            pricePenny: pricePennyEl?.textContent?.trim() || '',
            url: fullUrl,
            id: productId,
            shopName: shopEl?.textContent?.trim() || '',
          });
        }
      });

      return items;
    }, this.baseUrl);

    logger.info(`[Ceneo] Znaleziono ${products.length} produktow dla "${keyword}"`);

    // Parsowanie wyników
    return products
      .map((item) => {
        const price = this.parsePrice(item.priceValue);
        if (!price || price <= 0) return null;

        return {
          sellerSlug: 'ceneo',
          categorySlug: category,
          externalId: item.id || `ceneo-${item.name.substring(0, 50).replace(/\s+/g, '-')}`,
          name: item.name,
          price,
          isPromo: false,
          url: item.url,
          unit: 'szt.',
        } as ScrapedProduct;
      })
      .filter((p): p is ScrapedProduct => p !== null);
  }
}
