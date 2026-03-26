/**
 * Koordynator agentów — główny scheduler, uruchamia agentów według harmonogramu
 * Zastępuje stary src/cron/scheduler.ts architekturą multi-agent
 */
import cron from 'node-cron';
import { CRON_SCHEDULES } from '../config';
import * as PriceAgent from './price-agent';
import * as NewsAgent from './news-agent';
import * as ReportAgent from './report-agent';
import * as AIAgent from './ai-agent';
import logger from '../utils/logger';

/** Wynik działania agenta (wspólny typ) */
interface AgentResult {
  success: boolean;
  message: string;
  data?: Record<string, any>;
}

/** Rekord uruchomienia agenta */
interface AgentRun {
  agent: string;
  startedAt: Date;
  finishedAt: Date | null;
  result: AgentResult | null;
}

/** Historia ostatnich uruchomień */
const runHistory: AgentRun[] = [];
const MAX_HISTORY = 50;

/**
 * Wykonaj agenta z logowaniem i zapisem historii
 */
async function executeAgent(
  name: string,
  fn: () => Promise<AgentResult>
): Promise<AgentResult> {
  const run: AgentRun = {
    agent: name,
    startedAt: new Date(),
    finishedAt: null,
    result: null,
  };

  logger.info(`🚀 [Coordinator] Uruchamiam agenta: ${name}`);

  try {
    const result = await fn();
    run.result = result;
    run.finishedAt = new Date();

    const duration = run.finishedAt.getTime() - run.startedAt.getTime();
    const emoji = result.success ? '✅' : '⚠️';
    logger.info(`${emoji} [Coordinator] ${name} zakończony (${duration}ms): ${result.message}`);

    return result;
  } catch (error) {
    const errorResult: AgentResult = {
      success: false,
      message: `Nieobsłużony błąd: ${(error as Error).message}`,
    };
    run.result = errorResult;
    run.finishedAt = new Date();

    logger.error(`❌ [Coordinator] ${name} — krytyczny błąd:`, error);
    return errorResult;
  } finally {
    // Zapisz w historii
    runHistory.push(run);
    if (runHistory.length > MAX_HISTORY) {
      runHistory.shift();
    }
  }
}

/**
 * Uruchom koordynatora — zarejestruj wszystkie zadania CRON
 */
export function start(): void {
  logger.info('⏰ [Coordinator] Uruchamiam koordynatora agentów...');

  // Agent cen — 2x dziennie (6:00 i 17:00)
  cron.schedule(CRON_SCHEDULES.PRICE_SCRAPE, () => {
    executeAgent('PriceAgent', PriceAgent.run);
  });
  logger.info(`  📊 PriceAgent: ${CRON_SCHEDULES.PRICE_SCRAPE}`);

  // Agent newsów — co 2 godziny
  cron.schedule(CRON_SCHEDULES.NEWS_FETCH, () => {
    executeAgent('NewsAgent', NewsAgent.run);
  });
  logger.info(`  📰 NewsAgent: ${CRON_SCHEDULES.NEWS_FETCH}`);

  // Agent raportów porannych — 7:00
  cron.schedule(CRON_SCHEDULES.MORNING_REPORT, () => {
    executeAgent('ReportAgent:morning', ReportAgent.runMorningReport);
  });
  logger.info(`  🌅 ReportAgent (poranny): ${CRON_SCHEDULES.MORNING_REPORT}`);

  // Agent raportów wieczornych — 18:00
  cron.schedule(CRON_SCHEDULES.EVENING_REPORT, () => {
    executeAgent('ReportAgent:evening', ReportAgent.runEveningReport);
  });
  logger.info(`  🌆 ReportAgent (wieczorny): ${CRON_SCHEDULES.EVENING_REPORT}`);

  // Agent AI — porządki o północy
  cron.schedule('0 0 * * *', () => {
    executeAgent('AIAgent:maintenance', AIAgent.runDailyMaintenance);
  });
  logger.info('  🧹 AIAgent (porządki): 0 0 * * * (północ)');

  logger.info('✅ [Coordinator] Koordynator agentów uruchomiony');
}

/**
 * Uruchom agenta ręcznie (do testów i diagnostyki)
 */
export async function runManual(
  agentName: 'price' | 'news' | 'morning_report' | 'evening_report' | 'maintenance'
): Promise<AgentResult> {
  switch (agentName) {
    case 'price':
      return executeAgent('PriceAgent (manual)', PriceAgent.run);
    case 'news':
      return executeAgent('NewsAgent (manual)', NewsAgent.run);
    case 'morning_report':
      return executeAgent('ReportAgent:morning (manual)', ReportAgent.runMorningReport);
    case 'evening_report':
      return executeAgent('ReportAgent:evening (manual)', ReportAgent.runEveningReport);
    case 'maintenance':
      return executeAgent('AIAgent:maintenance (manual)', AIAgent.runDailyMaintenance);
    default:
      return { success: false, message: `Nieznany agent: ${agentName}` };
  }
}

/**
 * Pobierz historię uruchomień agentów
 */
export function getRunHistory(): AgentRun[] {
  return [...runHistory];
}
