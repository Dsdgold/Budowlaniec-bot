/**
 * Scheduler zadań cyklicznych (CRON)
 * Zarządza scrapingiem cen, pobieraniem newsów i wysyłaniem raportów
 */
import cron from 'node-cron';
import { CRON_SCHEDULES } from '../config';

// Scrapery
import { CastoramaScraper } from '../scrapers/castorama';
import { LeroyScraper } from '../scrapers/leroy';
import { TrzywScraper } from '../scrapers/trzyw';
import { BechcickiScraper } from '../scrapers/bechcicki';
import { bulkUpsertPrices } from '../db/prices';

// Newsy
import { fetchAllRSS } from '../news/rss';
import { scrapeAllNews } from '../news/scraper';
import { summarizeUnsummarized } from '../news/summarizer';

// Raporty
import { sendDailyPriceReports, checkAndSendPriceAlerts } from '../reports/daily-prices';
import { sendDailyNewsReports } from '../reports/daily-news';

// Użytkownicy
import { deactivateExpiredPro } from '../db/users';

import logger from '../utils/logger';

/** Flaga zapobiegająca równoczesnemu scrapingowi */
let isScraping = false;

/**
 * Zadanie: Scraping cen ze wszystkich sklepów
 */
async function runPriceScraping(): Promise<void> {
  if (isScraping) {
    logger.warn('⚠️ [Cron] Scraping już trwa — pomijam');
    return;
  }

  isScraping = true;
  logger.info('🔄 [Cron] Rozpoczynam scraping cen...');

  const scrapers = [
    new CastoramaScraper(),
    new LeroyScraper(),
    new TrzywScraper(),
    new BechcickiScraper(),
  ];

  let totalProducts = 0;

  for (const scraper of scrapers) {
    try {
      const products = await scraper.scrape();
      const saved = await bulkUpsertPrices(products);
      totalProducts += saved;
    } catch (error) {
      logger.error(`❌ [Cron] Błąd scrapera: ${(error as Error).message}`);
    }

    // Pauza między scraperami (unikanie blokad)
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  isScraping = false;
  logger.info(`✅ [Cron] Scraping zakończony: ${totalProducts} produktów zapisanych`);

  // Po scrapingu sprawdź alerty cenowe
  try {
    await checkAndSendPriceAlerts();
  } catch (error) {
    logger.error('❌ [Cron] Błąd sprawdzania alertów:', error);
  }
}

/**
 * Zadanie: Pobieranie newsów (RSS + scraping)
 */
async function runNewsFetching(): Promise<void> {
  logger.info('🔄 [Cron] Pobieram newsy...');

  try {
    // RSS
    const rssCount = await fetchAllRSS();
    logger.info(`📡 [Cron] RSS: ${rssCount} nowych artykułów`);

    // Web scraping
    const scrapedCount = await scrapeAllNews();
    logger.info(`🔍 [Cron] Scraping newsów: ${scrapedCount} nowych artykułów`);

    // Podsumowania AI
    const summarized = await summarizeUnsummarized(15);
    logger.info(`🤖 [Cron] Podsumowano: ${summarized} artykułów`);
  } catch (error) {
    logger.error('❌ [Cron] Błąd pobierania newsów:', error);
  }
}

/**
 * Zadanie: Wysłanie porannego raportu
 */
async function runMorningReport(): Promise<void> {
  logger.info('🌅 [Cron] Wysyłam poranne raporty...');

  try {
    await sendDailyPriceReports();
    await sendDailyNewsReports();
  } catch (error) {
    logger.error('❌ [Cron] Błąd porannych raportów:', error);
  }
}

/**
 * Zadanie: Wysłanie wieczornego raportu
 */
async function runEveningReport(): Promise<void> {
  logger.info('🌆 [Cron] Wysyłam wieczorne raporty...');

  try {
    await sendDailyPriceReports();
  } catch (error) {
    logger.error('❌ [Cron] Błąd wieczornych raportów:', error);
  }
}

/**
 * Zadanie: Codzienne porządki (o północy)
 */
async function runDailyMaintenance(): Promise<void> {
  logger.info('🧹 [Cron] Codzienne porządki...');

  try {
    // Dezaktywuj wygasłe konta PRO
    await deactivateExpiredPro();
  } catch (error) {
    logger.error('❌ [Cron] Błąd porządków:', error);
  }
}

/**
 * Uruchom wszystkie zaplanowane zadania CRON
 */
export function startScheduler(): void {
  logger.info('⏰ Uruchamiam scheduler CRON...');

  // Scraping cen - 2x dziennie (6:00 i 17:00)
  cron.schedule(CRON_SCHEDULES.PRICE_SCRAPE, () => {
    runPriceScraping().catch((err) =>
      logger.error('❌ Scraping cen - nieobsłużony błąd:', err)
    );
  });
  logger.info(`  📊 Scraping cen: ${CRON_SCHEDULES.PRICE_SCRAPE}`);

  // Pobieranie newsów - co 2 godziny
  cron.schedule(CRON_SCHEDULES.NEWS_FETCH, () => {
    runNewsFetching().catch((err) =>
      logger.error('❌ Newsy - nieobsłużony błąd:', err)
    );
  });
  logger.info(`  📰 Newsy: ${CRON_SCHEDULES.NEWS_FETCH}`);

  // Raport poranny - 7:00
  cron.schedule(CRON_SCHEDULES.MORNING_REPORT, () => {
    runMorningReport().catch((err) =>
      logger.error('❌ Raport poranny - nieobsłużony błąd:', err)
    );
  });
  logger.info(`  🌅 Raport poranny: ${CRON_SCHEDULES.MORNING_REPORT}`);

  // Raport wieczorny - 18:00
  cron.schedule(CRON_SCHEDULES.EVENING_REPORT, () => {
    runEveningReport().catch((err) =>
      logger.error('❌ Raport wieczorny - nieobsłużony błąd:', err)
    );
  });
  logger.info(`  🌆 Raport wieczorny: ${CRON_SCHEDULES.EVENING_REPORT}`);

  // Codzienne porządki - o północy
  cron.schedule('0 0 * * *', () => {
    runDailyMaintenance().catch((err) =>
      logger.error('❌ Porządki - nieobsłużony błąd:', err)
    );
  });
  logger.info('  🧹 Porządki: 0 0 * * * (północ)');

  logger.info('✅ Scheduler CRON uruchomiony');
}

/**
 * Uruchom scraping ręcznie (do testów)
 */
export async function manualPriceScrape(): Promise<void> {
  await runPriceScraping();
}

/**
 * Uruchom pobieranie newsów ręcznie (do testów)
 */
export async function manualNewsFetch(): Promise<void> {
  await runNewsFetching();
}
