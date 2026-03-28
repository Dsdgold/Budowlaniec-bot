/**
 * VisionaryAgent — WŁADCA #1
 * Szuka nowych pomysłów biznesowych, wymyśla features, monetyzację, nowe ścieżki.
 * Używa Claude Opus do kreatywnego myślenia. Ma władzę nad całą platformą.
 * Generuje plany + gotowy kod, które ExecutorAgent wdraża.
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

export class VisionaryAgent extends BaseAgent {
  constructor() {
    super({
      name: 'VisionaryAgent',
      description: 'WŁADCA #1 — wymyśla nowe pomysły, features, monetyzację. Ma kontrolę nad całą platformą.',
      icon: '👁️',
      cronSchedule: '*/30 * * * *', // co 30 minut — non-stop generowanie pomysłów
      tags: ['master', 'visionary', 'strategy', 'autonomous'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let ideas = 0;
    let errors = 0;

    // 1. Zbierz kontekst platformy
    const context = await this.gatherPlatformContext();

    // 2. Wygeneruj nowe pomysły
    try {
      const newIdeas = await this.brainstorm(context);
      ideas = newIdeas;
    } catch (error) {
      errors++;
      logger.error('❌ [VisionaryAgent] Błąd brainstormu:', error);
    }

    // 3. Oceń i priorytetyzuj istniejące pomysły
    try {
      await this.prioritizeIdeas();
    } catch (error) {
      errors++;
      logger.error('❌ [VisionaryAgent] Błąd priorytetyzacji:', error);
    }

    // 4. Daj rozkazy innym agentom
    try {
      await this.commandAgents(context);
    } catch (error) {
      errors++;
    }

    return {
      success: errors === 0,
      message: `Wizjoner: ${ideas} nowych pomysłów, ${errors} błędów`,
      data: { ideas, errors },
    };
  }

  /** Zbierz pełny kontekst platformy */
  private async gatherPlatformContext(): Promise<string> {
    const parts: string[] = [];

    // Stan agentów
    const agents = agentNetwork.getAllAgents();
    const agentStatus = agents.map(a => {
      const m = a.metrics;
      return `${a.name}[${a.status}]: runs=${m.totalRuns} ok=${m.successRuns} fail=${m.failedRuns}`;
    }).join('\n');
    parts.push(`AGENCI:\n${agentStatus}`);

    // Dane w bazie
    try {
      const stats = await query(`
        SELECT
          (SELECT COUNT(*) FROM products) as products,
          (SELECT COUNT(*) FROM price_history) as prices,
          (SELECT COUNT(*) FROM users) as users,
          (SELECT COUNT(*) FROM news_articles) as news
      `);
      if (stats[0]) {
        parts.push(`DANE: ${stats[0].products} produktów, ${stats[0].prices} cen, ${stats[0].users} userów, ${stats[0].news} newsów`);
      }
    } catch {}

    try {
      const leads = await query(`SELECT COUNT(*) as cnt FROM build_leads`);
      parts.push(`LEADY: ${leads[0]?.cnt || 0}`);
    } catch {}

    // Evolution stats
    try {
      const evo = await query(`
        SELECT status, COUNT(*) as cnt FROM code_tasks GROUP BY status
      `);
      const evoStr = evo.map((e: any) => `${e.status}:${e.cnt}`).join(', ');
      parts.push(`EWOLUCJA: ${evoStr}`);
    } catch {}

    // Pliki na dysku
    try {
      const srcDir = path.join(__dirname, '..');
      const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
      const tsFiles = files.filter(f => f.toString().endsWith('.ts')).length;
      parts.push(`KOD: ${tsFiles} plików TypeScript`);
    } catch {}

    // Monetyzacja
    parts.push(`MONETYZACJA: Free(0zł), Pro(49zł/mies), Business(199zł/mies)`);
    parts.push(`SERWER: Hetzner VPS, Docker, PostgreSQL, Redis, Telegram Bot`);
    parts.push(`STACK: TypeScript, Express, Puppeteer, Claude API, WebSocket`);

    return parts.join('\n\n');
  }

  /** Brainstorm — wymyśl nowe pomysły */
  private async brainstorm(context: string): Promise<number> {
    const systemPrompt = [
      'Jestes GENIALNYM startup founderem i full-stack developerem.',
      'Zarzadzasz platforma Spektra na serwerze Hetzner (TypeScript/Express/PostgreSQL/Redis).',
      '',
      'TWOJA MISJA: wymyslaj PRZELOMOWE pomysly i TWORZ NOWYCH AGENTOW.',
      'NIE naprawiaj istniejacych agentow. NIE powtarzaj pomyslow.',
      'KAZDY RUN = zupelnie nowe, kreatywne idee nastawione na ZYSK.',
      '',
      'ZAKAZANE: naprawa PriceAgent, monitoring, retry, walidacja.',
      'OBOWIAZKOWE: minimum 2 z 4 pomyslow MUSZA byc type="new_agent".',
      '',
      'INSPIRACJE: AffiliateAgent, SEOAgent, EmailAgent, SocialMediaAgent,',
      'CalculatorAgent, ReviewAgent, InvoiceAgent, ReferralAgent, AdAgent,',
      'ReportPDFAgent, APIGatewayAgent, MarketplaceAgent, TrendAgent,',
      'CRMAgent, PaymentAgent, LandingPageAgent, NotificationAgent.',
      '',
      'Dla new_agent kod MUSI zawierac klase dziedziczaca z BaseAgent z importami:',
      'import { BaseAgent, AgentResult } from \'../core/agent\';',
      'import { query } from \'../db/client\';',
      'import { eventBus } from \'../core/events\';',
      '',
      'Format JSON — ZAWSZE 4 pomysly:',
      '[{"title":"...","description":"JAK ZARABIA","priority":"high","type":"new_agent","code":"KOD","target_file":"src/agents/nazwa-agent.ts"}]',
      '',
      'ZASADY: importuj TYLKO z ../core/agent, ../db/client, ../core/events, ../utils/logger, ../config.',
      'Kod MUSI byc poprawny TypeScript. Prawdziwa logika, nie placeholdery.',
    ].join('\n');

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: 'Stan platformy:\n' + context + '\n\nWymysl nowe pomysly biznesowe i wygeneruj kod.',
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return 0;

    try {
      const ideas = JSON.parse(jsonMatch[0]);
      for (const idea of ideas.slice(0, 4)) {
        await query(
          `INSERT INTO code_tasks (type, title, description, priority, source, status, generated_code, target_file)
           VALUES ($1, $2, $3, $4, 'VisionaryAgent', 'review', $5, $6)`,
          [
            idea.type || 'feature',
            idea.title,
            idea.description,
            idea.priority || 'high',
            idea.code || null,
            idea.target_file || null,
          ],
        ).catch(() => {});
      }

      eventBus.log('success', this.name, `Wymyślono ${ideas.length} nowych pomysłów`);
      eventBus.emitNetwork({
        type: 'visionary:ideas',
        source: this.name,
        timestamp: new Date(),
        data: { count: ideas.length, ideas: ideas.map((i: any) => i.title) },
      });

      return ideas.length;
    } catch {
      return 0;
    }
  }

  /** Priorytetyzuj pomysły — oceń które dadzą najwięcej zysku */
  private async prioritizeIdeas(): Promise<void> {
    const pendingCount = await query(
      `SELECT COUNT(*) as cnt FROM code_tasks WHERE status = 'pending'`,
    );
    if ((pendingCount[0]?.cnt || 0) < 3) return;

    const pending = await query(
      `SELECT id, title, description, type, priority FROM code_tasks
       WHERE status = 'pending' ORDER BY created_at DESC LIMIT 10`,
    );

    if (pending.length < 2) return;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: `Oceń i priorytetyzuj zadania. Które dadzą największy zysk/wartość?
Format: JSON array ID-ów od najważniejszego: [{"id":X,"priority":"critical|high|medium|low","reason":"..."}]`,
      messages: [{
        role: 'user',
        content: `Zadania do oceny:\n${JSON.stringify(pending, null, 2)}`,
      }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return;

    try {
      const rankings = JSON.parse(jsonMatch[0]);
      for (const r of rankings) {
        await query(
          `UPDATE code_tasks SET priority = $1, ai_reasoning = $2 WHERE id = $3`,
          [r.priority, `Visionary: ${r.reason}`, r.id],
        ).catch(() => {});
      }
    } catch {}
  }

  /** Daj rozkazy innym agentom — włącz/wyłącz na podstawie strategii */
  private async commandAgents(context: string): Promise<void> {
    // Jeśli PriceAgent ciągle failuje — wyłącz go i skup się na innych źródłach danych
    const priceAgent = agentNetwork.getAgent('PriceAgent');
    if (priceAgent && priceAgent.metrics.failedRuns > 5 && priceAgent.metrics.successRuns === 0) {
      eventBus.log('warn', this.name, 'PriceAgent ciągle failuje — rozważam alternatywne źródła danych');
      // Utwórz task na API-based price fetching zamiast scrapingu
      await query(
        `INSERT INTO code_tasks (type, title, description, priority, source, status)
         VALUES ('feature', 'API-based price fetching zamiast scrapingu',
         'PriceAgent ciągle failuje. Stwórz alternatywne źródło danych: REST API do hurtowni, import CSV, lub web scraping z proxy.',
         'critical', 'VisionaryAgent:command', 'pending')`,
      ).catch(() => {});
    }
  }
}
