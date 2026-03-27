/**
 * EvolutionAgent — orkiestrator samoewolucji platformy
 *
 * Cykl ewolucji:
 * 1. Zbiera feedback (błędy, metryki, analytics, user complaints)
 * 2. Generuje plan ulepszeń
 * 3. Deleguje do CodeAgent i UIAgent
 * 4. Zatwierdza i aplikuje bezpieczne zmiany
 * 5. Rollback jeśli coś poszło nie tak
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { agentNetwork } from '../core/network';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

export class EvolutionAgent extends BaseAgent {
  constructor() {
    super({
      name: 'EvolutionAgent',
      description: 'Orkiestrator samoewolucji — planuje ulepszenia, aplikuje zatwierdzone zmiany, rollback przy błędach',
      icon: '🧠',
      cronSchedule: '30 4 * * *', // codziennie 4:30
      tags: ['ai', 'self-evolving', 'orchestrator', 'meta'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let applied = 0;
    let errors = 0;
    const actions: string[] = [];

    // ─── FAZA 1: Zbierz feedback z systemu ───
    const feedback = await this.gatherSystemFeedback();
    actions.push(`Feedback: ${feedback.errorCount} błędów, ${feedback.insights} insightów`);

    // ─── FAZA 2: Aplikuj zatwierdzone zmiany ───
    try {
      const approved = await this.getApprovedTasks();
      for (const task of approved) {
        const success = await this.applyTask(task);
        if (success) {
          applied++;
          actions.push(`Zastosowano: ${task.title}`);
        } else {
          errors++;
        }
      }
    } catch (error) {
      errors++;
      logger.error('❌ [EvolutionAgent] Błąd aplikowania zmian:', error);
    }

    // ─── FAZA 3: Auto-approve bezpieczne zmiany ───
    try {
      const autoApproved = await this.autoApproveSafeTasks();
      actions.push(`Auto-approve: ${autoApproved} zadań`);
    } catch (error) {
      logger.error('❌ [EvolutionAgent] Błąd auto-approve:', error);
    }

    // ─── FAZA 4: Generuj plan na następny cykl ───
    try {
      if (feedback.errorCount > 3 || feedback.insights > 0) {
        await this.generateEvolutionPlan(feedback);
        actions.push('Wygenerowano nowy plan ewolucji');
      }
    } catch (error) {
      logger.error('❌ [EvolutionAgent] Błąd planowania:', error);
    }

    // ─── FAZA 5: Czyszczenie starych tasków ───
    await query(`DELETE FROM code_tasks WHERE status IN ('applied', 'rejected') AND updated_at < NOW() - INTERVAL '30 days'`);

    return {
      success: errors === 0,
      message: `Ewolucja: ${applied} zmian zastosowanych, ${errors} błędów`,
      data: { applied, errors, actions },
    };
  }

  /** Zbierz feedback z całego systemu */
  private async gatherSystemFeedback(): Promise<{
    errorCount: number;
    insights: number;
    failedAgents: string[];
    avgResponseTime: number;
  }> {
    const feedback = {
      errorCount: 0,
      insights: 0,
      failedAgents: [] as string[],
      avgResponseTime: 0,
    };

    // Błędy agentów z ostatnich 24h
    const agents = agentNetwork.getAllAgents();
    for (const agent of agents) {
      if (agent.metrics.failedRuns > agent.metrics.successRuns * 0.3) {
        feedback.failedAgents.push(agent.name);
      }
      feedback.errorCount += agent.metrics.failedRuns;
    }

    // Insights z ostatnich 24h
    try {
      const result = await query(
        `SELECT COUNT(*) as cnt FROM analytics_insights WHERE created_at > NOW() - INTERVAL '24 hours'`,
      );
      feedback.insights = result[0]?.cnt || 0;
    } catch {}

    return feedback;
  }

  /** Pobierz zatwierdzone zadania gotowe do aplikacji */
  private async getApprovedTasks(): Promise<any[]> {
    return query(
      `SELECT * FROM code_tasks WHERE status = 'approved' ORDER BY priority, created_at LIMIT 5`,
    );
  }

  /** Aplikuj zatwierdzone zadanie */
  private async applyTask(task: any): Promise<boolean> {
    if (!task.generated_code || !task.target_file) {
      await query('UPDATE code_tasks SET status = $1 WHERE id = $2', ['rejected', task.id]);
      return false;
    }

    try {
      // Tylko UI changes są bezpieczne do automatycznej aplikacji
      if (task.type === 'ui_change' && task.target_file === 'public/dashboard.html') {
        const dashPath = path.join(__dirname, '..', '..', 'public', 'dashboard.html');

        if (!fs.existsSync(dashPath)) {
          logger.error(`❌ [EvolutionAgent] Plik nie istnieje: ${dashPath}`);
          return false;
        }

        // Backup
        const backup = fs.readFileSync(dashPath, 'utf-8');
        const backupPath = dashPath + '.backup';
        fs.writeFileSync(backupPath, backup);

        // Wstaw widget przed </body>
        const code = task.generated_code;
        const newHtml = backup.replace('</body>', `\n<!-- AUTO-GENERATED by UIAgent #${task.id} -->\n${code}\n<!-- END AUTO-GENERATED -->\n</body>`);
        fs.writeFileSync(dashPath, newHtml);

        await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['applied', task.id]);

        eventBus.log('success', this.name, `Zastosowano zmianę UI: ${task.title}`);
        eventBus.emitNetwork({
          type: 'evolution:applied',
          source: this.name,
          timestamp: new Date(),
          data: { taskId: task.id, title: task.title, type: task.type },
        });

        return true;
      }

      // Backend changes — loguj do review, nie aplikuj automatycznie
      eventBus.log('info', this.name, `Backend change "${task.title}" wymaga ręcznej aplikacji`);
      return false;
    } catch (error) {
      logger.error(`❌ [EvolutionAgent] Błąd aplikowania: ${(error as Error).message}`);

      // Rollback UI change
      try {
        const dashPath = path.join(__dirname, '..', '..', 'public', 'dashboard.html');
        const backupPath = dashPath + '.backup';
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, dashPath);
          eventBus.log('warn', this.name, `Rollback UI change: ${task.title}`);
        }
      } catch {}

      return false;
    }
  }

  /** Auto-approve bezpieczne zadania (tylko UI, niski priorytet) */
  private async autoApproveSafeTasks(): Promise<number> {
    const result = await query(
      `UPDATE code_tasks SET status = 'approved', updated_at = NOW()
       WHERE status = 'review'
       AND type = 'ui_change'
       AND priority IN ('low', 'medium')
       AND generated_code IS NOT NULL
       AND LENGTH(generated_code) < 5000
       RETURNING id`,
    );
    return result.length;
  }

  /** Generuj plan ewolucji na podstawie feedbacku */
  private async generateEvolutionPlan(feedback: any): Promise<void> {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: `Jesteś architektem platformy Spektra Agent Network. Zaplanuj 1-3 ulepszenia.
Format: JSON array: [{"type":"feature|improvement|bugfix","title":"...","description":"...","priority":"low|medium|high"}]
Tylko JSON.`,
      messages: [{
        role: 'user',
        content: `Feedback systemu:
- Błędy agentów: ${feedback.errorCount}
- Problematyczni agenci: ${feedback.failedAgents.join(', ') || 'brak'}
- Nowe insights: ${feedback.insights}
Zaplanuj ulepszenia.`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    try {
      const tasks = JSON.parse(jsonMatch[0]);
      for (const t of tasks.slice(0, 3)) {
        await query(
          `INSERT INTO code_tasks (type, title, description, priority, source, status)
           VALUES ($1, $2, $3, $4, 'EvolutionAgent', 'pending')
           ON CONFLICT DO NOTHING`,
          [t.type, t.title, t.description, t.priority],
        );
      }
    } catch {}
  }
}
