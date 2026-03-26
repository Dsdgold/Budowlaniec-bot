/**
 * Asystent AI oparty na Anthropic Claude Haiku
 * MINIMALNE zużycie tokenów — AI tylko przez /pytaj, z cache i limitami
 */
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { getLatestPrices, getPriceChanges24h, comparePrices, getCategoryStats } from '../db/prices';
import { searchArticles } from '../db/news';
import { KATEGORIE_LABELS, Kategoria } from '../config';
import { getCachedResponse, setCachedResponse } from './cache';
import { checkAndIncrementAiQueries } from '../db/users';
import logger from '../utils/logger';

const anthropic = new Anthropic({
  apiKey: config.ANTHROPIC_API_KEY,
});

/** Model — Haiku jest najtańszy (~10x taniej niż Sonnet) */
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Zbierz kontekst cenowy dla użytkownika (z bazy, bez AI)
 */
async function gatherPriceContext(userQuery: string): Promise<string> {
  let context = '';

  // Sprawdź czy pytanie dotyczy konkretnej kategorii
  const mentionedCategory = findMentionedCategory(userQuery);

  if (mentionedCategory) {
    const prices = await getLatestPrices(mentionedCategory, 5);
    const changes = await getPriceChanges24h(mentionedCategory);
    const stats = await getCategoryStats(mentionedCategory);

    context += `Kategoria: ${KATEGORIE_LABELS[mentionedCategory]}\n`;
    if (stats) {
      context += `Produktów: ${stats.total_products}, Śr. cena: ${stats.avg_price} zł, Min: ${stats.min_price} zł, Max: ${stats.max_price} zł\n`;
    }
    if (changes.length > 0) {
      context += `Zmiany cen (24h): `;
      changes.slice(0, 3).forEach((c) => {
        context += `${c.product_name}: ${c.prev_price}→${c.current_price} zł; `;
      });
      context += '\n';
    }
    if (prices.length > 0) {
      prices.slice(0, 3).forEach((p) => {
        context += `${p.name}: ${p.price} zł (${p.seller_slug}); `;
      });
      context += '\n';
    }
  }

  // Szukaj powiązanych newsów (max 2)
  const keywords = userQuery.split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
  for (const keyword of keywords) {
    const articles = await searchArticles(keyword, 2);
    if (articles.length > 0) {
      context += `Newsy: `;
      articles.forEach((a) => {
        context += `${a.title}; `;
      });
      break;
    }
  }

  return context;
}

/**
 * Odpowiedz na pytanie użytkownika — z cache i limitami
 * Zwraca null jeśli limit wyczerpany
 */
export async function askAssistant(
  userId: string,
  userQuery: string,
  isPro: boolean
): Promise<{ response: string; fromCache: boolean } | null> {
  logger.info(`🤖 [AI] Pytanie od ${userId}: ${userQuery.substring(0, 80)}...`);

  // 1. Sprawdź cache
  const cached = await getCachedResponse(userQuery);
  if (cached) {
    logger.info(`✅ [AI] Odpowiedź z cache (0 tokenów)`);
    return { response: cached, fromCache: true };
  }

  // 2. Sprawdź limit dzienny
  const limit = isPro ? config.AI_DAILY_LIMIT_PRO : config.AI_DAILY_LIMIT_FREE;
  const allowed = await checkAndIncrementAiQueries(userId, limit);
  if (!allowed) {
    return null; // Limit wyczerpany — handler pokaże odpowiedni szablon
  }

  // 3. Zbierz kontekst z bazy (bez AI)
  const priceContext = await gatherPriceContext(userQuery);

  try {
    // 4. Zapytaj Claude Haiku — MINIMALNY prompt, max 300 tokenów odpowiedzi
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system: `Jesteś Budowlaniec Bot — ekspert rynku materiałów budowlanych w Polsce. Odpowiadaj KRÓTKO (max 200 znaków), po polsku, z konkretnymi liczbami gdy masz dane. Ton: jak doświadczony budowlaniec.`,
      messages: [
        {
          role: 'user',
          content: priceContext
            ? `Dane z bazy:\n${priceContext}\n\nPytanie: ${userQuery}`
            : userQuery,
        },
      ],
    });

    const response = message.content[0].type === 'text'
      ? message.content[0].text.trim()
      : 'Nie udało się przetworzyć odpowiedzi.';

    // 5. Zapisz w cache
    await setCachedResponse(userQuery, response);

    logger.info(`🤖 [AI] Odpowiedź (${message.usage.input_tokens}+${message.usage.output_tokens} tokenów)`);
    return { response, fromCache: false };
  } catch (error) {
    logger.error(`❌ [AI] Błąd: ${(error as Error).message}`);
    return { response: 'Przepraszam, wystąpił błąd. Spróbuj ponownie.', fromCache: false };
  }
}

/**
 * Znajdź kategorię wymienioną w tekście
 */
function findMentionedCategory(text: string): Kategoria | null {
  const normalized = text.toLowerCase();

  const keywords: Record<string, Kategoria> = {
    cement: 'cement', beton: 'cement', zaprawa: 'cement',
    stal: 'stal', metal: 'stal', pręt: 'stal',
    drewno: 'drewno', deska: 'drewno', belka: 'drewno',
    izolacja: 'izolacja', styropian: 'izolacja', wełna: 'izolacja', ocieplenie: 'izolacja',
    płytk: 'ceramika', ceramik: 'ceramika', gres: 'ceramika',
    chemia: 'chemia-budowlana', klej: 'chemia-budowlana', fuga: 'chemia-budowlana',
    instalacj: 'instalacje', rura: 'instalacje',
    dach: 'dachy', blacha: 'dachy',
    okn: 'okna-drzwi', drzwi: 'okna-drzwi',
    narzędz: 'narzedzia', wiertark: 'narzedzia',
  };

  for (const [keyword, category] of Object.entries(keywords)) {
    if (normalized.includes(keyword)) return category;
  }
  return null;
}
