/**
 * Agent AI — obsługuje pytania /pytaj, cache, limity
 * Wrapper na askAssistant z dodatkową logiką agenta
 */
import { askAssistant } from '../ai/assistant';
import { cleanOldCache } from '../ai/cache';
import { resetDailyAiQueries, deactivateExpiredPro } from '../db/users';
import logger from '../utils/logger';

/** Wynik działania agenta */
export interface AgentResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

/**
 * Uruchom codzienne porządki AI:
 * - Wyczyść stary cache
 * - Resetuj limity dzienne
 * - Dezaktywuj wygasłe konta PRO
 */
export async function runDailyMaintenance(): Promise<AgentResult> {
  logger.info('🧹 [AIAgent] Codzienne porządki...');
  let errors = 0;

  try {
    await cleanOldCache();
  } catch (error) {
    errors++;
    logger.error('❌ [AIAgent] Błąd czyszczenia cache:', error);
  }

  try {
    await resetDailyAiQueries();
  } catch (error) {
    errors++;
    logger.error('❌ [AIAgent] Błąd resetowania limitów:', error);
  }

  try {
    await deactivateExpiredPro();
  } catch (error) {
    errors++;
    logger.error('❌ [AIAgent] Błąd dezaktywacji PRO:', error);
  }

  return {
    success: errors === 0,
    message: `Porządki: cache wyczyszczony, limity zresetowane (błędy: ${errors})`,
    data: { errors },
  };
}
