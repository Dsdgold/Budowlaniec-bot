/**
 * Agent cen — uruchamia scrapery, zapisuje do DB, wykrywa zmiany
 */
import { CastoramaScraper } from '../scrapers/castorama';
import { LeroyScraper } from '../scrapers/leroy';
import { TrzywScraper } from '../scrapers/trzyw';
import { BechcickiScraper } from '../scrapers/bechcicki';
import { bulkUpsertPrices } from '../db/prices';
import { checkAndSendPriceAlerts } from '../reports/daily-prices';
import logger from '../utils/logger';

/** Wynik działania agenta */
export interface AgentResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

/** Flaga zapobiegająca równoczesnemu scrapingowi */
let isScraping = false;

/**
 * Uruchom agenta cen — scrapuj wszystkie sklepy i zapisz wyniki
 */
export async function run(): Promise<AgentResult> {
  if (isScraping) {
    logger.warn('⚠️ [PriceAgent] Scraping już trwa — pomijam');
    return { success: false, message: 'Scraping już trwa' };
  }

  isScraping = true;
  logger.info('🔄 [PriceAgent] Rozpoczynam scraping cen...');

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

    // Pauza między scraperami (unikanie blokad)
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  isScraping = false;
  logger.info(`✅ [PriceAgent] Scraping zakończony: ${totalProducts} produktów, ${errors} błędów`);

  // Po scrapingu sprawdź alerty cenowe
  try {
    await checkAndSendPriceAlerts();
  } catch (error) {
    logger.error('❌ [PriceAgent] Błąd sprawdzania alertów:', error);
  }

  return {
    success: errors === 0,
    message: `Scraping: ${totalProducts} produktów zapisanych, ${errors} błędów`,
    data: { totalProducts, errors },
  };
}
