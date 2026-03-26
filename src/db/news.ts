/**
 * Operacje CRUD na artykułach/newsach branżowych
 */
import { query } from './client';
import logger from '../utils/logger';

/** Artykuł newsowy */
export interface NewsArticle {
  id: string;
  source_name: string;
  title: string;
  url: string;
  summary: string | null;
  content: string | null;
  category: string | null;
  published_at: Date | null;
  fetched_at: Date;
  is_summarized: boolean;
}

/** Dane nowego artykułu (wejście) */
export interface NewArticleInput {
  sourceName: string;
  title: string;
  url: string;
  content?: string;
  category?: string;
  publishedAt?: Date;
}

/**
 * Wstaw nowy artykuł (ignoruj duplikaty po URL)
 */
export async function insertArticle(data: NewArticleInput): Promise<NewsArticle | null> {
  try {
    const rows = await query<NewsArticle>(
      `INSERT INTO news_articles (source_name, title, url, content, category, published_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (url) DO NOTHING
       RETURNING *`,
      [
        data.sourceName,
        data.title,
        data.url,
        data.content || null,
        data.category || null,
        data.publishedAt || null,
      ]
    );
    if (rows[0]) {
      logger.debug(`📰 Nowy artykuł: ${data.title}`);
    }
    return rows[0] || null;
  } catch (error) {
    logger.error(`❌ Błąd zapisu artykułu: ${data.title}`, error);
    return null;
  }
}

/**
 * Masowe wstawienie artykułów
 */
export async function bulkInsertArticles(articles: NewArticleInput[]): Promise<number> {
  let inserted = 0;
  for (const article of articles) {
    const result = await insertArticle(article);
    if (result) inserted++;
  }
  logger.info(`📰 Wstawiono ${inserted}/${articles.length} nowych artykułów`);
  return inserted;
}

/**
 * Pobierz artykuły do podsumowania przez AI (jeszcze nie podsumowane)
 */
export async function getUnsummarizedArticles(limit: number = 10): Promise<NewsArticle[]> {
  return query<NewsArticle>(
    `SELECT * FROM news_articles
     WHERE is_summarized = FALSE
     ORDER BY published_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
}

/**
 * Zapisz podsumowanie AI artykułu
 */
export async function saveArticleSummary(articleId: string, summary: string): Promise<void> {
  await query(
    `UPDATE news_articles
     SET summary = $1, is_summarized = TRUE
     WHERE id = $2`,
    [summary, articleId]
  );
}

/**
 * Pobierz najnowsze artykuły (do dziennego raportu)
 */
export async function getLatestArticles(
  hours: number = 24,
  limit: number = 15
): Promise<NewsArticle[]> {
  return query<NewsArticle>(
    `SELECT * FROM news_articles
     WHERE fetched_at > NOW() - INTERVAL '1 hour' * $1
     ORDER BY published_at DESC NULLS LAST
     LIMIT $2`,
    [hours, limit]
  );
}

/**
 * Pobierz artykuły z podsumowaniami (do wysłania użytkownikowi)
 */
export async function getSummarizedArticles(
  hours: number = 24,
  limit: number = 10
): Promise<NewsArticle[]> {
  return query<NewsArticle>(
    `SELECT * FROM news_articles
     WHERE is_summarized = TRUE
       AND fetched_at > NOW() - INTERVAL '1 hour' * $1
     ORDER BY published_at DESC NULLS LAST
     LIMIT $2`,
    [hours, limit]
  );
}

/**
 * Wyszukaj artykuły po frazie
 */
export async function searchArticles(
  phrase: string,
  limit: number = 10
): Promise<NewsArticle[]> {
  return query<NewsArticle>(
    `SELECT * FROM news_articles
     WHERE LOWER(title) LIKE LOWER($1)
        OR LOWER(summary) LIKE LOWER($1)
     ORDER BY published_at DESC NULLS LAST
     LIMIT $2`,
    [`%${phrase}%`, limit]
  );
}

/**
 * Statystyki newsów
 */
export async function getNewsStats(): Promise<{
  total: number;
  today: number;
  summarized: number;
}> {
  const rows = await query<{
    total: string;
    today: string;
    summarized: string;
  }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN fetched_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) as today,
       SUM(CASE WHEN is_summarized THEN 1 ELSE 0 END) as summarized
     FROM news_articles`
  );
  const r = rows[0];
  return {
    total: parseInt(r.total) || 0,
    today: parseInt(r.today) || 0,
    summarized: parseInt(r.summarized) || 0,
  };
}
