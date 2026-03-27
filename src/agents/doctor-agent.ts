/**
 * DoctorAgent — monitoruje zdrowie innych agentów i naprawia ich
 *
 * Co robi:
 * - Wykrywa crashujących agentów (>50% failed runs)
 * - Restartuje zablokowanych agentów (status 'running' >10 min)
 * - Wyłącza toksycznych agentów (ciągłe errory)
 * - Generuje taski naprawcze dla CodeAgent
 * - Raportuje status zdrowia sieci
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { agentNetwork } from '../core/network';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import logger from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

interface AgentDiagnosis {
  name: string;
  problem: 'crash_loop' | 'stuck' | 'high_failure_rate' | 'disabled' | 'healthy';
  details: string;
  action: 'restart' | 'disable' | 'create_fix_task' | 'enable' | 'none';
}

export class DoctorAgent extends BaseAgent {
  constructor() {
    super({
      name: 'DoctorAgent',
      description: 'Monitoruje zdrowie agentów, restartuje crashujących, generuje fixy, naprawia sieć',
      icon: '🩺',
      cronSchedule: '*/15 * * * *', // co 15 minut
      tags: ['health', 'self-healing', 'autonomous', 'meta'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    const diagnoses: AgentDiagnosis[] = [];
    let actions = 0;

    // 1. Diagnozuj każdego agenta
    const agents = agentNetwork.getAllAgents();
    for (const agent of agents) {
      if (agent.name === this.name) continue; // nie diagnozuj siebie

      const diagnosis = this.diagnose(agent);
      diagnoses.push(diagnosis);

      if (diagnosis.action !== 'none') {
        try {
          await this.treat(diagnosis);
          actions++;
        } catch (error) {
          logger.error(`❌ [DoctorAgent] Błąd leczenia ${diagnosis.name}:`, error);
        }
      }
    }

    // 2. Raport zdrowia
    const healthy = diagnoses.filter(d => d.problem === 'healthy').length;
    const sick = diagnoses.filter(d => d.problem !== 'healthy').length;

    eventBus.emitNetwork({
      type: 'doctor:report',
      source: this.name,
      timestamp: new Date(),
      data: { healthy, sick, actions, diagnoses },
    });

    // 3. Jeśli jest dużo problemów — wygeneruj diagnozę AI
    if (sick >= 3) {
      await this.aiDiagnoseNetwork(diagnoses);
    }

    return {
      success: true,
      message: `Zdrowie sieci: ${healthy} OK, ${sick} problemów, ${actions} akcji naprawczych`,
      data: { healthy, sick, actions, diagnoses },
    };
  }

  /** Diagnozuj pojedynczego agenta */
  private diagnose(agent: BaseAgent): AgentDiagnosis {
    const m = agent.metrics;
    const name = agent.name;

    // Agent wyłączony
    if (!agent.enabled) {
      // Sprawdź czy powinien być włączony (wyłączony przez DoctorAgent > 1h temu)
      return { name, problem: 'disabled', details: 'Agent wyłączony', action: 'enable' };
    }

    // Agent zablokowany (running > 10 minut)
    if (agent.status === 'running' && m.lastRunAt) {
      const runningMs = Date.now() - m.lastRunAt.getTime();
      if (runningMs > 10 * 60 * 1000) {
        return {
          name,
          problem: 'stuck',
          details: `Zablokowany od ${Math.round(runningMs / 60000)} min`,
          action: 'restart',
        };
      }
    }

    // Wysoki failure rate (>50% i min. 3 runy)
    if (m.totalRuns >= 3 && m.failedRuns / m.totalRuns > 0.5) {
      return {
        name,
        problem: 'high_failure_rate',
        details: `${m.failedRuns}/${m.totalRuns} failed (${Math.round(m.failedRuns / m.totalRuns * 100)}%)`,
        action: 'create_fix_task',
      };
    }

    // Crash loop — ostatnie 3 runy failed
    if (m.totalRuns >= 3) {
      const recentHistory = agent.history.slice(-3);
      const allFailed = recentHistory.every(h => !h.result.success);
      if (allFailed && recentHistory.length === 3) {
        return {
          name,
          problem: 'crash_loop',
          details: `Ostatnie 3 uruchomienia failed: ${m.lastResult?.message || 'unknown'}`,
          action: 'disable',
        };
      }
    }

    return { name, problem: 'healthy', details: 'OK', action: 'none' };
  }

  /** Lecz agenta — wykonaj akcję naprawczą */
  private async treat(diagnosis: AgentDiagnosis): Promise<void> {
    const agent = agentNetwork.getAgent(diagnosis.name);
    if (!agent) return;

    switch (diagnosis.action) {
      case 'restart':
        // Reset statusu — agent zostanie uruchomiony przy następnym CRON
        eventBus.log('warn', this.name, `🔄 Restart ${diagnosis.name}: ${diagnosis.details}`);
        // Force status reset through a run
        agent.run().catch(() => {});
        break;

      case 'disable':
        // Wyłącz agenta tymczasowo
        agent.disable();
        eventBus.log('error', this.name, `⛔ Wyłączono ${diagnosis.name}: ${diagnosis.details}`);
        // Utwórz task naprawczy
        await this.createFixTask(diagnosis);
        break;

      case 'create_fix_task':
        await this.createFixTask(diagnosis);
        break;

      case 'enable':
        // Włącz ponownie wyłączonego agenta (po naprawie)
        agent.enable();
        eventBus.log('success', this.name, `✅ Włączono ponownie ${diagnosis.name}`);
        break;
    }
  }

  /** Utwórz task naprawczy dla CodeAgent */
  private async createFixTask(diagnosis: AgentDiagnosis): Promise<void> {
    try {
      // Sprawdź czy nie ma już takiego taska
      const existing = await query(
        `SELECT id FROM code_tasks WHERE title LIKE $1 AND status IN ('pending', 'review', 'approved') LIMIT 1`,
        [`%${diagnosis.name}%`],
      );
      if (existing.length > 0) return;

      const lastError = agentNetwork.getAgent(diagnosis.name)?.metrics.lastResult?.message || 'unknown';

      await query(
        `INSERT INTO code_tasks (type, title, description, priority, source, status)
         VALUES ('bugfix', $1, $2, $3, 'DoctorAgent', 'pending')`,
        [
          `Napraw ${diagnosis.name}: ${diagnosis.problem}`,
          `Agent ${diagnosis.name} ma problem: ${diagnosis.details}\nOstatni błąd: ${lastError}\nAkcja: ${diagnosis.action}`,
          diagnosis.problem === 'crash_loop' ? 'critical' : 'high',
        ],
      );

      eventBus.log('info', this.name, `📝 Task naprawczy dla ${diagnosis.name}: ${diagnosis.problem}`);
    } catch (error) {
      logger.error(`❌ [DoctorAgent] Błąd tworzenia taska:`, error);
    }
  }

  /** AI diagnoza całej sieci — gdy jest dużo problemów */
  private async aiDiagnoseNetwork(diagnoses: AgentDiagnosis[]): Promise<void> {
    try {
      const sickAgents = diagnoses
        .filter(d => d.problem !== 'healthy')
        .map(d => `${d.name}: ${d.problem} — ${d.details}`)
        .join('\n');

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: `Jesteś diagnostykiem sieci agentów Spektra (TypeScript/Node.js/PostgreSQL).
Kilku agentów ma problemy. Zaproponuj plan naprawczy.
Format: JSON array: [{"type":"bugfix","title":"...","description":"...","priority":"critical|high"}]
Tylko JSON. Max 3 taski.`,
        messages: [{
          role: 'user',
          content: `Chorzy agenci:\n${sickAgents}\n\nZaproponuj naprawy.`,
        }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const tasks = JSON.parse(jsonMatch[0]);
      for (const t of tasks.slice(0, 3)) {
        await query(
          `INSERT INTO code_tasks (type, title, description, priority, source, status)
           VALUES ($1, $2, $3, $4, 'DoctorAgent:AI', 'pending')`,
          [t.type || 'bugfix', t.title, t.description, t.priority || 'high'],
        ).catch(() => {});
      }

      eventBus.log('info', this.name, `🧠 AI wygenerowało ${tasks.length} planów naprawczych`);
    } catch (error) {
      logger.error('❌ [DoctorAgent] Błąd AI diagnozy:', error);
    }
  }
}
