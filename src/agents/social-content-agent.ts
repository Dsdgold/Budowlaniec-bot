/**
 * SocialContentAgent — generuje posty i zapisuje do bazy
 * Posty widoczne na stronie klienta
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
      cronSchedule: '5 * * * *',
      tags: ['content', 'social', 'profit'],
    });
  }

  protected async execute(): Promise<AgentResult> {
    let generated = 0;

    // Upewnij sie ze tabela istnieje
    try {
      await query(`CREATE TABLE IF NOT EXISTS social_posts (
        id SERIAL PRIMARY KEY, title VARCHAR(300), content TEXT NOT NULL,
        hashtags TEXT, category VARCHAR(50), post_type VARCHAR(30) DEFAULT 'trend',
        source VARCHAR(50) DEFAULT 'SocialContentAgent', published BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
    } catch (e) {
      logger.error('[SocialContentAgent] Blad tworzenia tabeli: ' + (e as Error).message);
    }

    // Pobierz ceny z bazy
    let priceContext = '';
    try {
      const prices = await query(
        'SELECT p.name, ph.price, p.seller_slug FROM price_history ph JOIN products p ON p.id = ph.product_id ORDER BY ph.scraped_at DESC LIMIT 8'
      );
      if (prices.length > 0) {
        priceContext = prices.map((p: any) => p.name + ': ' + Number(p.price).toFixed(2) + ' zl (' + p.seller_slug + ')').join(', ');
      }
    } catch {}

    if (!priceContext) {
      priceContext = 'Cement CEM I: 23.90 zl, Styropian EPS 100: 22.90 zl, Deska sosnowa: 12.50 zl, Pret fi12: 38.90 zl, Welna mineralna: 45.00 zl';
    }

    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: 'Generuj 3 posty social media o cenach materialow budowlanych. Po polsku. Odpowiedz TYLKO JSON array: [{"title":"tytul","content":"tresc max 200 znakow","hashtags":"#budowa #ceny","post_type":"trend"}]. Bez markdown, bez tekstu, TYLKO JSON.',
        messages: [{ role: 'user', content: 'Ceny: ' + priceContext + '. Wygeneruj 3 posty. TYLKO JSON array.' }],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '';
      logger.info('[SocialContentAgent] Response: ' + text.substring(0, 100));

      // Parsuj JSON — kilka metod
      let posts: any[] = [];
      try {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) posts = JSON.parse(match[0]);
      } catch {
        // Fallback — sprobuj caly tekst
        try { posts = JSON.parse(text); } catch {}
      }

      if (posts.length === 0) {
        // Fallback — stworz post z odpowiedzi
        posts = [{ title: 'Aktualizacja cen', content: text.substring(0, 200), hashtags: '#materialybudowlane #ceny', post_type: 'trend' }];
      }

      for (const post of posts.slice(0, 5)) {
        try {
          await query(
            'INSERT INTO social_posts (title, content, hashtags, post_type, category) VALUES ($1, $2, $3, $4, $5)',
            [post.title || 'Post', post.content || '', post.hashtags || '#budowa', post.post_type || 'trend', 'general']
          );
          generated++;
        } catch (e) {
          logger.error('[SocialContentAgent] Blad zapisu: ' + (e as Error).message);
        }
      }

      if (generated > 0) {
        eventBus.log('success', this.name, 'Wygenerowano ' + generated + ' postow');
      }
    } catch (error) {
      logger.error('[SocialContentAgent] Blad AI: ' + (error as Error).message);
    }

    return {
      success: generated > 0,
      message: 'Postow: ' + generated,
      data: { generated },
    };
  }
}
