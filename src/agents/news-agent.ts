/**
 * Agent newsów — pobiera RSS + scraping, podsumowuje przez Claude Haiku
 */
import { fetchAllRSS } from '../news/rss';
import { scrapeAllNews } from '../news/scraper';
import { summarizeUnsummarized } from '../news/summarizer';
import logger from '../utils/logger';

/** Wynik działania agenta */
export interface AgentResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

/**
 * Uruchom agenta newsów — pobierz RSS, scrapuj, podsumuj
 */
export async function run(): Promise<AgentResult> {
  logger.info('🔄 [NewsAgent] Pobieram newsy...');

  let rssCount = 0;
  let scrapedCount = 0;
  let summarized = 0;
  let errors = 0;

  try {
    // Etap 1: RSS
    rssCount = await fetchAllRSS();
    logger.info(`📡 [NewsAgent] RSS: ${rssCount} nowych artykułów`);
  } catch (error) {
    errors++;
    logger.error('❌ [NewsAgent] Błąd RSS:', error);
  }

  try {
    // Etap 2: Web scraping
    scrapedCount = await scrapeAllNews();
    logger.info(`🔍 [NewsAgent] Scraping: ${scrapedCount} nowych artykułów`);
  } catch (error) {
    errors++;
    logger.error('❌ [NewsAgent] Błąd scrapingu:', error);
  }

  try {
    // Etap 3: Podsumowania AI (max 15 artykułów)
    summarized = await summarizeUnsummarized(15);
    logger.info(`🤖 [NewsAgent] Podsumowano: ${summarized} artykułów`);
  } catch (error) {
    errors++;
    logger.error('❌ [NewsAgent] Błąd podsumowań:', error);
  }

  const total = rssCount + scrapedCount;
  logger.info(`✅ [NewsAgent] Gotowe: ${total} nowych, ${summarized} podsumowanych, ${errors} błędów`);

  return {
    success: errors === 0,
    message: `Newsy: ${total} nowych artykułów, ${summarized} podsumowanych`,
    data: { rssCount, scrapedCount, summarized, errors },
  };
}
