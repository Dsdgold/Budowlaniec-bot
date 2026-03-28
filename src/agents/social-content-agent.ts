/**
 * SocialContentAgent — generuje posty social media i zapisuje do bazy
 * Posty widoczne na stronie klienta w sekcji Aktualności
 */
import { BaseAgent, AgentResult } from '../core/agent';
import { query } from '../db/client';
import { eventBus } from '../core/events';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import logger from '../utils/logger';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export class SocialContentAgent extends BaseAgent {
  constructor() {
    super({
      name: 'SocialContentAgent',
      description: 'Generuje posty social media o cenach materialow — widoczne na stronie',
      icon: '📱',
      cronSchedule: '5 * * * *', // co godzine :05
      tags: ['content', 'social', 'profit'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let generated = 0;

    try {
      // Pobierz dane cenowe z bazy
      let priceContext = '';
      try {
        const prices = await query(
          "SELECT p.name, ph.price, p.seller_slug, p.category_slug FROM price_history ph JOIN products p ON p.id = ph.product_id ORDER BY ph.scraped_at DESC LIMIT 10"
        );
        priceContext = prices.map((p: any) =>
          p.name + ': ' + Number(p.price).toFixed(2) + ' zl (' + p.seller_slug + ')'
        ).join('\n');
      } catch {}

      if (!priceContext) {
        priceContext = 'Cement CEM I 42,5R: 23.90 zl, Styropian EPS 100: 22.90 zl, Deska sosnowa: 12.50 zl, Pret zbrojeniowy fi12: 38.90 zl';
      }

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: [
          'Generujesz posty social media o cenach materialow budowlanych w Polsce.',
          'Kazdy post: tytul, tresc (max 280 znakow), hashtagi, typ (trend/porada/alert/ranking).',
          'Po polsku, konkretne liczby, profesjonalnie ale przystepnie.',
          'Format: JSON array [{"title":"...","content":"...","hashtags":"...","post_type":"trend"}]',
          'Generuj dokladnie 3 posty. Tylko JSON, bez markdown.',
        ].join('\n'),
        messages: [{
          role: 'user',
          content: 'Aktualne ceny:\n' + priceContext + '\n\nWygeneruj 3 posty. Tylko JSON array.',
        }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const posts = JSON.parse(jsonMatch[0]);
        for (const post of posts.slice(0, 5)) {
          await query(
            "INSERT INTO social_posts (title, content, hashtags, post_type, category) VALUES ($1, $2, $3, $4, $5)",
            [post.title, post.content, post.hashtags || '#materialybudowlane', post.post_type || 'trend', 'general']
          ).catch(() => {});
          generated++;
        }
      }
    } catch (error) {
      logger.error('[SocialContentAgent] Blad:', error);
    }

    return {
      success: generated > 0,
      message: 'Wygenerowano ' + generated + ' postow',
      data: { generated },
    };
  }
}
