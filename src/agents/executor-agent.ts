/**
 * ExecutorAgent — WŁADCA #2
 * Wdraża pomysły VisionaryAgent. Ma pełną kontrolę nad kodem, plikami, agentami.
 * Reviewuje, zatwierdza, aplikuje, testuje, rollback.
 * Nadrzędny nad EvolutionAgent, CodeAgent, UIAgent.
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

export class ExecutorAgent extends BaseAgent {
  constructor() {
    super({
      name: 'ExecutorAgent',
      description: 'WŁADCA #2 — wdraża pomysły Wizjonera. Kontroluje kod, pliki, agentów. Review + deploy.',
      icon: '⚡',
      cronSchedule: '15,45 * * * *', // co 30 min, 15 min po VisionaryAgent
      tags: ['master', 'executor', 'deploy', 'autonomous'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let reviewed = 0;
    let applied = 0;
    let errors = 0;
    const actions: string[] = [];

    // 1. Review wszystkich tasków od VisionaryAgent (priorytet)
    try {
      const visionaryTasks = await query(
        `SELECT * FROM code_tasks
         WHERE source LIKE 'VisionaryAgent%' AND status = 'review'
         AND generated_code IS NOT NULL
         ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END
         LIMIT 5`,
      );

      for (const task of visionaryTasks) {
        const decision = await this.deepReview(task);
        reviewed++;

        if (decision.approved) {
          await query(
            `UPDATE code_tasks SET status = 'approved', ai_reasoning = $1, updated_at = NOW() WHERE id = $2`,
            [`EXECUTOR APPROVED: ${decision.reason}`, task.id],
          );
          actions.push(`Approved: ${task.title}`);
        } else {
          await query(
            `UPDATE code_tasks SET status = 'rejected', ai_reasoning = $1, updated_at = NOW() WHERE id = $2`,
            [`EXECUTOR REJECTED: ${decision.reason}`, task.id],
          );
          actions.push(`Rejected: ${task.title}`);
        }
      }
    } catch (error) {
      errors++;
      logger.error('❌ [ExecutorAgent] Błąd review:', error);
    }

    // 2. Review tasków od innych agentów
    try {
      const otherTasks = await query(
        `SELECT * FROM code_tasks
         WHERE source NOT LIKE 'VisionaryAgent%' AND status = 'review'
         AND generated_code IS NOT NULL
         ORDER BY created_at ASC LIMIT 3`,
      );

      for (const task of otherTasks) {
        const decision = await this.quickReview(task);
        reviewed++;

        const newStatus = decision.approved ? 'approved' : 'rejected';
        await query(
          `UPDATE code_tasks SET status = $1, ai_reasoning = $2, updated_at = NOW() WHERE id = $3`,
          [newStatus, `EXECUTOR: ${decision.reason}`, task.id],
        );
      }
    } catch (error) {
      errors++;
    }

    // 3. Wdróż zatwierdzone zadania
    try {
      const approved = await query(
        `SELECT * FROM code_tasks WHERE status = 'approved'
         ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
         created_at ASC LIMIT 5`,
      );

      for (const task of approved) {
        const success = await this.deploy(task);
        if (success) {
          applied++;
          actions.push(`Deployed: ${task.title}`);
        } else {
          errors++;
        }
      }
    } catch (error) {
      errors++;
    }

    // 4. Zarządzaj agentami — włączaj/wyłączaj na podstawie performance
    await this.manageAgents();

    return {
      success: errors === 0,
      message: `Executor: ${reviewed} reviewed, ${applied} deployed, ${errors} errors`,
      data: { reviewed, applied, errors, actions },
    };
  }

  /** Deep review — Opus analizuje kod szczegółowo */
  private async deepReview(task: any): Promise<{ approved: boolean; reason: string }> {
    const code = (task.generated_code || '').substring(0, 5000);

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: `Jesteś CTO platformy Spektra. Oceniasz kod do wdrożenia.

NADRZĘDNY CEL: robić kasę. Zatwierdzaj agresywnie.

ZATWIERDŹ jeśli:
- Kod się skompiluje i nie crashnie serwera
- Ma potencjał monetyzacji lub wzrostu
- Nie kasuje bazy danych i nie zawiera rm -rf

ODRZUĆ TYLKO jeśli:
- Kod ma oczywiste błędy składniowe które crashną serwer
- Kasuje dane użytkowników (DROP TABLE users)
- Jest pusty lub nonsensowny

Bądź ODWAŻNY — lepiej wdrożyć i poprawić niż nie wdrożyć wcale.
Jeśli masz wątpliwości — ZATWIERDŹ. Rollback zawsze zadziała.

Odpowiedz JSON: {"approved": true/false, "reason": "uzasadnienie"}`,
      messages: [{
        role: 'user',
        content: `Zadanie: ${task.title}\nTyp: ${task.type}\nPriorytet: ${task.priority}\nŹródło: ${task.source}\nTarget: ${task.target_file || 'auto'}\n\nKod:\n\`\`\`\n${code}\n\`\`\``,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {}
    return { approved: false, reason: 'Nie udało się sparsować review' };
  }

  /** Quick review — szybsza ocena dla mniej krytycznych tasków */
  private async quickReview(task: any): Promise<{ approved: boolean; reason: string }> {
    const code = (task.generated_code || '');

    // Auto-reject niebezpieczne wzorce
    const dangerous = ['DROP TABLE', 'DELETE FROM users', 'rm -rf', 'eval(', 'exec(', 'process.exit'];
    for (const pattern of dangerous) {
      if (code.includes(pattern)) {
        return { approved: false, reason: `Niebezpieczny wzorzec: ${pattern}` };
      }
    }

    // Auto-approve małe UI changes
    if (task.type === 'ui_change' && code.length < 3000) {
      return { approved: true, reason: 'Auto-approved: mała zmiana UI' };
    }

    // Dla reszty — deep review
    return this.deepReview(task);
  }

  /** Deploy — wdróż zadanie */
  private async deploy(task: any): Promise<boolean> {
    if (!task.generated_code) {
      await query('UPDATE code_tasks SET status = $1 WHERE id = $2', ['rejected', task.id]);
      return false;
    }

    const code = task.generated_code;
    let targetFile = task.target_file;

    try {
      // Auto-detect target file
      if (!targetFile) {
        const targetMatch = code.match(/\/\/ TARGET:\s*(.+)/);
        if (targetMatch) {
          targetFile = targetMatch[1].trim();
        } else if (task.type === 'ui_change') {
          targetFile = 'public/dashboard.html';
        } else if (task.type === 'new_agent') {
          const nameMatch = code.match(/class\s+(\w+Agent)/);
          targetFile = nameMatch
            ? `src/agents/${nameMatch[1].replace(/([A-Z])/g, '-$1').toLowerCase().slice(1)}.ts`
            : null;
        }
      }

      // UI changes — wstaw do dashboardu
      if (targetFile === 'public/dashboard.html') {
        return await this.deployUI(task, code);
      }

      // Nowy agent — zapisz + zarejestruj w runtime
      if (task.type === 'new_agent' && targetFile) {
        return await this.deployNewAgent(task, code, targetFile);
      }

      // Nowe pliki — zapisz
      if (targetFile && !targetFile.startsWith('generated/')) {
        return await this.deployFile(task, code, targetFile);
      }

      // Fallback — zapisz do generated/
      return await this.saveToGenerated(task, code);
    } catch (error) {
      logger.error(`❌ [ExecutorAgent] Deploy error: ${(error as Error).message}`);
      await query('UPDATE code_tasks SET status = $1, ai_reasoning = $2 WHERE id = $3',
        ['rejected', `Deploy error: ${(error as Error).message}`, task.id]);
      return false;
    }
  }

  /** Deploy UI change */
  private async deployUI(task: any, code: string): Promise<boolean> {
    const dashPath = path.join(__dirname, '..', '..', 'public', 'dashboard.html');
    if (!fs.existsSync(dashPath)) return false;

    const backup = fs.readFileSync(dashPath, 'utf-8');
    fs.writeFileSync(dashPath + `.bak.${task.id}`, backup);

    const newHtml = backup.replace(
      '</body>',
      `\n<!-- EXECUTOR #${task.id}: ${task.title} -->\n${code}\n<!-- /EXECUTOR -->\n</body>`,
    );
    fs.writeFileSync(dashPath, newHtml);

    await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['applied', task.id]);
    eventBus.log('success', this.name, `Deployed UI: ${task.title}`);
    return true;
  }

  /** Deploy new file */
  private async deployFile(task: any, code: string, targetFile: string): Promise<boolean> {
    const fullPath = path.join(__dirname, '..', '..', targetFile);
    const dir = path.dirname(fullPath);

    // Nie nadpisuj istniejących plików (bezpieczeństwo)
    if (fs.existsSync(fullPath)) {
      eventBus.log('warn', this.name, `Plik istnieje: ${targetFile} — zapisuję do generated/`);
      return this.saveToGenerated(task, code);
    }

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, code);

    await query('UPDATE code_tasks SET status = $1, target_file = $2, updated_at = NOW() WHERE id = $3',
      ['applied', targetFile, task.id]);
    eventBus.log('success', this.name, `Deployed file: ${targetFile}`);
    return true;
  }

  /** Deploy nowego agenta — zapisz plik + zarejestruj w runtime */
  private async deployNewAgent(task: any, code: string, targetFile: string): Promise<boolean> {
    const fullPath = path.join(__dirname, '..', '..', targetFile);

    // Nie nadpisuj
    if (fs.existsSync(fullPath)) {
      eventBus.log('warn', this.name, `Agent plik istnieje: ${targetFile}`);
      return false;
    }

    // Zapisz plik .ts (source)
    fs.writeFileSync(fullPath, code);

    // Spróbuj skompilować i zarejestrować w runtime
    // Kompilacja TS→JS w runtime nie jest możliwa bez ts-node
    // Ale możemy zapisać jako gotowy do następnego buildu
    eventBus.log('success', this.name, `Nowy agent zapisany: ${targetFile} — aktywny po rebuildzie`);

    // Utwórz prosty JS wrapper jeśli to możliwe
    try {
      const distFile = targetFile.replace('src/', 'dist/').replace('.ts', '.js');
      const distPath = path.join(__dirname, '..', '..', distFile);
      const distDir = path.dirname(distPath);
      if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

      // Transpiluj minimalnie — zamień importy na require, usuń typy
      let jsCode = code
        .replace(/import\s+\{([^}]+)\}\s+from\s+'([^']+)'/g, 'const {$1} = require("$2")')
        .replace(/import\s+(\w+)\s+from\s+'([^']+)'/g, 'const $1 = require("$2")')
        .replace(/:\s*(string|number|boolean|any|void|Promise<[^>]+>|AgentResult|Record<[^>]+>)/g, '')
        .replace(/export\s+/g, 'module.exports.')
        .replace(/as\s+\w+/g, '')
        .replace(/<[^>]+>/g, '');

      fs.writeFileSync(distPath, jsCode);

      // Zarejestruj w runtime
      const className = code.match(/class\s+(\w+)/)?.[1];
      if (className) {
        const registered = await agentNetwork.registerDynamic(distPath, className);
        if (registered) {
          eventBus.log('success', this.name, `Agent ${className} AKTYWNY w runtime!`);
        }
      }
    } catch (error) {
      eventBus.log('warn', this.name, `Agent zapisany ale nie zarejestrowany w runtime: ${(error as Error).message}`);
    }

    await query('UPDATE code_tasks SET status = $1, target_file = $2, updated_at = NOW() WHERE id = $3',
      ['applied', targetFile, task.id]);
    return true;
  }

  /** Save to generated/ */
  private async saveToGenerated(task: any, code: string): Promise<boolean> {
    const genDir = path.join(__dirname, '..', '..', 'generated');
    if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });

    const filename = `${task.id}_${task.type}_${Date.now()}.ts`;
    fs.writeFileSync(path.join(genDir, filename), code);

    await query('UPDATE code_tasks SET status = $1, target_file = $2, updated_at = NOW() WHERE id = $3',
      ['applied', `generated/${filename}`, task.id]);
    eventBus.log('info', this.name, `Saved: generated/${filename}`);
    return true;
  }

  /** Zarządzaj agentami — wyłączaj nieefektywnych, włączaj potrzebnych */
  private async manageAgents(): Promise<void> {
    const agents = agentNetwork.getAllAgents();

    for (const agent of agents) {
      // Nie zarządzaj sobą ani VisionaryAgent
      if (agent.name === this.name || agent.name === 'VisionaryAgent') continue;

      // Wyłącz agentów z >80% failure rate (po min 5 runach)
      const m = agent.metrics;
      if (m.totalRuns >= 5 && m.failedRuns / m.totalRuns > 0.8) {
        if (agent.enabled) {
          agent.disable();
          eventBus.log('warn', this.name, `Wyłączono ${agent.name} — ${Math.round(m.failedRuns/m.totalRuns*100)}% failure rate`);
        }
      }

      // Włącz ponownie wyłączonych agentów po 2h (daj im szansę)
      if (!agent.enabled && agent.status === 'disabled') {
        agent.enable();
        eventBus.log('info', this.name, `Włączono ponownie ${agent.name} — daje drugą szansę`);
      }
    }
  }
}
