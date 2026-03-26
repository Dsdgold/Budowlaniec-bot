/**
 * Klawiatury Telegram — inline i reply keyboards
 * Zamiast wpisywania komend użytkownik klika przyciski
 *
 * v2.1 — nowe przyciski: trend, ranking, raport, alert
 */
import { Markup } from 'telegraf';
import { KATEGORIE, KATEGORIE_LABELS, Kategoria } from '../config';

// === MENU GŁÓWNE (Reply Keyboard — widoczne na dole ekranu) ===

/** URL Mini App — nadpisywany zmienną środowiskową WEBAPP_URL */
const webAppUrl = process.env.WEBAPP_URL || 'https://localhost:3000/webapp';

/** Główna klawiatura z przyciskami menu */
export const mainMenuKeyboard = Markup.keyboard([
  [Markup.button.webApp('🚀 Otwórz aplikację', webAppUrl)],
  ['📊 Ceny', '📰 Newsy'],
  ['📉 Trend', '🏆 Ranking'],
  ['📋 Raport', '🔔 Alert'],
  ['⚙️ Ustawienia', '🤖 Pytaj AI'],
  ['⭐ PRO', '❓ Pomoc'],
]).resize();

// === INLINE KEYBOARDS (przyciski w wiadomościach) ===

/**
 * Klawiatura wyboru kategorii z checkboxami
 * Każdy przycisk to callback_query z prefixem 'cat:'
 */
export function categorySelectionKeyboard(
  selectedCategories: Kategoria[] = []
): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons = KATEGORIE.map((slug) => {
    const isSelected = selectedCategories.includes(slug);
    const emoji = isSelected ? '✅' : '⬜';
    const label = KATEGORIE_LABELS[slug];
    return [Markup.button.callback(`${emoji} ${label}`, `cat:${slug}`)];
  });

  // Przycisk potwierdzenia na dole
  buttons.push([
    Markup.button.callback('💾 Zapisz wybór', 'cat:save'),
  ]);

  return Markup.inlineKeyboard(buttons);
}

/**
 * Klawiatura wyboru kategorii do przeglądania cen
 * Każdy przycisk to callback_query z prefixem 'price:'
 */
export function priceCategoryKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons = KATEGORIE.map((slug) => {
    return [Markup.button.callback(KATEGORIE_LABELS[slug], `price:${slug}`)];
  });
  return Markup.inlineKeyboard(buttons);
}

/**
 * Klawiatura wyboru kategorii do trendu
 * Każdy przycisk to callback_query z prefixem 'trend:'
 */
export function trendCategoryKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  const buttons = KATEGORIE.map((slug) => {
    return [Markup.button.callback(`📉 ${KATEGORIE_LABELS[slug]}`, `trend:${slug}`)];
  });
  return Markup.inlineKeyboard(buttons);
}

/**
 * Klawiatura ustawień
 */
export function settingsKeyboard(): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [Markup.button.callback('📋 Zmień kategorie', 'settings:categories')],
    [Markup.button.callback('🌍 Zmień region', 'settings:region')],
    [Markup.button.callback('⏰ Zmień godzinę raportu', 'settings:report_time')],
  ]);
}

/**
 * Klawiatura potwierdzenia
 */
export function confirmKeyboard(
  yesCallback: string,
  noCallback: string
): ReturnType<typeof Markup.inlineKeyboard> {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Tak', yesCallback),
      Markup.button.callback('❌ Nie', noCallback),
    ],
  ]);
}
