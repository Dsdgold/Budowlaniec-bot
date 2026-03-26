/**
 * Router komend WhatsApp — SZABLONY + /pytaj dla AI
 *
 * ZASADA: żadna komenda oprócz /pytaj nie używa AI = 0 tokenów
 * Wszystko oparte na szablonach z src/templates/messages.ts
 */
import { proto } from '@whiskeysockets/baileys';
import { sendMessage } from './client';
import {
  findUserByPhone, createUser, setUserPreferences,
  updateUserRegion, completeOnboarding, getUserPreferences,
} from '../db/users';
import { getLatestPrices, getPriceChanges24h, comparePrices, getCategoryStats } from '../db/prices';
import { getSummarizedArticles } from '../db/news';
import { askAssistant } from '../ai/assistant';
import { KATEGORIE, KATEGORIE_LABELS, REGIONY, Kategoria, config } from '../config';
import { messageSender } from './sender';
import * as tpl from '../templates/messages';
import logger from '../utils/logger';

/**
 * Wyciągnij tekst wiadomości z obiektu proto
 */
function extractMessageText(message: proto.IWebMessageInfo): string | null {
  const msg = message.message;
  if (!msg) return null;
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
    null
  );
}

/**
 * Główny handler przychodzących wiadomości
 */
export async function handleIncomingMessage(
  message: proto.IWebMessageInfo
): Promise<void> {
  const jid = message.key.remoteJid;
  if (!jid) return;

  const text = extractMessageText(message);
  if (!text) return;

  const phone = getPhoneFromJid(jid);
  const trimmedText = text.trim();

  logger.info(`📩 Wiadomość od ${phone}: ${trimmedText.substring(0, 100)}`);

  // Znajdź lub utwórz użytkownika
  let user = await findUserByPhone(phone);
  if (!user) {
    user = await createUser(phone);
  }

  // Parsowanie komendy
  if (trimmedText.startsWith('/')) {
    const [command, ...args] = trimmedText.split(' ');
    const commandName = command.toLowerCase();
    const argsText = args.join(' ').trim();

    switch (commandName) {
      case '/start':
        await handleStart(jid);
        break;
      case '/ceny':
        await handleCeny(jid, user.id, argsText);
        break;
      case '/newsy':
        await handleNewsy(jid);
        break;
      case '/ustawienia':
        await handleUstawienia(jid, user.id, argsText);
        break;
      case '/pro':
        await handlePro(jid, user.id);
        break;
      case '/pomoc':
      case '/help':
        await messageSender.send(jid, tpl.helpMessage());
        break;
      case '/porownaj':
        await handlePorownaj(jid, argsText);
        break;
      case '/pytaj':
        await handlePytaj(jid, user.id, user.is_pro, argsText);
        break;
      default:
        // Nieznana komenda — szablon, BEZ AI
        await messageSender.send(jid, tpl.unknownCommandMessage());
    }
  } else {
    // Zwykła wiadomość — sprawdź onboarding, potem szablon
    const handled = await handleCategorySelection(jid, user.id, trimmedText);
    if (!handled) {
      // NIE przekazujemy do AI — informujemy o /pytaj
      await messageSender.send(jid, tpl.unknownCommandMessage());
    }
  }
}

// === HANDLERY KOMEND (wszystkie na szablonach, 0 tokenów AI) ===

/** /start — Onboarding */
async function handleStart(jid: string): Promise<void> {
  await messageSender.send(jid, tpl.welcomeMessage());
}

/** Obsługa wyboru kategorii podczas onboardingu */
async function handleCategorySelection(
  jid: string, userId: string, text: string
): Promise<boolean> {
  const numbers = text.split(/[,\s]+/).map((n) => parseInt(n.trim())).filter((n) => !isNaN(n));
  if (numbers.length === 0 || numbers.some((n) => n < 1 || n > KATEGORIE.length)) {
    return false;
  }

  const selectedCategories = numbers.map((n) => KATEGORIE[n - 1]);
  await setUserPreferences(userId, selectedCategories);
  await completeOnboarding(userId);
  await messageSender.send(jid, tpl.categorySelectedMessage(selectedCategories));
  return true;
}

/** /ceny [kategoria] — Szablonowa odpowiedź z danych bazy */
async function handleCeny(jid: string, userId: string, argsText: string): Promise<void> {
  if (argsText) {
    const category = findCategory(argsText);
    if (!category) {
      await messageSender.send(jid, tpl.categoryNotFoundMessage(argsText));
      return;
    }

    const prices = await getLatestPrices(category, 15);
    const stats = await getCategoryStats(category);
    const changes = await getPriceChanges24h(category);

    await messageSender.send(jid, tpl.priceDetailMessage(
      category,
      stats,
      changes.slice(0, 10),
      prices.slice(0, 10).map((p) => ({
        name: p.name, price: p.price, is_promo: p.is_promo, seller_slug: p.seller_slug,
      }))
    ));
    return;
  }

  // Bez kategorii — podsumowanie preferencji
  const prefs = await getUserPreferences(userId);
  if (prefs.length === 0) {
    await messageSender.send(jid, tpl.noCategoriesMessage());
    return;
  }

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

  await messageSender.send(jid, tpl.priceSummaryMessage(categories));
}

/** /newsy — Szablon z danych bazy */
async function handleNewsy(jid: string): Promise<void> {
  const articles = await getSummarizedArticles(24, 8);
  await messageSender.send(jid, tpl.newsMessage(
    articles.map((a) => ({
      title: a.title,
      summary: a.summary,
      url: a.url,
      source_name: a.source_name,
      published_at: a.published_at,
    }))
  ));
}

/** /ustawienia — Szablon */
async function handleUstawienia(jid: string, userId: string, argsText: string): Promise<void> {
  if (!argsText) {
    const prefs = await getUserPreferences(userId);
    const user = await findUserByPhone(getPhoneFromJid(jid));
    await messageSender.send(jid, tpl.settingsMessage(
      prefs.map((p) => p.category_slug),
      user?.region
    ));
    return;
  }

  const [subCommand, ...subArgs] = argsText.split(' ');

  switch (subCommand.toLowerCase()) {
    case 'kategorie':
      await messageSender.send(jid, tpl.categorySelectionPrompt());
      break;

    case 'region': {
      const regionName = subArgs.join(' ').toLowerCase();
      if (regionName && REGIONY.includes(regionName as any)) {
        await updateUserRegion(userId, regionName as any);
        await messageSender.send(jid, tpl.regionChangedMessage(regionName));
      } else {
        await messageSender.send(jid, tpl.regionListMessage());
      }
      break;
    }

    case 'raport': {
      const time = subArgs[0];
      if (time && /^\d{2}:\d{2}$/.test(time)) {
        const { updateReportTime } = await import('../db/users');
        await updateReportTime(userId, time);
        await messageSender.send(jid, tpl.reportTimeChangedMessage(time));
      } else {
        await messageSender.send(jid, 'Podaj godzinę w formacie HH:MM, np.: /ustawienia raport 08:00');
      }
      break;
    }

    default:
      await messageSender.send(jid, 'Nieznana opcja. Użyj */ustawienia* bez argumentów.');
  }
}

/** /pro — Szablon */
async function handlePro(jid: string, userId: string): Promise<void> {
  const user = await findUserByPhone(getPhoneFromJid(jid));
  if (user?.is_pro) {
    const expiresAt = user.pro_expires_at
      ? new Date(user.pro_expires_at).toLocaleDateString('pl-PL')
      : 'brak daty';
    await messageSender.send(jid, tpl.proActiveMessage(expiresAt));
  } else {
    await messageSender.send(jid, tpl.proOfferMessage());
  }
}

/** /porownaj [produkt] — Szablon z danych bazy */
async function handlePorownaj(jid: string, productName: string): Promise<void> {
  if (!productName) {
    await messageSender.send(jid, tpl.compareUsageMessage());
    return;
  }

  const results = await comparePrices(productName);
  if (results.length === 0) {
    await messageSender.send(jid, tpl.compareNoResultsMessage(productName));
    return;
  }

  await messageSender.send(jid, tpl.compareResultMessage(
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
async function handlePytaj(
  jid: string, userId: string, isPro: boolean, queryText: string
): Promise<void> {
  if (!queryText) {
    await messageSender.send(jid, tpl.aiUsageMessage());
    return;
  }

  try {
    const result = await askAssistant(userId, queryText, isPro);

    if (result === null) {
      // Limit wyczerpany
      const limit = isPro ? config.AI_DAILY_LIMIT_PRO : config.AI_DAILY_LIMIT_FREE;
      await messageSender.send(jid, tpl.aiLimitReachedMessage(limit, isPro));
      return;
    }

    const cacheInfo = result.fromCache ? ' _(z cache)_' : '';
    await messageSender.send(jid, `🤖 ${result.response}${cacheInfo}`);
  } catch (error) {
    logger.error('❌ [Pytaj] Błąd:', error);
    await messageSender.send(jid, tpl.aiErrorMessage());
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

function getPhoneFromJid(jid: string): string {
  return jid.replace('@s.whatsapp.net', '').replace('@lid', '');
}
