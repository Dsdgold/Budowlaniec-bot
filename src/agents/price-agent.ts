/**
 * PriceAgent — scrapuje ceny materiałów budowlanych ze sklepów
 * Refaktoryzacja na BaseAgent z pełnym lifecycle
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { CastoramaScraper } from '../scrapers/castorama';
import { LeroyScraper } from '../scrapers/leroy';
import { TrzywScraper } from '../scrapers/trzyw';
import { BechcickiScraper } from '../scrapers/bechcicki';
import { bulkUpsertPrices } from '../db/prices';
import { checkAndSendPriceAlerts } from '../reports/daily-prices';
import { CRON_SCHEDULES } from '../config';
import logger from '../utils/logger';

export class PriceAgent extends BaseAgent {
  private isScraping = false;

  constructor() {
    super({
      name: 'PriceAgent',
      description: 'Scrapuje ceny materiałów budowlanych z 4 sklepów',
      icon: '📊',
      cronSchedule: CRON_SCHEDULES.PRICE_SCRAPE,
      tags: ['scraping', 'prices', 'core'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    if (this.isScraping) {
      return { success: false, message: 'Scraping już trwa — pomijam' };
    }

    this.isScraping = true;

    const scrapers = [
      new CastoramaScraper(),
      new LeroyScraper(),
      new TrzywScraper(),
      new BechcickiScraper(),
    ];

    let totalProducts = 0;
    let errors = 0;

    for (const scraper of scrapers) {
      try {
        const products = await scraper.scrape();
        const saved = await bulkUpsertPrices(products);
        totalProducts += saved;
      } catch (error) {
        errors++;
        logger.error(`❌ [PriceAgent] Błąd scrapera: ${(error as Error).message}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.isScraping = false;

    // Sprawdź alerty cenowe
    try {
      await checkAndSendPriceAlerts();
    } catch (error) {
      logger.error('❌ [PriceAgent] Błąd sprawdzania alertów:', error);
    }

    return {
      success: errors === 0,
      message: `Scraping: ${totalProducts} produktów, ${errors} błędów`,
      data: { totalProducts, errors, scrapers: scrapers.length },
    };
  }

  async healthCheck(): Promise<boolean> {
    return !this.isScraping && this.status !== 'error';
  }
}
