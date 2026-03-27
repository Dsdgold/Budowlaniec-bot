/**
 * CodeAgent — samoudoskonalający agent, który generuje kod przez Claude API
 * Potrafi: dodawać nowe funkcje, poprawiać błędy, tworzyć nowych agentów
 * Działa w cyklu: analiza → plan → kod → review → zapis do kolejki
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import logger from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

/** Zadanie do wykonania przez CodeAgent */
export interface CodeTask {
  id?: number;
  type: 'feature' | 'bugfix' | 'improvement' | 'ui_change' | 'new_agent';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  source: string; // kto/co wygenerowało task
  status: 'pending' | 'in_progress' | 'review' | 'approved' | 'applied' | 'rejected';
  generated_code?: string;
  target_file?: string;
  ai_reasoning?: string;
}

export class CodeAgent extends BaseAgent {
  constructor() {
    super({
      name: 'CodeAgent',
      description: 'Generuje kod i nowe funkcje przez Claude API. Samoudoskonala platformę.',
      icon: '🧬',
      cronSchedule: '0 */2 * * *', // co 2 godziny
      tags: ['ai', 'self-evolving', 'code-generation'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let processed = 0;
    let errors = 0;

    // 1. Pobierz pending tasks z bazy
    const tasks = await this.getPendingTasks();
    if (tasks.length === 0) {
      // Jeśli nie ma tasków, sam wygeneruj propozycje na podstawie insightów
      await this.generateTasksFromInsights();
      return {
        success: true,
        message: 'Brak zadań — wygenerowano nowe propozycje z insightów',
        data: { processed: 0, generated: true },
      };
    }

    // 2. Przetwarzaj max 3 taski na run (oszczędność tokenów)
    for (const task of tasks.slice(0, 3)) {
      try {
        await this.processTask(task);
        processed++;
      } catch (error) {
        errors++;
        logger.error(`❌ [CodeAgent] Błąd zadania "${task.title}":`, error);
      }
    }

    return {
      success: errors === 0,
      message: `Przetworzono ${processed} zadań, ${errors} błędów`,
      data: { processed, errors, pending: tasks.length },
    };
  }

  /** Przetwórz zadanie — wygeneruj kod przez Claude */
  private async processTask(task: CodeTask): Promise<void> {
    await this.updateTaskStatus(task.id!, 'in_progress');

    eventBus.log('info', this.name, `Przetwarzam: ${task.title}`);

    const systemPrompt = `Jesteś ekspertem TypeScript/Node.js. Generujesz kod dla platformy Spektra Agent Network.
Platforma: Express + PostgreSQL + Redis + Telegraf + Puppeteer + WebSocket.
Architektura: BaseAgent class, AgentNetwork orchestrator, EventBus.

ZASADY:
1. Generuj TYLKO kod TypeScript — bez komentarzy, bez wyjaśnień
2. Kod musi być gotowy do wklejenia (kompilujący się)
3. Używaj istniejących importów z projektu (../core/agent, ../db/client, ../config, etc.)
4. Bądź zwięzły — minimalna ilość kodu do osiągnięcia celu
5. Na końcu dodaj komentarz // TARGET: [ścieżka pliku]`;

    const userPrompt = `Zadanie: ${task.title}
Typ: ${task.type}
Priorytet: ${task.priority}
Opis: ${task.description}

Wygeneruj kod TypeScript realizujący to zadanie.`;

    try {
      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const generatedCode = message.content[0].type === 'text'
        ? message.content[0].text.trim()
        : '';

      // Wyciągnij target file z komentarza
      const targetMatch = generatedCode.match(/\/\/ TARGET:\s*(.+)/);
      const targetFile = targetMatch ? targetMatch[1].trim() : null;

      // Zapisz wynik
      await query(
        `UPDATE code_tasks SET status = 'review', generated_code = $1, target_file = $2,
         ai_reasoning = $3, updated_at = NOW() WHERE id = $4`,
        [generatedCode, targetFile, `Tokens: ${message.usage.input_tokens}+${message.usage.output_tokens}`, task.id],
      );

      eventBus.log('success', this.name, `Wygenerowano kod dla: ${task.title} (${message.usage.output_tokens} tokenów)`);
      eventBus.emitNetwork({
        type: 'code:generated',
        source: this.name,
        timestamp: new Date(),
        data: { taskId: task.id, title: task.title, tokens: message.usage.output_tokens },
      });

    } catch (error) {
      await this.updateTaskStatus(task.id!, 'pending');
      throw error;
    }
  }

  /** Automatycznie generuj propozycje z analytics insights */
  private async generateTasksFromInsights(): Promise<void> {
    try {
      // Sprawdź insights z ostatnich 24h
      const insights = await query(
        `SELECT type, title, description, severity FROM analytics_insights
         WHERE created_at > NOW() - INTERVAL '24 hours' AND severity IN ('warning', 'critical')
         ORDER BY severity DESC LIMIT 5`,
      );

      if (insights.length === 0) return;

      // Wygeneruj propozycje zadań
      const insightSummary = insights.map((i: any) =>
        `[${i.severity}] ${i.type}: ${i.title} — ${i.description}`,
      ).join('\n');

      const message = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 500,
        system: `Jesteś architektem platformy Spektra. Na podstawie insightów zaproponuj 1-2 zadania rozwojowe.
Format: JSON array: [{"type":"improvement|feature|bugfix","title":"...","description":"...","priority":"low|medium|high"}]
Tylko JSON, bez komentarzy.`,
        messages: [{ role: 'user', content: `Insights z ostatnich 24h:\n${insightSummary}` }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';

      // Parsuj JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return;

      const tasks = JSON.parse(jsonMatch[0]) as Array<{
        type: string; title: string; description: string; priority: string;
      }>;

      for (const t of tasks.slice(0, 2)) {
        await this.createTask({
          type: t.type as CodeTask['type'],
          title: t.title,
          description: t.description,
          priority: t.priority as CodeTask['priority'],
          source: 'CodeAgent:auto',
          status: 'pending',
        });
      }

      eventBus.log('info', this.name, `Wygenerowano ${tasks.length} propozycji z insightów`);
    } catch (error) {
      logger.error('❌ [CodeAgent] Błąd generowania z insightów:', error);
    }
  }

  /** Pobierz pending tasks */
  private async getPendingTasks(): Promise<CodeTask[]> {
    return query(
      `SELECT * FROM code_tasks WHERE status = 'pending' ORDER BY
       CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       created_at ASC LIMIT 10`,
    );
  }

  /** Utwórz nowe zadanie */
  async createTask(task: Omit<CodeTask, 'id'>): Promise<number> {
    const result = await query(
      `INSERT INTO code_tasks (type, title, description, priority, source, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [task.type, task.title, task.description, task.priority, task.source, task.status],
    );
    return result[0]?.id;
  }

  /** Aktualizuj status zadania */
  private async updateTaskStatus(id: number, status: CodeTask['status']): Promise<void> {
    await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
  }

  /** Zatwierdź zadanie (z dashboardu / API) */
  static async approveTask(id: number): Promise<void> {
    await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', id]);
    eventBus.log('success', 'CodeAgent', `Zadanie #${id} zatwierdzone`);
  }

  /** Odrzuć zadanie */
  static async rejectTask(id: number): Promise<void> {
    await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', id]);
    eventBus.log('info', 'CodeAgent', `Zadanie #${id} odrzucone`);
  }
}
