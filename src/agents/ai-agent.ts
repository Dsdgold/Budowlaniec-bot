/**
 * AIAgent — codzienne porządki: cache, limity, PRO
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { cleanOldCache } from '../ai/cache';
import { resetDailyAiQueries, deactivateExpiredPro } from '../db/users';
import logger from '../utils/logger';

export class AIMaintenanceAgent extends BaseAgent {
  constructor() {
    super({
      name: 'AIAgent',
      description: 'Codzienne porządki: czyszczenie cache AI, reset limitów, dezaktywacja PRO',
      icon: '🧹',
      cronSchedule: '0 0 * * *',
      tags: ['maintenance', 'ai', 'core'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let errors = 0;
    let cacheCleared = false;
    let limitsReset = false;
    let proDeactivated = false;

    try {
      await cleanOldCache();
      cacheCleared = true;
    } catch (error) {
      errors++;
      logger.error('❌ [AIAgent] Błąd czyszczenia cache:', error);
    }

    try {
      await resetDailyAiQueries();
      limitsReset = true;
    } catch (error) {
      errors++;
      logger.error('❌ [AIAgent] Błąd resetowania limitów:', error);
    }

    try {
      await deactivateExpiredPro();
      proDeactivated = true;
    } catch (error) {
      errors++;
      logger.error('❌ [AIAgent] Błąd dezaktywacji PRO:', error);
    }

    return {
      success: errors === 0,
      message: `Porządki: cache=${cacheCleared}, limity=${limitsReset}, PRO=${proDeactivated} (błędy: ${errors})`,
      data: { cacheCleared, limitsReset, proDeactivated, errors },
    };
  }
}

// Eksport kompatybilności wstecznej
export async function runDailyMaintenance(): Promise<AgentResult> {
  const agent = new AIMaintenanceAgent();
  return agent.run();
}
