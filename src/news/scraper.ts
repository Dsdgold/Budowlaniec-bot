/**
 * Web scraper dla źródeł newsów bez RSS
 * Pobiera artykuły bezpośrednio ze stron internetowych
 */
import puppeteer from 'puppeteer';
import { NewArticleInput, bulkInsertArticles } from '../db/news';
import logger from '../utils/logger';

/** Definicja źródła do scrapowania */
interface NewsSource {
  name: string;
  url: string;
  /** Selektor CSS dla artykułów na stronie */
  articleSelector: string;
  /** Selektor tytułu (relatywny do artykułu) */
  titleSelector: string;
  /** Selektor linku (relatywny do artykułu) */
  linkSelector: string;
  /** Selektor daty (relatywny do artykułu) */
  dateSelector?: string;
  /** Selektor opisu/leadu (relatywny do artykułu) */
  excerptSelector?: string;
}

/** Źródła newsów bez RSS */
const NEWS_SOURCES: NewsSource[] = [
  {
    name: 'Builder Polska',
    url: 'https://builderpolska.pl/aktualnosci/',
    articleSelector: '.post-item, article, .entry',
    titleSelector: 'h2 a, h3 a, .entry-title a',
    linkSelector: 'h2 a, h3 a, .entry-title a',
    dateSelector: '.date, time, .entry-date',
    excerptSelector: '.excerpt, .entry-summary, p',
  },
  {
    name: 'Rynek Infrastruktury',
    url: 'https://www.rynekinfrastruktury.pl/wiadomosci/',
    articleSelector: '.news-item, article, .list-item',
    titleSelector: 'h2 a, h3 a, .title a',
    linkSelector: 'h2 a, h3 a, .title a',
    dateSelector: '.date, time, .meta-date',
    excerptSelector: '.lead, .excerpt, .summary',
  },
];

/**
 * Scrapuj artykuły z jednego źródła
 */
async function scrapeSingleSource(source: NewsSource): Promise<NewArticleInput[]> {
  let browser;
  try {
    logger.info(`🔍 [News Scraper] Scrapuję: ${source.name}`);

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    );

    // Blokuj obrazy i style dla szybszego ładowania
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 20_000 });

    // Wyciągnij artykuły ze strony
    const articles = await page.evaluate(
      (src) => {
        const items: Array<{
          title: string;
          url: string;
          date: string;
          excerpt: string;
        }> = [];

        const articleEls = document.querySelectorAll(src.articleSelector);

        articleEls.forEach((el) => {
          const titleEl = el.querySelector(src.titleSelector) as HTMLAnchorElement;
          const linkEl = el.querySelector(src.linkSelector) as HTMLAnchorElement;
          const dateEl = src.dateSelector
            ? (el.querySelector(src.dateSelector) as HTMLElement)
            : null;
          const excerptEl = src.excerptSelector
            ? (el.querySelector(src.excerptSelector) as HTMLElement)
            : null;

          if (titleEl && linkEl?.href) {
            items.push({
              title: titleEl.textContent?.trim() || '',
              url: linkEl.href,
              date: dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime') || '',
              excerpt: excerptEl?.textContent?.trim() || '',
            });
          }
        });

        return items;
      },
      source
    );

    // Parsowanie do formatu NewArticleInput
    const parsedArticles: NewArticleInput[] = articles
      .filter((a) => a.title && a.url)
      .map((a) => ({
        sourceName: source.name,
        title: a.title,
        url: a.url,
        content: a.excerpt || undefined,
        publishedAt: a.date ? parsePolishDate(a.date) : undefined,
      }));

    logger.info(`📰 [News Scraper] ${source.name}: ${parsedArticles.length} artykułów`);
    return parsedArticles;
  } catch (error) {
    logger.error(
      `❌ [News Scraper] Błąd scrapingu ${source.name}: ${(error as Error).message}`
    );
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Parsuj polską datę (np. "24 marca 2026", "2026-03-24")
 */
function parsePolishDate(dateStr: string): Date | undefined {
  // Spróbuj standardowy format
  const standard = new Date(dateStr);
  if (!isNaN(standard.getTime())) return standard;

  // Polski format: "24 marca 2026"
  const polishMonths: Record<string, number> = {
    stycznia: 0, lutego: 1, marca: 2, kwietnia: 3,
    maja: 4, czerwca: 5, lipca: 6, sierpnia: 7,
    września: 8, października: 9, listopada: 10, grudnia: 11,
  };

  const match = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (match) {
    const day = parseInt(match[1]);
    const month = polishMonths[match[2].toLowerCase()];
    const year = parseInt(match[3]);
    if (month !== undefined) {
      return new Date(year, month, day);
    }
  }

  return undefined;
}

/**
 * Scrapuj wszystkie źródła newsów
 */
export async function scrapeAllNews(): Promise<number> {
  logger.info(`🔄 [News Scraper] Scrapuję ${NEWS_SOURCES.length} źródeł...`);

  const allArticles: NewArticleInput[] = [];

  // Scrapuj sekwencyjnie (oszczędzanie zasobów)
  for (const source of NEWS_SOURCES) {
    const articles = await scrapeSingleSource(source);
    allArticles.push(...articles);

    // Krótka pauza między źródłami
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (allArticles.length === 0) {
    logger.warn('⚠️ [News Scraper] Brak artykułów do zapisania');
    return 0;
  }

  const inserted = await bulkInsertArticles(allArticles);
  logger.info(`✅ [News Scraper] Zapisano ${inserted} nowych artykułów`);
  return inserted;
}
