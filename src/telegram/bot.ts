/**
 * Inicjalizacja bota Telegram (Telegraf)
 * Rejestracja komend, middleware, inline mode, start/stop
 *
 * v2.1 — nowe komendy + inline mode
 */
import { Telegraf, Markup } from 'telegraf';
import { config, KATEGORIE, KATEGORIE_LABELS, Kategoria } from '../config';
import { messageSender } from './sender';
import {
  handleStart,
  handleCeny,
  handleNewsy,
  handleUstawienia,
  handlePro,
  handlePomoc,
  handlePorownaj,
  handlePytaj,
  handleTrend,
  handleAlert,
  handleRaport,
  handleRanking,
  handleCategoryCallback,
  handlePriceCategoryCallback,
  handleSettingsCallback,
  handleTextMessage,
} from './commands';
import { getCategoryTrend } from '../db/prices';
import { comparePrices } from '../db/prices';
import { trendCategoryKeyboard } from './keyboards';
import * as tpl from '../templates/messages';
import logger from '../utils/logger';

/** Globalna instancja bota */
let bot: Telegraf | null = null;

/**
 * Pobierz instancję bota
 */
export function getBot(): Telegraf {
  if (!bot) {
    throw new Error('Bot Telegram nie jest zainicjalizowany');
  }
  return bot;
}

/**
 * Sprawdź czy bot jest połączony
 */
export function isBotRunning(): boolean {
  return bot !== null;
}

/**
 * Uruchom bota Telegram
 */
export async function startTelegramBot(): Promise<Telegraf> {
  logger.info('🤖 Uruchamiam bota Telegram...');

  bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);

  // Ustaw instancję bota w senderze
  messageSender.setBot(bot);

  // === Middleware — logowanie ===
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id || 'unknown';
    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (messageText) {
      logger.info(`📩 Wiadomość od ${userId}: ${messageText.substring(0, 100)}`);
    }
    return next();
  });

  // === Middleware — obsługa błędów ===
  bot.catch((err: any, ctx) => {
    logger.error(`❌ Błąd bota Telegram:`, err);
    ctx.reply('😔 Wystąpił błąd. Spróbuj ponownie za chwilę lub użyj /pomoc.').catch(() => {});
  });

  // === Rejestracja komend ===
  bot.command('start', handleStart);
  bot.command('ceny', handleCeny);
  bot.command('newsy', handleNewsy);
  bot.command('ustawienia', handleUstawienia);
  bot.command('pro', handlePro);
  bot.command('pomoc', handlePomoc);
  bot.command('help', handlePomoc);
  bot.command('porownaj', handlePorownaj);
  bot.command('pytaj', handlePytaj);
  // Nowe komendy v2.1
  bot.command('trend', handleTrend);
  bot.command('alert', handleAlert);
  bot.command('raport', handleRaport);
  bot.command('ranking', handleRanking);

  // Komenda /app — otwiera Mini App (WebApp)
  bot.command('app', async (ctx) => {
    const webAppUrl = `${process.env.WEBAPP_URL || 'https://' + (process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + config.PORT)}/webapp`;
    await ctx.reply('🚀 Otwórz aplikację Budowlaniec:', {
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Otwórz aplikację', web_app: { url: webAppUrl } }
        ]],
      },
    });
  });

  // === Callback query handlers (inline keyboard) ===
  bot.action(/^cat:/, handleCategoryCallback);
  bot.action(/^price:/, handlePriceCategoryCallback);
  bot.action(/^settings:/, handleSettingsCallback);

  // Nowy callback handler: trend po kategorii
  bot.action(/^trend:(.+)$/, async (ctx) => {
    const slug = ctx.match[1] as Kategoria;
    await ctx.answerCbQuery();

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const data7d = await getCategoryTrend(slug, 7);
    const data30d = await getCategoryTrend(slug, 30);

    await messageSender.sendLong(chatId, tpl.trendMessage(slug, data7d, data30d));
  });

  // === INLINE MODE ===
  bot.on('inline_query', async (ctx) => {
    const queryText = ctx.inlineQuery.query.trim();
    logger.info(`🔍 Inline query: "${queryText}"`);

    if (!queryText || queryText.length < 2) {
      // Pokaż podpowiedzi domyślne
      await ctx.answerInlineQuery([
        {
          type: 'article',
          id: 'help',
          title: '🏗️ Budowlaniec Bot',
          description: 'Wpisz nazwę produktu aby sprawdzić ceny',
          input_message_content: {
            message_text: '🏗️ Sprawdź ceny materiałów budowlanych!\nUżyj @Budowlaniec_bot [nazwa produktu]',
            parse_mode: 'Markdown',
          },
        },
      ], { cache_time: 10 });
      return;
    }

    try {
      // Szukaj produktów w bazie
      const results = await comparePrices(queryText);
      const inlineResults = results.slice(0, 20).map((p, i) => {
        const promo = p.is_promo ? ' 🏷️' : '';
        return {
          type: 'article' as const,
          id: `price_${i}_${p.id || i}`,
          title: `${p.price} zł${promo} — ${p.name}`,
          description: `📍 ${p.seller_slug}${p.is_promo ? ' | PROMOCJA' : ''}`,
          input_message_content: {
            message_text:
              `🏗️ *${p.name}*\n\n` +
              `💰 Cena: *${p.price} zł*${promo}\n` +
              `🏪 Sklep: ${p.seller_slug}\n` +
              (p.url ? `🔗 ${p.url}\n` : '') +
              `\n_via @Budowlaniec\\_bot_`,
            parse_mode: 'Markdown' as const,
          },
        };
      });

      if (inlineResults.length === 0) {
        await ctx.answerInlineQuery([
          {
            type: 'article',
            id: 'no_results',
            title: `Brak wyników dla "${queryText}"`,
            description: 'Spróbuj innej frazy',
            input_message_content: {
              message_text: `🔍 Nie znaleziono "${queryText}" w bazie Budowlaniec Bot.`,
            },
          },
        ], { cache_time: 30 });
        return;
      }

      await ctx.answerInlineQuery(inlineResults, { cache_time: 60 });
    } catch (error) {
      logger.error('❌ [InlineQuery] Błąd:', error);
      await ctx.answerInlineQuery([], { cache_time: 5 });
    }
  });

  // === Handler wiadomości tekstowych (reply keyboard + inne) ===
  bot.on('text', handleTextMessage);

  // === Ustaw komendy bota w interfejsie Telegram ===
  await bot.telegram.setMyCommands([
    { command: 'start', description: '🏗️ Rozpocznij, wybierz kategorie' },
    { command: 'ceny', description: '📊 Podsumowanie cen materiałów' },
    { command: 'newsy', description: '📰 Najnowsze newsy budowlane' },
    { command: 'trend', description: '📉 Trend cenowy kategorii' },
    { command: 'ranking', description: '🏆 Top spadki, promocje, sklepy' },
    { command: 'alert', description: '🔔 Ustaw alert cenowy' },
    { command: 'raport', description: '📋 Generuj raport na żądanie' },
    { command: 'porownaj', description: '🔍 Porównaj ceny w sklepach' },
    { command: 'ustawienia', description: '⚙️ Zarządzaj preferencjami' },
    { command: 'pytaj', description: '🤖 Zadaj pytanie AI' },
    { command: 'pro', description: '⭐ Informacje o koncie PRO' },
    { command: 'app', description: '🚀 Otwórz Mini App' },
    { command: 'pomoc', description: '❓ Lista komend i pomoc' },
  ]);

  // === Uruchom polling ===
  await bot.launch();
  logger.info('✅ Bot Telegram uruchomiony (polling)');

  return bot;
}

/**
 * Zatrzymaj bota Telegram
 */
export function stopTelegramBot(reason: string = 'shutdown'): void {
  if (bot) {
    bot.stop(reason);
    bot = null;
    logger.info('🛑 Bot Telegram zatrzymany');
  }
}
