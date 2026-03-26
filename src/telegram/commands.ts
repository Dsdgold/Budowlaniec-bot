/**
 * Handlery komend Telegram — SZABLONY + /pytaj dla AI
 *
 * ZASADA: żadna komenda oprócz /pytaj nie używa AI = 0 tokenów
 * Wszystko oparte na szablonach z src/templates/messages.ts
 */
import { Context } from 'telegraf';
import {
  findUserByPhone, createUser, setUserPreferences,
  updateUserRegion, completeOnboarding, getUserPreferences,
} from '../db/users';
import {
  getLatestPrices, getPriceChanges24h, comparePrices, getCategoryStats,
  getCategoryTrend, createKeywordAlert, getUserAlerts, deleteUserAlert,
  getPriceDropsRanking, getBestPromos, getSellerRanking,
} from '../db/prices';
import { getSummarizedArticles } from '../db/news';
import { askAssistant } from '../ai/assistant';
import { KATEGORIE, KATEGORIE_LABELS, REGIONY, Kategoria, config } from '../config';
import { messageSender } from './sender';
import { mainMenuKeyboard, categorySelectionKeyboard, priceCategoryKeyboard, settingsKeyboard, trendCategoryKeyboard } from './keyboards';
import * as tpl from '../templates/messages';
import logger from '../utils/logger';

/**
 * Tymczasowy stan wyboru kategorii (per użytkownik)
 * Klucz: chatId, wartość: aktualnie zaznaczone kategorie
 */
const categorySelectionState = new Map<number, Set<Kategoria>>();

/**
 * Pobierz lub utwórz użytkownika na podstawie kontekstu Telegram
 * Telegram identyfikuje userów po chatId (numer), nie po telefonie
 */
async function getOrCreateUser(ctx: Context): Promise<{ id: string; is_pro: boolean; phone: string }> {
  const chatId = ctx.chat?.id?.toString() || '';
  const name = ctx.from?.first_name || null;

  let user = await findUserByPhone(chatId);
  if (!user) {
    user = await createUser(chatId, name || undefined);
  }
  return { id: user.id, is_pro: user.is_pro, phone: user.phone };
}

// === HANDLERY KOMEND ===

/** /start — Onboarding z inline keyboard */
export async function handleStart(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  await getOrCreateUser(ctx);

  // Wyślij powitanie z klawiaturą głównego menu
  await ctx.reply(tpl.welcomeMessage(), { parse_mode: 'Markdown' });

  // Wyślij inline keyboard do wyboru kategorii
  categorySelectionState.set(chatId, new Set());
  await ctx.reply(
    '📋 *Wybierz kategorie klikając przyciski:*',
    {
      parse_mode: 'Markdown',
      ...categorySelectionKeyboard([]),
    }
  );
}

/** /ceny [kategoria] — Szablonowa odpowiedź z danych bazy */
export async function handleCeny(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getOrCreateUser(ctx);
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text || '' : '';
  const argsText = text.replace(/^\/ceny\s*/i, '').trim();

  if (argsText) {
    const category = findCategory(argsText);
    if (!category) {
      await ctx.reply(tpl.categoryNotFoundMessage(argsText), { parse_mode: 'Markdown' });
      return;
    }

    const prices = await getLatestPrices(category, 15);
    const stats = await getCategoryStats(category);
    const changes = await getPriceChanges24h(category);

    await messageSender.sendLong(chatId, tpl.priceDetailMessage(
      category,
      stats,
      changes.slice(0, 10),
      prices.slice(0, 10).map((p) => ({
        name: p.name, price: p.price, is_promo: p.is_promo, seller_slug: p.seller_slug,
      }))
    ));
    return;
  }

  // Bez argumentu — pokaż klawiaturę kategorii
  const prefs = await getUserPreferences(user.id);
  if (prefs.length === 0) {
    await ctx.reply(tpl.noCategoriesMessage(), { parse_mode: 'Markdown' });
    await ctx.reply('Lub wybierz kategorię:', priceCategoryKeyboard());
    return;
  }

  // Podsumowanie preferencji użytkownika
  const categories = [];
  for (const pref of prefs) {
    const stats = await getCategoryStats(pref.category_slug);
    const changes = await getPriceChanges24h(pref.category_slug);
    categories.push({
      slug: pref.category_slug,
      stats,
      changesCount: changes.length,
    });
  }

  await messageSender.sendLong(chatId, tpl.priceSummaryMessage(categories));
}

/** /newsy — Szablon z danych bazy */
export async function handleNewsy(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const articles = await getSummarizedArticles(24, 8);
  await messageSender.sendLong(chatId, tpl.newsMessage(
    articles.map((a) => ({
      title: a.title,
      summary: a.summary,
      url: a.url,
      source_name: a.source_name,
      published_at: a.published_at,
    }))
  ));
}

/** /ustawienia — Klawiatura ustawień */
export async function handleUstawienia(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getOrCreateUser(ctx);
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text || '' : '';
  const argsText = text.replace(/^\/ustawienia\s*/i, '').trim();

  if (!argsText) {
    const prefs = await getUserPreferences(user.id);
    const fullUser = await findUserByPhone(chatId.toString());
    await ctx.reply(
      tpl.settingsMessage(prefs.map((p) => p.category_slug), fullUser?.region),
      { parse_mode: 'Markdown', ...settingsKeyboard() }
    );
    return;
  }

  const [subCommand, ...subArgs] = argsText.split(' ');

  switch (subCommand.toLowerCase()) {
    case 'kategorie':
      categorySelectionState.set(chatId, new Set());
      await ctx.reply(
        '📋 *Wybierz kategorie:*',
        { parse_mode: 'Markdown', ...categorySelectionKeyboard([]) }
      );
      break;

    case 'region': {
      const regionName = subArgs.join(' ').toLowerCase();
      if (regionName && REGIONY.includes(regionName as any)) {
        await updateUserRegion(user.id, regionName as any);
        await ctx.reply(tpl.regionChangedMessage(regionName), { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(tpl.regionListMessage(), { parse_mode: 'Markdown' });
      }
      break;
    }

    case 'raport': {
      const time = subArgs[0];
      if (time && /^\d{2}:\d{2}$/.test(time)) {
        const { updateReportTime } = await import('../db/users');
        await updateReportTime(user.id, time);
        await ctx.reply(tpl.reportTimeChangedMessage(time), { parse_mode: 'Markdown' });
      } else {
        await ctx.reply('Podaj godzinę w formacie HH:MM, np.: /ustawienia raport 08:00');
      }
      break;
    }

    default:
      await ctx.reply('Nieznana opcja. Użyj /ustawienia bez argumentów.', { parse_mode: 'Markdown' });
  }
}

/** /pro — Informacje o koncie PRO */
export async function handlePro(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const fullUser = await findUserByPhone(chatId.toString());
  if (fullUser?.is_pro) {
    const expiresAt = fullUser.pro_expires_at
      ? new Date(fullUser.pro_expires_at).toLocaleDateString('pl-PL')
      : 'brak daty';
    await ctx.reply(tpl.proActiveMessage(expiresAt), { parse_mode: 'Markdown' });
  } else {
    await ctx.reply(tpl.proOfferMessage(), { parse_mode: 'Markdown' });
  }
}

/** /pomoc — Lista komend */
export async function handlePomoc(ctx: Context): Promise<void> {
  await ctx.reply(tpl.helpMessage(), { parse_mode: 'Markdown', ...mainMenuKeyboard });
}

/** /porownaj [produkt] — Porównanie cen */
export async function handlePorownaj(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text || '' : '';
  const productName = text.replace(/^\/porownaj\s*/i, '').trim();

  if (!productName) {
    await ctx.reply(tpl.compareUsageMessage(), { parse_mode: 'Markdown' });
    return;
  }

  const results = await comparePrices(productName);
  if (results.length === 0) {
    await ctx.reply(tpl.compareNoResultsMessage(productName), { parse_mode: 'Markdown' });
    return;
  }

  await messageSender.sendLong(chatId, tpl.compareResultMessage(
    productName,
    results.slice(0, 15).map((p) => ({
      name: p.name, price: p.price, is_promo: p.is_promo, seller_slug: p.seller_slug,
    }))
  ));
}

/**
 * /pytaj [treść] — JEDYNE MIEJSCE gdzie używamy AI
 * Sprawdza cache → sprawdza limit → pyta Claude Haiku
 */
export async function handlePytaj(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getOrCreateUser(ctx);
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text || '' : '';
  const queryText = text.replace(/^\/pytaj\s*/i, '').trim();

  if (!queryText) {
    await ctx.reply(tpl.aiUsageMessage(), { parse_mode: 'Markdown' });
    return;
  }

  try {
    const result = await askAssistant(user.id, queryText, user.is_pro);

    if (result === null) {
      const limit = user.is_pro ? config.AI_DAILY_LIMIT_PRO : config.AI_DAILY_LIMIT_FREE;
      await ctx.reply(tpl.aiLimitReachedMessage(limit, user.is_pro), { parse_mode: 'Markdown' });
      return;
    }

    const cacheInfo = result.fromCache ? ' _(z cache)_' : '';
    await ctx.reply(`🤖 ${result.response}${cacheInfo}`, { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ [Pytaj] Błąd:', error);
    await ctx.reply(tpl.aiErrorMessage(), { parse_mode: 'Markdown' });
  }
}

/** /trend [kategoria] — Trend cenowy z mini wykresem ASCII */
export async function handleTrend(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text || '' : '';
  const argsText = text.replace(/^\/trend\s*/i, '').trim();

  if (!argsText) {
    await ctx.reply(
      '📉 Użyj: */trend [kategoria]*\nNp.: /trend cement\n\nPokaże wykres cenowy z ostatnich 7 i 30 dni.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const category = findCategory(argsText);
  if (!category) {
    await ctx.reply(tpl.categoryNotFoundMessage(argsText), { parse_mode: 'Markdown' });
    return;
  }

  const data7d = await getCategoryTrend(category, 7);
  const data30d = await getCategoryTrend(category, 30);

  await messageSender.sendLong(chatId, tpl.trendMessage(category, data7d, data30d));
}

/** /alert [produkt] [cena] — Ustaw alert cenowy */
export async function handleAlert(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getOrCreateUser(ctx);
  const text = (ctx.message && 'text' in ctx.message) ? ctx.message.text || '' : '';
  const argsText = text.replace(/^\/alert\s*/i, '').trim();

  if (!argsText) {
    await ctx.reply(tpl.alertUsageMessage(), { parse_mode: 'Markdown' });
    return;
  }

  // /alert lista
  if (argsText.toLowerCase() === 'lista') {
    const alerts = await getUserAlerts(user.id);
    await ctx.reply(tpl.alertListMessage(alerts), { parse_mode: 'Markdown' });
    return;
  }

  // /alert usun [keyword]
  if (argsText.toLowerCase().startsWith('usun ') || argsText.toLowerCase().startsWith('usuń ')) {
    const keyword = argsText.replace(/^usu[nń]\s*/i, '').trim();
    if (!keyword) {
      await ctx.reply('Podaj nazwę alertu do usunięcia: */alert usun [produkt]*', { parse_mode: 'Markdown' });
      return;
    }
    const deleted = await deleteUserAlert(user.id, keyword);
    if (deleted) {
      await ctx.reply(tpl.alertDeletedMessage(keyword), { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(tpl.alertNotFoundMessage(keyword), { parse_mode: 'Markdown' });
    }
    return;
  }

  // /alert [produkt] [cena] — parsuj argumenty
  // Ostatni token to cena, reszta to nazwa produktu
  const tokens = argsText.split(/\s+/);
  const lastToken = tokens[tokens.length - 1];
  const price = parseFloat(lastToken.replace(',', '.'));

  if (isNaN(price) || tokens.length < 2) {
    await ctx.reply(tpl.alertUsageMessage(), { parse_mode: 'Markdown' });
    return;
  }

  const keyword = tokens.slice(0, -1).join(' ');

  try {
    await createKeywordAlert(user.id, keyword, price);
    await ctx.reply(tpl.alertCreatedMessage(keyword, price), { parse_mode: 'Markdown' });
  } catch (error) {
    logger.error('❌ [Alert] Błąd tworzenia alertu:', error);
    await ctx.reply(tpl.genericErrorMessage(), { parse_mode: 'Markdown' });
  }
}

/** /raport — Generuj raport na żądanie */
export async function handleRaport(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const user = await getOrCreateUser(ctx);
  await ctx.reply('⏳ _Generuję raport..._', { parse_mode: 'Markdown' });

  const prefs = await getUserPreferences(user.id);
  const cats = prefs.length > 0
    ? prefs.map((p) => p.category_slug)
    : KATEGORIE.slice(0, 3); // Domyślnie 3 pierwsze kategorie

  const categories = [];
  for (const slug of cats) {
    const stats = await getCategoryStats(slug);
    const changes = await getPriceChanges24h(slug);
    categories.push({
      slug,
      stats,
      changes: changes.slice(0, 5).map((c) => ({
        product_name: c.product_name,
        prev_price: c.prev_price,
        current_price: c.current_price,
        change_percent: c.change_percent,
        seller_slug: c.seller_slug,
      })),
    });
  }

  const articles = await getSummarizedArticles(24, 5);
  const articlesList = articles.map((a) => ({
    title: a.title,
    summary: a.summary,
    source_name: a.source_name,
  }));

  await messageSender.sendLong(chatId, tpl.onDemandReportMessage(categories, articlesList));
}

/** /ranking — Top spadki, promocje, ranking sklepów */
export async function handleRanking(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const [drops, promos, sellers] = await Promise.all([
    getPriceDropsRanking(10),
    getBestPromos(10),
    getSellerRanking(),
  ]);

  await messageSender.sendLong(chatId, tpl.rankingMessage(
    drops.map((d) => ({
      product_name: d.product_name,
      seller_slug: d.seller_slug,
      prev_price: Number(d.prev_price),
      current_price: Number(d.current_price),
      change_percent: Number(d.change_percent),
    })),
    promos.map((p) => ({
      product_name: p.product_name,
      seller_slug: p.seller_slug,
      price: Number(p.price),
      original_price: Number(p.original_price),
      discount_percent: Number(p.discount_percent),
    })),
    sellers.map((s) => ({
      seller_slug: s.seller_slug,
      avg_price: Number(s.avg_price),
      product_count: Number(s.product_count),
      promo_count: Number(s.promo_count),
    })),
  ));
}

// === CALLBACK QUERY HANDLERS (inline keyboard) ===

/**
 * Handler kliknięcia przycisku kategorii (checkbox)
 */
export async function handleCategoryCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery.data;
  if (!data?.startsWith('cat:')) return;

  const action = data.replace('cat:', '');

  // Zapisz wybór
  if (action === 'save') {
    const selected = categorySelectionState.get(chatId);
    if (!selected || selected.size === 0) {
      await ctx.answerCbQuery('Wybierz przynajmniej jedną kategorię!');
      return;
    }

    const user = await getOrCreateUser(ctx);
    const categories = Array.from(selected) as Kategoria[];
    await setUserPreferences(user.id, categories);
    await completeOnboarding(user.id);

    categorySelectionState.delete(chatId);
    await ctx.answerCbQuery('Zapisano!');

    // Edytuj wiadomość i pokaż menu
    try {
      await ctx.editMessageText(tpl.categorySelectedMessage(categories), { parse_mode: 'Markdown' });
    } catch {}

    await ctx.reply('Oto Twoje menu:', mainMenuKeyboard);
    return;
  }

  // Toggle kategorii
  const slug = action as Kategoria;
  if (!KATEGORIE.includes(slug)) {
    await ctx.answerCbQuery('Nieznana kategoria');
    return;
  }

  let selected = categorySelectionState.get(chatId);
  if (!selected) {
    selected = new Set();
    categorySelectionState.set(chatId, selected);
  }

  if (selected.has(slug)) {
    selected.delete(slug);
    await ctx.answerCbQuery(`Odznaczono: ${KATEGORIE_LABELS[slug]}`);
  } else {
    selected.add(slug);
    await ctx.answerCbQuery(`Zaznaczono: ${KATEGORIE_LABELS[slug]}`);
  }

  // Zaktualizuj klawiaturę
  try {
    await ctx.editMessageReplyMarkup(
      categorySelectionKeyboard(Array.from(selected)).reply_markup
    );
  } catch {}
}

/**
 * Handler kliknięcia przycisku ceny kategorii
 */
export async function handlePriceCategoryCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery.data;
  if (!data?.startsWith('price:')) return;

  const slug = data.replace('price:', '') as Kategoria;
  await ctx.answerCbQuery();

  const prices = await getLatestPrices(slug, 15);
  const stats = await getCategoryStats(slug);
  const changes = await getPriceChanges24h(slug);

  await messageSender.sendLong(chatId, tpl.priceDetailMessage(
    slug,
    stats,
    changes.slice(0, 10),
    prices.slice(0, 10).map((p) => ({
      name: p.name, price: p.price, is_promo: p.is_promo, seller_slug: p.seller_slug,
    }))
  ));
}

/**
 * Handler kliknięcia przycisków ustawień
 */
export async function handleSettingsCallback(ctx: Context): Promise<void> {
  if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const data = ctx.callbackQuery.data;
  if (!data?.startsWith('settings:')) return;

  const action = data.replace('settings:', '');
  await ctx.answerCbQuery();

  switch (action) {
    case 'categories':
      categorySelectionState.set(chatId, new Set());
      await ctx.reply(
        '📋 *Wybierz nowe kategorie:*',
        { parse_mode: 'Markdown', ...categorySelectionKeyboard([]) }
      );
      break;
    case 'region':
      await ctx.reply(tpl.regionListMessage(), { parse_mode: 'Markdown' });
      break;
    case 'report_time':
      await ctx.reply('Wpisz godzinę raportu, np.: /ustawienia raport 08:00', { parse_mode: 'Markdown' });
      break;
  }
}

/**
 * Handler wiadomości tekstowych (nie-komend)
 * Obsługuje przyciski reply keyboard
 */
export async function handleTextMessage(ctx: Context): Promise<void> {
  if (!ctx.message || !('text' in ctx.message)) return;
  const text = ctx.message.text.trim();

  // Mapowanie przycisków reply keyboard na komendy
  switch (text) {
    case '📊 Ceny':
      return handleCeny(ctx);
    case '📰 Newsy':
      return handleNewsy(ctx);
    case '⚙️ Ustawienia':
      return handleUstawienia(ctx);
    case '📉 Trend':
      // Bez argumentu — pokaż klawiaturę wyboru kategorii trendu
      await ctx.reply(
        '📉 *Wybierz kategorię trendu:*',
        { parse_mode: 'Markdown', ...trendCategoryKeyboard() }
      );
      return;
    case '🏆 Ranking':
      return handleRanking(ctx);
    case '📋 Raport':
      return handleRaport(ctx);
    case '🔔 Alert':
      await ctx.reply(tpl.alertUsageMessage(), { parse_mode: 'Markdown' });
      return;
    case '🤖 Pytaj AI':
      await ctx.reply(tpl.aiUsageMessage(), { parse_mode: 'Markdown' });
      return;
    case '⭐ PRO':
      return handlePro(ctx);
    case '❓ Pomoc':
      return handlePomoc(ctx);
    case '🚀 Otwórz aplikację':
      // WebApp button — Telegram obsługuje natywnie, ale na wypadek:
      await ctx.reply('Użyj przycisku "🚀 Otwórz aplikację" lub wpisz /app');
      return;
    default:
      // Nieznana wiadomość — szablon, BEZ AI
      await ctx.reply(tpl.unknownCommandMessage(), { parse_mode: 'Markdown' });
  }
}

// === UTILS ===

function findCategory(text: string): Kategoria | null {
  const normalized = text.toLowerCase().trim();
  if (KATEGORIE.includes(normalized as Kategoria)) return normalized as Kategoria;
  for (const [slug, label] of Object.entries(KATEGORIE_LABELS)) {
    if (label.toLowerCase().includes(normalized) || normalized.includes(slug)) {
      return slug as Kategoria;
    }
  }
  return null;
}
