/**
 * Koordynator agentów v3 — fault-tolerant rejestracja
 * Jeśli jeden agent się wysypie, reszta działa dalej
 */
import { agentNetwork } from '../core/network';
import { BaseAgent, AgentResult } from '../core/agent';
import { eventBus } from '../core/events';
import logger from '../utils/logger';

// Importy agentów
import { PriceAgent } from './price-agent';
import { NewsAgent } from './news-agent';
import { MorningReportAgent, EveningReportAgent } from './report-agent';
import { AIMaintenanceAgent } from './ai-agent';
import { LeadsAgent } from './leads-agent';
import { MonitorAgent } from './monitor-agent';
import { AnalyticsAgent } from './analytics-agent';
import { CodeAgent } from './code-agent';
import { UIAgent } from './ui-agent';
import { EvolutionAgent } from './evolution-agent';
import { DoctorAgent } from './doctor-agent';
import { VisionaryAgent } from './visionary-agent';
import { ExecutorAgent } from './executor-agent';

/**
 * Bezpieczna rejestracja — jeśli agent się wysypie, reszta działa
 */
function safeRegister(factory: () => BaseAgent): void {
  try {
    const agent = factory();
    agentNetwork.register(agent);
  } catch (error) {
    const name = factory.name || 'unknown';
    logger.error(`❌ [Coordinator] Nie udało się zarejestrować agenta: ${(error as Error).message}`);
    eventBus.log('error', 'Coordinator', `Agent pominięty: ${(error as Error).message}`);
  }
}

/**
 * Zarejestruj wszystkich agentów i uruchom sieć
 */
export function start(): void {
  logger.info('⚡ [Coordinator] Rejestruję agentów w sieci (fault-tolerant)...');

  // Core agents
  safeRegister(() => new PriceAgent());
  safeRegister(() => new NewsAgent());
  safeRegister(() => new MorningReportAgent());
  safeRegister(() => new EveningReportAgent());
  safeRegister(() => new AIMaintenanceAgent());

  // Data agents
  safeRegister(() => new LeadsAgent());
  safeRegister(() => new MonitorAgent());
  safeRegister(() => new AnalyticsAgent());

  // Self-evolving agents
  safeRegister(() => new CodeAgent());
  safeRegister(() => new UIAgent());
  safeRegister(() => new EvolutionAgent());

  // Doctor
  safeRegister(() => new DoctorAgent());

  // WŁADCY — rejestruj OSTATNICH (mają kontrolę nad wszystkimi)
  safeRegister(() => new VisionaryAgent());
  safeRegister(() => new ExecutorAgent());

  // Uruchom CRON schedules
  agentNetwork.start();

  const count = agentNetwork.getAllAgents().length;
  logger.info(`✅ [Coordinator] Sieć uruchomiona: ${count} agentów`);
  eventBus.log('success', 'Coordinator', `Zarejestrowano ${count} agentów`);
}

/**
 * Uruchom agenta ręcznie
 */
export async function runManual(agentName: string): Promise<AgentResult> {
  const nameMap: Record<string, string> = {
    price: 'PriceAgent',
    news: 'NewsAgent',
    morning_report: 'MorningReport',
    evening_report: 'EveningReport',
    maintenance: 'AIAgent',
    leads: 'LeadsAgent',
    monitor: 'MonitorAgent',
    analytics: 'AnalyticsAgent',
    code: 'CodeAgent',
    ui: 'UIAgent',
    evolution: 'EvolutionAgent',
    doctor: 'DoctorAgent',
  };

  const networkName = nameMap[agentName] || agentName;
  return agentNetwork.runAgent(networkName);
}

/**
 * Pobierz historię uruchomień
 */
export function getRunHistory() {
  const agents = agentNetwork.getAllAgents();
  const allHistory = agents.flatMap((a) =>
    a.history.map((h) => ({
      agent: a.name,
      startedAt: h.at,
      finishedAt: h.result.duration
        ? new Date(h.at.getTime() + h.result.duration)
        : h.at,
      result: h.result,
    })),
  );

  return allHistory
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 50);
}
