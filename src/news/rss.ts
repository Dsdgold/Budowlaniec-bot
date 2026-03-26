/**
 * Fetcher newsów z kanałów RSS
 * Pobiera artykuły z polskich portali budowlanych
 */
import Parser from 'rss-parser';
import { RSS_SOURCES } from '../config';
import { NewArticleInput, bulkInsertArticles } from '../db/news';
import logger from '../utils/logger';

const parser = new Parser({
  timeout: 15_000, // Timeout 15 sekund
  headers: {
    'User-Agent': 'BudowlaniecBot/1.0',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
  customFields: {
    item: ['media:content', 'dc:creator', 'content:encoded'],
  },
});

/**
 * Pobierz artykuły z jednego źródła RSS
 */
async function fetchSingleSource(
  source: { name: string; url: string }
): Promise<NewArticleInput[]> {
  try {
    logger.info(`📡 [RSS] Pobieram: ${source.name} (${source.url})`);
    const feed = await parser.parseURL(source.url);

    const articles: NewArticleInput[] = (feed.items || []).map((item) => ({
      sourceName: source.name,
      title: item.title || 'Bez tytułu',
      url: item.link || item.guid || '',
      content: item.contentSnippet || item['content:encoded'] || item.content || undefined,
      category: item.categories?.[0] || undefined,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    }));

    logger.info(`📰 [RSS] ${source.name}: znaleziono ${articles.length} artykułów`);
    return articles;
  } catch (error) {
    logger.error(`❌ [RSS] Błąd pobierania ${source.name}: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Pobierz artykuły ze wszystkich źródeł RSS
 */
export async function fetchAllRSS(): Promise<number> {
  logger.info(`🔄 [RSS] Rozpoczynam pobieranie ze ${RSS_SOURCES.length} źródeł...`);

  const allArticles: NewArticleInput[] = [];

  // Pobieraj równolegle z limitem (3 jednocześnie)
  const batchSize = 3;
  for (let i = 0; i < RSS_SOURCES.length; i += batchSize) {
    const batch = RSS_SOURCES.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((source) => fetchSingleSource(source))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allArticles.push(...result.value);
      }
    }
  }

  // Filtruj artykuły bez URL
  const validArticles = allArticles.filter((a) => a.url && a.url.length > 0);

  if (validArticles.length === 0) {
    logger.warn('⚠️ [RSS] Brak nowych artykułów do zapisania');
    return 0;
  }

  // Zapisz do bazy (duplikaty będą ignorowane)
  const inserted = await bulkInsertArticles(validArticles);
  logger.info(`✅ [RSS] Pobrano ${validArticles.length} artykułów, zapisano ${inserted} nowych`);

  return inserted;
}

/**
 * Pobierz artykuły z jednego źródła (do debugowania)
 */
export async function fetchSingleRSS(sourceName: string): Promise<number> {
  const source = RSS_SOURCES.find(
    (s) => s.name.toLowerCase() === sourceName.toLowerCase()
  );

  if (!source) {
    logger.error(`❌ [RSS] Nie znaleziono źródła: ${sourceName}`);
    return 0;
  }

  const articles = await fetchSingleSource(source);
  return bulkInsertArticles(articles);
}
