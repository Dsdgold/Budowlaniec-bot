/**
 * UIAgent — automatycznie ewoluuje dashboard i UI
 * Analizuje użycie, generuje komponenty HTML/CSS/JS przez Claude API
 * Wyniki trafiają do kolejki zatwierdzania
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001';

export class UIAgent extends BaseAgent {
  constructor() {
    super({
      name: 'UIAgent',
      description: 'Ewoluuje dashboard i UI — generuje widgety, poprawia UX, dodaje wizualizacje',
      icon: '🎨',
      cronSchedule: '20 */4 * * *', // co 4 godziny
      tags: ['ai', 'self-evolving', 'ui', 'dashboard'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let widgetsGenerated = 0;
    let errors = 0;

    // 1. Analizuj co się zmieniło w danych
    const analysis = await this.analyzeDataChanges();
    if (!analysis) {
      return { success: true, message: 'Brak zmian wymagających aktualizacji UI', data: {} };
    }

    // 2. Wygeneruj propozycje widgetów/komponentów
    try {
      const widgets = await this.generateUIProposals(analysis);
      widgetsGenerated = widgets.length;

      // 3. Zapisz propozycje jako code_tasks
      for (const widget of widgets) {
        await query(
          `INSERT INTO code_tasks (type, title, description, priority, source, status, generated_code, target_file)
           VALUES ('ui_change', $1, $2, 'medium', 'UIAgent', 'review', $3, 'public/dashboard.html')`,
          [widget.title, widget.description, widget.code],
        );
      }

      eventBus.log('success', this.name, `Wygenerowano ${widgetsGenerated} propozycji UI`);
    } catch (error) {
      errors++;
      logger.error('❌ [UIAgent] Błąd generowania UI:', error);
    }

    return {
      success: errors === 0,
      message: `UI: ${widgetsGenerated} propozycji, ${errors} błędów`,
      data: { widgetsGenerated, errors },
    };
  }

  /** Analizuj zmiany w danych — co warto pokazać na dashboardzie */
  private async analyzeDataChanges(): Promise<string | null> {
    const parts: string[] = [];

    // Sprawdź jakie dane mamy
    try {
      const stats = await query(`
        SELECT
          (SELECT COUNT(*) FROM products) as products,
          (SELECT COUNT(*) FROM price_history WHERE scraped_at > NOW() - INTERVAL '7 days') as recent_prices,
          (SELECT COUNT(*) FROM news_articles WHERE published_at > NOW() - INTERVAL '7 days') as recent_news,
          (SELECT COUNT(*) FROM build_leads WHERE created_at > NOW() - INTERVAL '7 days') as recent_leads,
          (SELECT COUNT(*) FROM analytics_insights WHERE created_at > NOW() - INTERVAL '7 days') as recent_insights,
          (SELECT COUNT(*) FROM users) as users
      `);

      if (stats[0]) {
        const s = stats[0];
        parts.push(`Dane: ${s.products} produktów, ${s.recent_prices} cen (7d), ${s.recent_news} newsów (7d), ${s.recent_leads} leadów (7d), ${s.recent_insights} insightów (7d), ${s.users} userów`);
      }
    } catch {
      // Tabele mogą nie istnieć
    }

    // Sprawdź co jest na dashboardzie
    try {
      const dashPath = path.join(__dirname, '..', '..', 'public', 'dashboard.html');
      if (fs.existsSync(dashPath)) {
        const html = fs.readFileSync(dashPath, 'utf-8');
        const hasLeadsSection = html.includes('leads') || html.includes('Leady');
        const hasInsightsSection = html.includes('insights') || html.includes('Insights');
        const hasChartsSection = html.includes('Chart');

        if (!hasLeadsSection && parts.some(p => p.includes('leadów'))) {
          parts.push('BRAK: Sekcja leadów na dashboardzie — warto dodać');
        }
        if (!hasInsightsSection) {
          parts.push('BRAK: Sekcja insights/alertów na dashboardzie');
        }
      }
    } catch {}

    return parts.length > 0 ? parts.join('\n') : null;
  }

  /** Generuj propozycje widgetów UI */
  private async generateUIProposals(analysis: string): Promise<Array<{ title: string; description: string; code: string }>> {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: `Jesteś frontend developerem. Generujesz widgety HTML/CSS/JS dla dark-theme dashboardu.

Stack: vanilla JS, Chart.js, CSS Grid, dark theme (bg: #0a0e1a, cards: #1a1f35, accent: #60a5fa).
Dashboard pobiera dane z REST API: /api/stats, /api/leads, /api/insights, /api/agents.

Generuj samodzielne widgety (HTML+CSS+JS w jednym bloku) które można wstawić do dashboardu.
Format: JSON array: [{"title":"...","description":"...","code":"<div>...</div><style>...</style><script>...</script>"}]
Tylko JSON. Max 2 widgety.`,
      messages: [{ role: 'user', content: `Analiza dashboardu:\n${analysis}\n\nWygeneruj 1-2 nowe widgety.` }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '[]';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [];
    }
  }
}
