/**
 * PriceAgent — scrapuje ceny materiałów budowlanych ze sklepów
 * Refaktoryzacja na BaseAgent z pełnym lifecycle
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { CastoramaScraper } from '../scrapers/castorama';
import { LeroyScraper } from '../scrapers/leroy';
import { TrzywScraper } from '../scrapers/trzyw';
import { BechcickiScraper } from '../scrapers/bechcicki';
import { CeneoScraper } from '../scrapers/ceneo';
import { bulkUpsertPrices } from '../db/prices';
import { checkAndSendPriceAlerts } from '../reports/daily-prices';
import { CRON_SCHEDULES } from '../config';
import logger from '../utils/logger';

export class PriceAgent extends BaseAgent {
  private isScraping = false;

  constructor() {
    super({
      name: 'PriceAgent',
      description: 'Scrapuje ceny materiałów budowlanych z 5 sklepów + Ceneo',
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
      new CeneoScraper(),
      new CastoramaScraper(),
      new LeroyScraper(),
      new TrzywScraper(),
      new BechcickiScraper(),
    ];

    let totalProducts = 0;
    let errors = 0;
    const scraperResults: string[] = [];

    for (const scraper of scrapers) {
      try {
        const products = await scraper.scrape();
        const saved = await bulkUpsertPrices(products);
        totalProducts += saved;
        scraperResults.push(`${scraper.constructor.name}: ${saved} produktow`);
      } catch (error) {
        errors++;
        const scraperName = scraper.constructor.name;
        const errorMessage = (error as Error).message;
        logger.error(`[PriceAgent] Blad scrapera ${scraperName}: ${errorMessage}`);
        scraperResults.push(`${scraperName}: BLAD - ${errorMessage}`);
        // Kontynuuj z nastepnym scraperem
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    this.isScraping = false;

    // Sprawdź alerty cenowe
    try {
      await checkAndSendPriceAlerts();
    } catch (error) {
      logger.error('[PriceAgent] Blad sprawdzania alertow:', error);
    }

    return {
      success: errors < scrapers.length, // Sukces jesli chociaz jeden scraper zadzialal
      message: `Scraping: ${totalProducts} produktow, ${errors} bledow z ${scrapers.length} scraperow`,
      data: { totalProducts, errors, scrapers: scrapers.length, details: scraperResults },
    };
  }

  async healthCheck(): Promise<boolean> {
    return !this.isScraping && this.status !== 'error';
  }
}
