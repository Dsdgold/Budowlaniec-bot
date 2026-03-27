/**
 * LeadsAgent — generuje leady budowlane z przetargów publicznych i ogłoszeń
 * Scrapuje BZP (Biuletyn Zamówień Publicznych) i inne źródła
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import logger from '../utils/logger';

/** Lead budowlany */
interface BuildLead {
  title: string;
  description: string;
  source: string;
  sourceUrl: string;
  region?: string;
  estimatedValue?: number;
  deadline?: Date;
  category: string;
  contactInfo?: string;
}

export class LeadsAgent extends BaseAgent {
  constructor() {
    super({
      name: 'LeadsAgent',
      description: 'Wyszukuje leady budowlane z przetargów publicznych i ogłoszeń',
      icon: '🎯',
      cronSchedule: '0 8,14 * * *', // 2x dziennie: 8:00 i 14:00
      tags: ['leads', 'scraping', 'business'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let totalLeads = 0;
    let errors = 0;

    // Źródło 1: RSS z BZP (Biuletyn Zamówień Publicznych)
    try {
      const bzpLeads = await this.fetchBZP();
      if (bzpLeads.length > 0) {
        await this.saveLeads(bzpLeads);
        totalLeads += bzpLeads.length;
      }
    } catch (error) {
      errors++;
      logger.error('❌ [LeadsAgent] Błąd BZP:', error);
    }

    // Źródło 2: Oferty pracy / zlecenia budowlane
    try {
      const jobLeads = await this.fetchConstructionJobs();
      if (jobLeads.length > 0) {
        await this.saveLeads(jobLeads);
        totalLeads += jobLeads.length;
      }
    } catch (error) {
      errors++;
      logger.error('❌ [LeadsAgent] Błąd zleceń:', error);
    }

    // Powiadom o nowych leadach
    if (totalLeads > 0) {
      eventBus.emitNetwork({
        type: 'leads:new',
        source: this.name,
        timestamp: new Date(),
        data: { count: totalLeads },
      });
    }

    return {
      success: errors === 0,
      message: `Leady: ${totalLeads} nowych, ${errors} błędów`,
      data: { totalLeads, errors },
    };
  }

  /** Pobierz przetargi z BZP via RSS */
  private async fetchBZP(): Promise<BuildLead[]> {
    const leads: BuildLead[] = [];

    try {
      const RssParser = (await import('rss-parser')).default;
      const parser = new RssParser({ timeout: 15000 });

      // BZP RSS — budownictwo (kategoria 45)
      const bzpUrls = [
        'https://bzp.uzp.gov.pl/Feed/SearchFeed?cpvCode=45000000',
      ];

      for (const url of bzpUrls) {
        try {
          const feed = await parser.parseURL(url);
          for (const item of (feed.items || []).slice(0, 20)) {
            leads.push({
              title: item.title || 'Przetarg budowlany',
              description: (item.contentSnippet || item.content || '').substring(0, 500),
              source: 'BZP',
              sourceUrl: item.link || url,
              category: 'przetarg',
              deadline: item.pubDate ? new Date(item.pubDate) : undefined,
            });
          }
        } catch {
          logger.warn(`⚠️ [LeadsAgent] Nie udało się pobrać: ${url}`);
        }
      }
    } catch (error) {
      logger.error('❌ [LeadsAgent] Błąd parsera RSS:', error);
    }

    return leads;
  }

  /** Pobierz zlecenia budowlane */
  private async fetchConstructionJobs(): Promise<BuildLead[]> {
    const leads: BuildLead[] = [];

    try {
      const RssParser = (await import('rss-parser')).default;
      const parser = new RssParser({ timeout: 15000 });

      const jobSources = [
        { name: 'OLX Usługi budowlane', url: 'https://www.olx.pl/rss/uslugi/budowa-remont/' },
      ];

      for (const source of jobSources) {
        try {
          const feed = await parser.parseURL(source.url);
          for (const item of (feed.items || []).slice(0, 15)) {
            leads.push({
              title: item.title || 'Zlecenie budowlane',
              description: (item.contentSnippet || '').substring(0, 500),
              source: source.name,
              sourceUrl: item.link || source.url,
              category: 'zlecenie',
            });
          }
        } catch {
          logger.warn(`⚠️ [LeadsAgent] Nie udało się pobrać: ${source.name}`);
        }
      }
    } catch (error) {
      logger.error('❌ [LeadsAgent] Błąd pobierania zleceń:', error);
    }

    return leads;
  }

  /** Zapisz leady do bazy */
  private async saveLeads(leads: BuildLead[]): Promise<number> {
    let saved = 0;
    for (const lead of leads) {
      try {
        const existing = await query(
          'SELECT id FROM build_leads WHERE source_url = $1',
          [lead.sourceUrl],
        );
        if (existing.length > 0) continue;

        await query(
          `INSERT INTO build_leads (title, description, source, source_url, region, estimated_value, deadline, category, contact_info)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            lead.title,
            lead.description,
            lead.source,
            lead.sourceUrl,
            lead.region || null,
            lead.estimatedValue || null,
            lead.deadline || null,
            lead.category,
            lead.contactInfo || null,
          ],
        );
        saved++;
      } catch (error) {
        logger.error(`❌ [LeadsAgent] Błąd zapisu leada: ${(error as Error).message}`);
      }
    }
    return saved;
  }
}
