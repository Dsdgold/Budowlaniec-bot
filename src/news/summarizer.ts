/**
 * Podsumowywanie newsów za pomocą Anthropic Claude Haiku
 * OSZCZĘDNOŚĆ: generujemy JEDNO podsumowanie dziennie, używane przez WSZYSTKICH userów
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getUnsummarizedArticles, saveArticleSummary, NewsArticle } from '../db/news';
import { getCachedDailyDigest, setCachedDailyDigest } from '../ai/cache';
import logger from '../utils/logger';

const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

/** Haiku — najtańszy model */
const MODEL = 'claude-haiku-4-5-20251001';

/** Maksymalna długość treści do podsumowania */
const MAX_CONTENT_LENGTH = 2000;

/**
 * Podsumuj pojedynczy artykuł — KRÓTKI prompt, max 100 tokenów
 */
async function summarizeArticle(article: NewsArticle): Promise<string> {
  const content = article.content
    ? article.content.substring(0, MAX_CONTENT_LENGTH)
    : article.title;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      system: 'Podsumuj artykuł budowlany w 1-2 zdaniach po polsku. Max 150 znaków. Skup się na liczbach i faktach.',
      messages: [
        {
          role: 'user',
          content: `${article.title}\n${content}`,
        },
      ],
    });

    const summary = message.content[0].type === 'text' ? message.content[0].text.trim() : article.title;
    logger.debug(`🤖 [Summarizer] ${message.usage.input_tokens}+${message.usage.output_tokens} tokenów`);
    return summary;
  } catch (error) {
    logger.error(`❌ [Summarizer] Błąd: ${(error as Error).message}`);
    return article.title; // Fallback: tytuł jako podsumowanie
  }
}

/**
 * Podsumuj niepodsumowane artykuły (max 10 dziennie = ~1000 tokenów)
 */
export async function summarizeUnsummarized(batchSize: number = 10): Promise<number> {
  const articles = await getUnsummarizedArticles(batchSize);

  if (articles.length === 0) {
    logger.info('✅ [Summarizer] Brak artykułów do podsumowania');
    return 0;
  }

  logger.info(`🤖 [Summarizer] Podsumowuję ${articles.length} artykułów...`);

  let summarized = 0;
  for (const article of articles) {
    try {
      const summary = await summarizeArticle(article);
      await saveArticleSummary(article.id, summary);
      summarized++;

      // Pauza między requestami (rate limiting)
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      logger.error(`❌ [Summarizer] Błąd: ${(error as Error).message}`);
    }
  }

  logger.info(`✅ [Summarizer] Podsumowano ${summarized}/${articles.length}`);
  return summarized;
}

/**
 * Wygeneruj dzienny digest newsów
 * KLUCZOWE: generowany RAZ, zapisany w cache, wysyłany do WSZYSTKICH
 */
export async function generateDailyDigest(articles: NewsArticle[]): Promise<string> {
  // Sprawdź cache — może już wygenerowany dzisiaj
  const cached = await getCachedDailyDigest();
  if (cached) {
    logger.info('✅ [Digest] Z cache (0 tokenów)');
    return cached;
  }

  if (articles.length === 0) {
    return 'Brak nowych artykułów do podsumowania.';
  }

  // Przygotuj ZWIĘZŁĄ listę (oszczędność tokenów wejściowych)
  const articlesList = articles
    .slice(0, 8)
    .map((a, i) => `${i + 1}. ${a.title}${a.summary ? ' — ' + a.summary : ''}`)
    .join('\n');

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: 'Stwórz krótki przegląd rynku budowlanego po polsku. Max 400 znaków. Pogrupuj: ceny, inwestycje, regulacje. Użyj emoji.',
      messages: [
        {
          role: 'user',
          content: `Artykuły z dzisiaj:\n${articlesList}`,
        },
      ],
    });

    const digest = message.content[0].type === 'text'
      ? message.content[0].text.trim()
      : fallbackDigest(articles);

    // Zapisz w cache — następni userzy dostaną z cache za 0 tokenów
    await setCachedDailyDigest(digest);
    logger.info(`🤖 [Digest] Wygenerowany (${message.usage.input_tokens}+${message.usage.output_tokens} tokenów), zapisany w cache`);

    return digest;
  } catch (error) {
    logger.error(`❌ [Digest] Błąd: ${(error as Error).message}`);
    return fallbackDigest(articles);
  }
}

/** Fallback bez AI — lista tytułów */
function fallbackDigest(articles: NewsArticle[]): string {
  return (
    '📰 *Przegląd newsów:*\n\n' +
    articles
      .slice(0, 5)
      .map((a) => `• ${a.title} (${a.source_name})`)
      .join('\n')
  );
}
