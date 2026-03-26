/**
 * Agent raportów — generuje raporty dzienne, wysyła do użytkowników przez Telegram
 */
import { sendDailyPriceReports, checkAndSendPriceAlerts } from '../reports/daily-prices';
import { sendDailyNewsReports } from '../reports/daily-news';
import logger from '../utils/logger';

/** Wynik działania agenta */
export interface AgentResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

/**
 * Uruchom agenta raportów porannych — ceny + newsy
 */
export async function runMorningReport(): Promise<AgentResult> {
  logger.info('🌅 [ReportAgent] Generuję poranne raporty...');
  let errors = 0;

  try {
    await sendDailyPriceReports();
  } catch (error) {
    errors++;
    logger.error('❌ [ReportAgent] Błąd raportu cenowego:', error);
  }

  try {
    await sendDailyNewsReports();
  } catch (error) {
    errors++;
    logger.error('❌ [ReportAgent] Błąd raportu newsowego:', error);
  }

  return {
    success: errors === 0,
    message: `Raport poranny wysłany (błędy: ${errors})`,
    data: { errors },
  };
}

/**
 * Uruchom agenta raportów wieczornych — tylko ceny
 */
export async function runEveningReport(): Promise<AgentResult> {
  logger.info('🌆 [ReportAgent] Generuję wieczorne raporty...');

  try {
    await sendDailyPriceReports();
    return { success: true, message: 'Raport wieczorny wysłany' };
  } catch (error) {
    logger.error('❌ [ReportAgent] Błąd wieczornego raportu:', error);
    return { success: false, message: `Błąd: ${(error as Error).message}` };
  }
}

/**
 * Uruchom sprawdzanie alertów cenowych
 */
export async function runPriceAlerts(): Promise<AgentResult> {
  logger.info('🔔 [ReportAgent] Sprawdzam alerty cenowe...');

  try {
    await checkAndSendPriceAlerts();
    return { success: true, message: 'Alerty cenowe sprawdzone' };
  } catch (error) {
    logger.error('❌ [ReportAgent] Błąd alertów:', error);
    return { success: false, message: `Błąd: ${(error as Error).message}` };
  }
}
