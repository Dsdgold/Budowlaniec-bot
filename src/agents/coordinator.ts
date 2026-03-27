/**
 * Koordynator agentów v3 — rejestruje agentów w sieci
 * Nowa architektura: BaseAgent + AgentNetwork
 */
import { agentNetwork } from '../core/network';
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
import { AgentResult } from '../core/agent';
import logger from '../utils/logger';

/**
 * Zarejestruj wszystkich agentów i uruchom sieć
 */
export function start(): void {
  logger.info('⚡ [Coordinator] Rejestruję agentów w sieci...');

  // Core agents
  agentNetwork.register(new PriceAgent());
  agentNetwork.register(new NewsAgent());
  agentNetwork.register(new MorningReportAgent());
  agentNetwork.register(new EveningReportAgent());
  agentNetwork.register(new AIMaintenanceAgent());

  // Data agents
  agentNetwork.register(new LeadsAgent());
  agentNetwork.register(new MonitorAgent());
  agentNetwork.register(new AnalyticsAgent());

  // Self-evolving agents
  agentNetwork.register(new CodeAgent());
  agentNetwork.register(new UIAgent());
  agentNetwork.register(new EvolutionAgent());

  // Uruchom CRON schedules
  agentNetwork.start();

  logger.info('✅ [Coordinator] Sieć agentów uruchomiona');
}

/**
 * Uruchom agenta ręcznie (kompatybilność wsteczna)
 */
export async function runManual(
  agentName: 'price' | 'news' | 'morning_report' | 'evening_report' | 'maintenance' | 'leads' | 'monitor' | 'analytics',
): Promise<AgentResult> {
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
  };

  const networkName = nameMap[agentName];
  if (!networkName) {
    return { success: false, message: `Nieznany agent: ${agentName}` };
  }

  return agentNetwork.runAgent(networkName);
}

/**
 * Pobierz historię uruchomień (kompatybilność wsteczna)
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
