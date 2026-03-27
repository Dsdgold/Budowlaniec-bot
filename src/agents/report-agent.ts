/**
 * ReportAgent — generuje i wysyła raporty dzienne do użytkowników
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { sendDailyPriceReports, checkAndSendPriceAlerts } from '../reports/daily-prices';
import { sendDailyNewsReports } from '../reports/daily-news';
import { CRON_SCHEDULES } from '../config';
import logger from '../utils/logger';

export class MorningReportAgent extends BaseAgent {
  constructor() {
    super({
      name: 'MorningReport',
      description: 'Poranny raport cen i newsów (7:00)',
      icon: '🌅',
      cronSchedule: CRON_SCHEDULES.MORNING_REPORT,
      tags: ['report', 'telegram', 'core'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let errors = 0;

    try {
      await sendDailyPriceReports();
    } catch (error) {
      errors++;
      logger.error('❌ [MorningReport] Błąd raportu cenowego:', error);
    }

    try {
      await sendDailyNewsReports();
    } catch (error) {
      errors++;
      logger.error('❌ [MorningReport] Błąd raportu newsowego:', error);
    }

    return {
      success: errors === 0,
      message: `Raport poranny wysłany (błędy: ${errors})`,
      data: { errors },
    };
  }
}

export class EveningReportAgent extends BaseAgent {
  constructor() {
    super({
      name: 'EveningReport',
      description: 'Wieczorny raport cen (18:00)',
      icon: '🌆',
      cronSchedule: CRON_SCHEDULES.EVENING_REPORT,
      tags: ['report', 'telegram', 'core'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    try {
      await sendDailyPriceReports();
      return { success: true, message: 'Raport wieczorny wysłany' };
    } catch (error) {
      return { success: false, message: `Błąd: ${(error as Error).message}` };
    }
  }
}

// Eksporty kompatybilności wstecznej
export async function runMorningReport(): Promise<AgentResult> {
  const agent = new MorningReportAgent();
  return agent.run();
}

export async function runEveningReport(): Promise<AgentResult> {
  const agent = new EveningReportAgent();
  return agent.run();
}

export async function runPriceAlerts(): Promise<AgentResult> {
  try {
    await checkAndSendPriceAlerts();
    return { success: true, message: 'Alerty cenowe sprawdzone' };
  } catch (error) {
    return { success: false, message: `Błąd: ${(error as Error).message}` };
  }
}
