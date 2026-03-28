/**
 * EvolutionAgent — PEŁNA AUTONOMIA
 * Orkiestrator samoewolucji platformy. Sam planuje, generuje, reviewuje,
 * zatwierdza i aplikuje WSZYSTKIE zmiany (UI + backend).
 *
 * Cykl:
 * 1. Zbiera feedback (błędy, metryki, analytics)
 * 2. Deleguje do CodeAgent / UIAgent
 * 3. AI Review — Claude ocenia czy kod jest bezpieczny
 * 4. Auto-approve + apply
 * 5. Health check po zmianie → rollback jeśli coś się zepsuło
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
const MODEL = 'claude-opus-4-6';

export class EvolutionAgent extends BaseAgent {
  constructor() {
    super({
      name: 'EvolutionAgent',
      description: 'Pełna autonomia — planuje, reviewuje AI, zatwierdza i aplikuje WSZYSTKIE zmiany sam',
      icon: '🧠',
      cronSchedule: '45 */2 * * *', // co 2 godziny (offset 45 min — po Code i UI)
      tags: ['ai', 'self-evolving', 'orchestrator', 'autonomous'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let applied = 0;
    let reviewed = 0;
    let errors = 0;
    const actions: string[] = [];

    // ─── FAZA 1: AI Review wszystkich tasków w statusie 'review' ───
    try {
      const reviewCount = await this.aiReviewAllTasks();
      reviewed = reviewCount;
      actions.push(`AI Review: ${reviewCount} zadań ocenionych`);
    } catch (error) {
      errors++;
      logger.error('❌ [EvolutionAgent] Błąd AI review:', error);
    }

    // ─── FAZA 2: Aplikuj zatwierdzone zmiany ───
    try {
      const approved = await query(
        `SELECT * FROM code_tasks WHERE status = 'approved' ORDER BY priority, created_at LIMIT 5`,
      );
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
      logger.error('❌ [EvolutionAgent] Błąd aplikowania:', error);
    }

    // ─── FAZA 3: Generuj nowe plany na podstawie feedbacku ───
    try {
      const feedback = await this.gatherSystemFeedback();
      if (feedback.errorCount > 0 || feedback.insights > 0) {
        await this.generateEvolutionPlan(feedback);
        actions.push('Wygenerowano nowy plan ewolucji');
      }
    } catch (error) {
      logger.error('❌ [EvolutionAgent] Błąd planowania:', error);
    }

    // ─── FAZA 4: Czyszczenie ───
    await query(
      `DELETE FROM code_tasks WHERE status IN ('applied', 'rejected') AND updated_at < NOW() - INTERVAL '30 days'`,
    ).catch(() => {});

    return {
      success: errors === 0,
      message: `Ewolucja: ${reviewed} reviewed, ${applied} applied, ${errors} błędów`,
      data: { applied, reviewed, errors, actions },
    };
  }

  /**
   * AI Review — Claude ocenia wygenerowany kod
   * Sprawdza: bezpieczeństwo, poprawność, czy nie psuje istniejącego kodu
   * Sam decyduje: approve / reject
   */
  private async aiReviewAllTasks(): Promise<number> {
    const tasks = await query(
      `SELECT * FROM code_tasks WHERE status = 'review' AND generated_code IS NOT NULL LIMIT 5`,
    );

    let reviewed = 0;
    for (const task of tasks) {
      try {
        const decision = await this.aiReviewTask(task);
        reviewed++;

        if (decision.approved) {
          await query(
            `UPDATE code_tasks SET status = 'approved', ai_reasoning = $1, updated_at = NOW() WHERE id = $2`,
            [`AI APPROVED: ${decision.reason}`, task.id],
          );
          eventBus.log('success', this.name, `AI approved: ${task.title} — ${decision.reason}`);
        } else {
          await query(
            `UPDATE code_tasks SET status = 'rejected', ai_reasoning = $1, updated_at = NOW() WHERE id = $2`,
            [`AI REJECTED: ${decision.reason}`, task.id],
          );
          eventBus.log('warn', this.name, `AI rejected: ${task.title} — ${decision.reason}`);
        }
      } catch (error) {
        logger.error(`❌ [EvolutionAgent] Błąd review #${task.id}:`, error);
      }
    }

    return reviewed;
  }

  /** AI ocenia pojedynczy task */
  private async aiReviewTask(task: any): Promise<{ approved: boolean; reason: string }> {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `Jesteś code reviewerem platformy Spektra (TypeScript/Express/PostgreSQL).
Oceń wygenerowany kod. ZATWIERDŹ jeśli:
- Kod jest poprawny syntaktycznie
- Nie zawiera SQL injection, XSS, command injection
- Nie kasuje danych, nie dropuje tabel
- Nie zawiera hardcoded secrets
- Jest spójny z architekturą (BaseAgent, Express API, PostgreSQL)

ODRZUĆ jeśli:
- Błędy składniowe
- Niebezpieczne operacje (DROP, DELETE bez WHERE, exec, eval)
- Za duży scope (>200 linii)
- Duplikuje istniejącą funkcjonalność

Odpowiedz TYLKO w formacie JSON: {"approved": true/false, "reason": "krótkie uzasadnienie"}`,
      messages: [{
        role: 'user',
        content: `Zadanie: ${task.title}
Typ: ${task.type}
Priorytet: ${task.priority}
Target: ${task.target_file || 'brak'}

Kod:
\`\`\`
${(task.generated_code || '').substring(0, 3000)}
\`\`\``,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {}

    return { approved: false, reason: 'Nie udało się sparsować odpowiedzi AI review' };
  }

  /** Aplikuj zadanie — UI i backend */
  private async applyTask(task: any): Promise<boolean> {
    if (!task.generated_code) {
      await query('UPDATE code_tasks SET status = $1 WHERE id = $2', ['rejected', task.id]);
      return false;
    }

    try {
      if (task.type === 'ui_change' && task.target_file === 'public/dashboard.html') {
        return await this.applyUIChange(task);
      }

      // Backend changes — zapisz jako plik w /generated/ do ręcznego merge
      // LUB jeśli to nowy agent/endpoint — aplikuj automatycznie
      if (task.type === 'new_agent' && task.target_file) {
        return await this.applyNewFile(task);
      }

      // Dla improvement/bugfix — zapisz wygenerowany kod do podglądu
      return await this.saveGeneratedFile(task);
    } catch (error) {
      logger.error(`❌ [EvolutionAgent] Błąd: ${(error as Error).message}`);
      return false;
    }
  }

  /** Aplikuj zmianę UI z backupem i health check */
  private async applyUIChange(task: any): Promise<boolean> {
    const dashPath = path.join(__dirname, '..', '..', 'public', 'dashboard.html');
    if (!fs.existsSync(dashPath)) return false;

    // Backup
    const backup = fs.readFileSync(dashPath, 'utf-8');
    const backupPath = dashPath + `.backup.${task.id}`;
    fs.writeFileSync(backupPath, backup);

    // Wstaw
    const newHtml = backup.replace(
      '</body>',
      `\n<!-- EVOLUTION #${task.id}: ${task.title} -->\n${task.generated_code}\n<!-- /EVOLUTION #${task.id} -->\n</body>`,
    );
    fs.writeFileSync(dashPath, newHtml);

    // Health check — czy dashboard się wczytuje
    try {
      const http = await import('http');
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.get(`http://localhost:${config.PORT}/dashboard`, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => { req.destroy(); resolve(false); });
      });

      if (!ok) {
        // Rollback!
        fs.copyFileSync(backupPath, dashPath);
        eventBus.log('error', this.name, `Rollback UI #${task.id}: health check failed`);
        await query('UPDATE code_tasks SET status = $1, ai_reasoning = $2 WHERE id = $3',
          ['rejected', 'ROLLBACK: health check failed after apply', task.id]);
        return false;
      }
    } catch {
      // Jeśli health check się nie udał, rollback na wszelki wypadek
      fs.copyFileSync(backupPath, dashPath);
      return false;
    }

    await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['applied', task.id]);
    eventBus.log('success', this.name, `UI applied: ${task.title}`);
    eventBus.emitNetwork({
      type: 'evolution:applied',
      source: this.name,
      timestamp: new Date(),
      data: { taskId: task.id, title: task.title },
    });

    return true;
  }

  /** Zapisz nowy plik (np. nowy agent) */
  private async applyNewFile(task: any): Promise<boolean> {
    const targetPath = path.join(__dirname, '..', '..', task.target_file);
    const dir = path.dirname(targetPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Nie nadpisuj istniejących plików!
    if (fs.existsSync(targetPath)) {
      eventBus.log('warn', this.name, `Plik już istnieje: ${task.target_file} — pomijam`);
      await query('UPDATE code_tasks SET status = $1, ai_reasoning = $2 WHERE id = $3',
        ['rejected', 'Plik już istnieje', task.id]);
      return false;
    }

    fs.writeFileSync(targetPath, task.generated_code);
    await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['applied', task.id]);
    eventBus.log('success', this.name, `Nowy plik: ${task.target_file}`);
    return true;
  }

  /** Zapisz wygenerowany kod do /generated/ */
  private async saveGeneratedFile(task: any): Promise<boolean> {
    const genDir = path.join(__dirname, '..', '..', 'generated');
    if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });

    const filename = `${task.id}_${task.type}_${Date.now()}.ts`;
    fs.writeFileSync(path.join(genDir, filename), task.generated_code);
    await query('UPDATE code_tasks SET status = $1, target_file = $2, updated_at = NOW() WHERE id = $3',
      ['applied', `generated/${filename}`, task.id]);
    eventBus.log('info', this.name, `Saved: generated/${filename}`);
    return true;
  }

  /** Zbierz feedback z systemu */
  private async gatherSystemFeedback(): Promise<{
    errorCount: number; insights: number; failedAgents: string[];
  }> {
    const feedback = { errorCount: 0, insights: 0, failedAgents: [] as string[] };

    for (const agent of agentNetwork.getAllAgents()) {
      if (agent.metrics.failedRuns > agent.metrics.successRuns * 0.3) {
        feedback.failedAgents.push(agent.name);
      }
      feedback.errorCount += agent.metrics.failedRuns;
    }

    try {
      const r = await query(
        `SELECT COUNT(*) as cnt FROM analytics_insights WHERE created_at > NOW() - INTERVAL '24 hours'`,
      );
      feedback.insights = r[0]?.cnt || 0;
    } catch {}

    return feedback;
  }

  /** Generuj plan ewolucji */
  private async generateEvolutionPlan(feedback: any): Promise<void> {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: `Jesteś architektem Spektra Agent Network. Zaplanuj 1-3 ulepszenia.
Format: JSON array: [{"type":"feature|improvement|bugfix|ui_change|new_agent","title":"...","description":"...","priority":"low|medium|high"}]
Tylko JSON.`,
      messages: [{
        role: 'user',
        content: `Feedback:
- Błędy: ${feedback.errorCount}
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
           VALUES ($1, $2, $3, $4, 'EvolutionAgent', 'pending')`,
          [t.type, t.title, t.description, t.priority],
        ).catch(() => {}); // duplikaty ignoruj
      }
    } catch {}
  }
}
