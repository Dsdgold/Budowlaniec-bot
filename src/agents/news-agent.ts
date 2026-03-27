/**
 * NewsAgent — pobiera newsy z RSS i web, podsumowuje przez AI
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { fetchAllRSS } from '../news/rss';
import { scrapeAllNews } from '../news/scraper';
import { summarizeUnsummarized } from '../news/summarizer';
import { CRON_SCHEDULES } from '../config';
import logger from '../utils/logger';

export class NewsAgent extends BaseAgent {
  constructor() {
    super({
      name: 'NewsAgent',
      description: 'Pobiera newsy branżowe z RSS i web, tworzy podsumowania AI',
      icon: '📰',
      cronSchedule: CRON_SCHEDULES.NEWS_FETCH,
      tags: ['news', 'rss', 'ai', 'core'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let rssCount = 0;
    let scrapedCount = 0;
    let summarized = 0;
    let errors = 0;

    try {
      rssCount = await fetchAllRSS();
    } catch (error) {
      errors++;
      logger.error('❌ [NewsAgent] Błąd RSS:', error);
    }

    try {
      scrapedCount = await scrapeAllNews();
    } catch (error) {
      errors++;
      logger.error('❌ [NewsAgent] Błąd scrapingu:', error);
    }

    try {
      summarized = await summarizeUnsummarized(15);
    } catch (error) {
      errors++;
      logger.error('❌ [NewsAgent] Błąd podsumowań:', error);
    }

    const total = rssCount + scrapedCount;

    return {
      success: errors === 0,
      message: `Newsy: ${total} nowych, ${summarized} podsumowanych, ${errors} błędów`,
      data: { rssCount, scrapedCount, summarized, errors },
    };
  }
}
