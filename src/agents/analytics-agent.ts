/**
 * AnalyticsAgent — analiza danych cenowych, wykrywanie trendów i anomalii
 * Generuje insights dla dashboardu i raportów
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import logger from '../utils/logger';

interface PriceInsight {
  type: 'price_drop' | 'price_spike' | 'new_promo' | 'trend_change' | 'anomaly';
  category: string;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  data?: any;
}

export class AnalyticsAgent extends BaseAgent {
  constructor() {
    super({
      name: 'AnalyticsAgent',
      description: 'Analizuje trendy cenowe, wykrywa anomalie i generuje insights',
      icon: '📈',
      cronSchedule: '30 7,12,18 * * *', // 3x dziennie
      tags: ['analytics', 'insights', 'core'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    const insights: PriceInsight[] = [];
    let errors = 0;

    // 1. Wykryj duże spadki cen (>10%)
    try {
      const drops = await this.detectPriceDrops();
      insights.push(...drops);
    } catch (error) {
      errors++;
      logger.error('❌ [AnalyticsAgent] Błąd wykrywania spadków:', error);
    }

    // 2. Wykryj anomalie cenowe
    try {
      const anomalies = await this.detectAnomalies();
      insights.push(...anomalies);
    } catch (error) {
      errors++;
      logger.error('❌ [AnalyticsAgent] Błąd wykrywania anomalii:', error);
    }

    // 3. Wykryj zmiany trendów
    try {
      const trends = await this.detectTrendChanges();
      insights.push(...trends);
    } catch (error) {
      errors++;
      logger.error('❌ [AnalyticsAgent] Błąd analizy trendów:', error);
    }

    // 4. Zapisz insights
    if (insights.length > 0) {
      await this.saveInsights(insights);
      eventBus.emitNetwork({
        type: 'analytics:insights',
        source: this.name,
        timestamp: new Date(),
        data: { count: insights.length, insights: insights.slice(0, 5) },
      });
    }

    return {
      success: errors === 0,
      message: `Analiza: ${insights.length} insightów, ${errors} błędów`,
      data: { insightsCount: insights.length, errors, insights: insights.slice(0, 10) },
    };
  }

  /** Wykryj duże spadki cen (>10% w 24h) */
  private async detectPriceDrops(): Promise<PriceInsight[]> {
    const results = await query(`
      SELECT ph1.product_id, p.name as product_name, p.category_slug,
             ph2.price as prev_price, ph1.price as current_price,
             ROUND(((ph1.price - ph2.price) / ph2.price * 100)::numeric, 1) as change_pct
      FROM price_history ph1
      JOIN price_history ph2 ON ph1.product_id = ph2.product_id
        AND ph2.scraped_at = (
          SELECT MAX(scraped_at) FROM price_history
          WHERE product_id = ph1.product_id
          AND scraped_at < ph1.scraped_at
        )
      JOIN products p ON p.id = ph1.product_id
      WHERE ph1.scraped_at > NOW() - INTERVAL '24 hours'
        AND ((ph1.price - ph2.price) / ph2.price * 100) < -10
      ORDER BY change_pct ASC
      LIMIT 20
    `);

    return results.map((r: any) => ({
      type: 'price_drop' as const,
      category: r.category_slug,
      title: `Duży spadek: ${r.product_name}`,
      description: `${r.prev_price} zł → ${r.current_price} zł (${r.change_pct}%)`,
      severity: Number(r.change_pct) < -20 ? 'critical' as const : 'warning' as const,
      data: r,
    }));
  }

  /** Wykryj anomalie (ceny znacznie odbiegające od średniej) */
  private async detectAnomalies(): Promise<PriceInsight[]> {
    const results = await query(`
      WITH stats AS (
        SELECT product_id,
               AVG(price) as avg_price,
               STDDEV(price) as stddev_price
        FROM price_history
        WHERE scraped_at > NOW() - INTERVAL '30 days'
        GROUP BY product_id
        HAVING COUNT(*) >= 5 AND STDDEV(price) > 0
      )
      SELECT p.name, p.category_slug, ph.price, s.avg_price, s.stddev_price,
             ABS(ph.price - s.avg_price) / s.stddev_price as z_score
      FROM price_history ph
      JOIN stats s ON s.product_id = ph.product_id
      JOIN products p ON p.id = ph.product_id
      WHERE ph.scraped_at > NOW() - INTERVAL '24 hours'
        AND ABS(ph.price - s.avg_price) / s.stddev_price > 2.5
      ORDER BY z_score DESC
      LIMIT 10
    `);

    return results.map((r: any) => ({
      type: 'anomaly' as const,
      category: r.category_slug,
      title: `Anomalia: ${r.name}`,
      description: `Cena ${r.price} zł odbiega od średniej ${Number(r.avg_price).toFixed(2)} zł (z-score: ${Number(r.z_score).toFixed(1)})`,
      severity: 'warning' as const,
      data: r,
    }));
  }

  /** Wykryj zmiany trendów (odwrócenie kierunku) */
  private async detectTrendChanges(): Promise<PriceInsight[]> {
    const results = await query(`
      WITH weekly AS (
        SELECT category_slug,
               date_trunc('week', scraped_at) as week,
               AVG(price) as avg_price
        FROM price_history ph
        JOIN products p ON p.id = ph.product_id
        WHERE scraped_at > NOW() - INTERVAL '30 days'
        GROUP BY category_slug, date_trunc('week', scraped_at)
        ORDER BY category_slug, week
      ),
      trends AS (
        SELECT category_slug, week, avg_price,
               LAG(avg_price) OVER (PARTITION BY category_slug ORDER BY week) as prev_avg
        FROM weekly
      )
      SELECT category_slug,
             avg_price as current_avg,
             prev_avg,
             ROUND(((avg_price - prev_avg) / prev_avg * 100)::numeric, 1) as weekly_change
      FROM trends
      WHERE prev_avg IS NOT NULL
        AND week = date_trunc('week', NOW())
        AND ABS((avg_price - prev_avg) / prev_avg * 100) > 5
      ORDER BY ABS((avg_price - prev_avg) / prev_avg * 100) DESC
    `);

    return results.map((r: any) => ({
      type: 'trend_change' as const,
      category: r.category_slug,
      title: `Zmiana trendu: ${r.category_slug}`,
      description: `Średnia tygodniowa: ${Number(r.prev_avg).toFixed(2)} → ${Number(r.current_avg).toFixed(2)} zł (${r.weekly_change}%)`,
      severity: 'info' as const,
      data: r,
    }));
  }

  /** Zapisz insights do bazy */
  private async saveInsights(insights: PriceInsight[]): Promise<void> {
    for (const insight of insights) {
      try {
        await query(
          `INSERT INTO analytics_insights (type, category, title, description, severity, data)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [insight.type, insight.category, insight.title, insight.description, insight.severity, JSON.stringify(insight.data)],
        );
      } catch {
        // Ignoruj duplikaty
      }
    }
  }
}
