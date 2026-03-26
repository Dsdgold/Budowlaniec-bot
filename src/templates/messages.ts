/**
 * Szablony wiadomości Telegram — ZERO tokenów AI
 * Wszystkie stałe odpowiedzi bota są tutaj, formatowane z danych z bazy
 * Telegram wspiera Markdown: *bold*, _italic_, `code`, [link](url)
 *
 * v2.1 — ulepszone formatowanie + nowe szablony
 */
import { KATEGORIE, KATEGORIE_LABELS, REGIONY, Kategoria, SELLERS } from '../config';

// ─── UTILS ───────────────────────────────────────────────

const SEP = '─────────────────────';
const SEP_LIGHT = '┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄';

/** Sparkline ASCII z tablicy wartości */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const chars = '▁▂▃▄▅▆▇█';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v) => chars[Math.round(((v - min) / range) * (chars.length - 1))]).join('');
}

/** Strzałka trendu */
function trendArrow(changePercent: number): string {
  if (changePercent > 5) return '🔺';
  if (changePercent > 0) return '📈';
  if (changePercent < -5) return '🔻';
  if (changePercent < 0) return '📉';
  return '➡️';
}

/** Nazwa sklepu po ludzku */
function sellerName(slug: string): string {
  return (SELLERS as Record<string, { name: string }>)[slug]?.name || slug;
}

// ─── ONBOARDING ──────────────────────────────────────────

export function welcomeMessage(): string {
  return `🏗️ *Witaj w Budowlaniec Bot!*
${SEP}

Monitoruję ceny materiałów budowlanych i newsy branżowe w Polsce.

*Co potrafię:*
📊 Śledzę ceny w Castoramie, Leroy Merlin, 3W, Bechcicki
📰 Zbieram newsy ze źródeł branżowych
📈 Wysyłam codzienne raporty cenowe
📉 Śledzę trendy i alerty cenowe

*Wybierz kategorie, które Cię interesują:*
${KATEGORIE.map((k, i) => `${i + 1}. ${KATEGORIE_LABELS[k]}`).join('\n')}

Wyślij numery oddzielone przecinkami, np.: *1,3,5*
Lub wpisz */pomoc* żeby zobaczyć komendy.`;
}

export function categorySelectedMessage(categories: Kategoria[]): string {
  const list = categories.map((c) => `  ✅ ${KATEGORIE_LABELS[c]}`).join('\n');
  return `✅ *Zapisałem Twoje preferencje:*
${SEP}

${list}

Będziesz dostawać codzienne raporty o 7:00 i 18:00.
Wpisz */pomoc* żeby zobaczyć dostępne komendy.`;
}

// ─── POMOC ───────────────────────────────────────────────

export function helpMessage(): string {
  return `📋 *Komendy Budowlaniec Bot:*
${SEP}

📊 */ceny* — podsumowanie cen Twoich kategorii
📊 */ceny [kategoria]* — ceny w kategorii
🔍 */porownaj [produkt]* — porównaj ceny w sklepach
📉 */trend [kategoria]* — trend cenowy (7/30 dni)
🏆 */ranking* — top spadki, promocje, sklepy
🔔 */alert [produkt] [cena]* — alert cenowy
📋 */raport* — generuj raport na żądanie
${SEP_LIGHT}
📰 */newsy* — najnowsze newsy budowlane
🤖 */pytaj [treść]* — zadaj pytanie AI
⚙️ */ustawienia* — zarządzaj preferencjami
⭐ */pro* — informacje o koncie PRO
❓ */pomoc* — ta wiadomość
${SEP_LIGHT}
💡 _Możesz też użyć @Budowlaniec\\_bot w dowolnym czacie_`;
}

// ─── CENY ────────────────────────────────────────────────

export interface PriceStats {
  total_products: number;
  avg_price: number | string;
  min_price: number | string;
  max_price: number | string;
  promo_count: number;
}

export interface PriceChange {
  product_name: string;
  prev_price: number | string;
  current_price: number | string;
  change_percent: number | string;
  seller_slug: string;
}

export interface PriceEntry {
  name: string;
  price: number | string;
  is_promo: boolean;
  seller_slug: string;
}

export function priceDetailMessage(
  category: Kategoria,
  stats: PriceStats | null,
  changes: PriceChange[],
  prices: PriceEntry[]
): string {
  let msg = `📊 *Ceny: ${KATEGORIE_LABELS[category]}*\n${SEP}\n\n`;

  if (stats && stats.total_products > 0) {
    msg += `📦 Produktów: *${stats.total_products}*\n`;
    msg += `💰 Śr.: *${stats.avg_price} zł*  ┃  Min: *${stats.min_price} zł*  ┃  Max: *${stats.max_price} zł*\n`;
    if (stats.promo_count > 0) msg += `🏷️ Promocji: *${stats.promo_count}*\n`;
    msg += '\n';
  }

  if (changes.length > 0) {
    msg += `${SEP_LIGHT}\n*Zmiany cen (24h):*\n\n`;
    for (const c of changes.slice(0, 10)) {
      const pct = Number(c.change_percent);
      const arrow = trendArrow(pct);
      msg += `${arrow} \`${c.product_name}\`\n    ${c.prev_price} → *${c.current_price} zł* (${pct > 0 ? '+' : ''}${c.change_percent}%) _${sellerName(c.seller_slug)}_\n`;
    }
    msg += '\n';
  }

  if (prices.length > 0) {
    msg += `${SEP_LIGHT}\n*Najnowsze ceny:*\n\n`;
    for (const p of prices.slice(0, 10)) {
      const promo = p.is_promo ? ' 🏷️' : '';
      msg += `• ${p.name}\n  *${p.price} zł*${promo}  ┃  _${sellerName(p.seller_slug)}_\n`;
    }
  } else {
    msg += `\n_Brak danych cenowych. Aktualizacja przy następnym scrapingu._`;
  }

  return msg;
}

export function priceSummaryMessage(
  categories: { slug: Kategoria; stats: PriceStats | null; changesCount: number }[]
): string {
  let msg = `📊 *Podsumowanie cen — Twoje kategorie:*\n${SEP}\n\n`;

  for (const cat of categories) {
    msg += `*${KATEGORIE_LABELS[cat.slug]}*\n`;
    if (cat.stats && cat.stats.total_products > 0) {
      msg += `  📦 ${cat.stats.total_products} prod.  ┃  Śr.: *${cat.stats.avg_price} zł*\n`;
    }
    if (cat.changesCount > 0) {
      msg += `  📉 Zmian cen: *${cat.changesCount}* (24h)\n`;
    }
    msg += '\n';
  }

  msg += `${SEP_LIGHT}\nSzczegóły: */ceny [kategoria]*`;
  return msg;
}

export function noCategoriesMessage(): string {
  return `Nie masz ustawionych kategorii. Użyj */start* żeby wybrać\nlub */ceny [kategoria]* np. */ceny cement*`;
}

export function categoryNotFoundMessage(q: string): string {
  return `❌ Nie znalazłem kategorii "${q}".\n\nDostępne:\n${KATEGORIE.map((k) => `• ${KATEGORIE_LABELS[k]} → /ceny ${k}`).join('\n')}`;
}

// ─── PORÓWNANIE ──────────────────────────────────────────

export function compareResultMessage(productName: string, results: PriceEntry[]): string {
  let msg = `🔍 *Porównanie cen: "${productName}"*\n${SEP}\n\n`;
  let i = 1;
  for (const p of results.slice(0, 15)) {
    const promo = p.is_promo ? ' 🏷️' : '';
    const medal = i === 1 ? '🥇' : i === 2 ? '🥈' : i === 3 ? '🥉' : `${i}.`;
    msg += `${medal} *${p.price} zł*${promo}\n   ${p.name}\n   📍 _${sellerName(p.seller_slug)}_\n\n`;
    i++;
  }
  return msg;
}

export function compareNoResultsMessage(productName: string): string {
  return `🔍 Nie znalazłem "${productName}" w bazie. Spróbuj innej frazy.`;
}

export function compareUsageMessage(): string {
  return `Użyj: */porownaj [nazwa produktu]*\nNp.: /porownaj cement portlandzki`;
}

// ─── TREND ───────────────────────────────────────────────

export interface TrendData {
  date: string;
  avg_price: number;
  product_count: number;
}

export function trendMessage(
  category: Kategoria,
  data7d: TrendData[],
  data30d: TrendData[],
): string {
  if (data30d.length < 2) {
    return `📉 *Trend: ${KATEGORIE_LABELS[category]}*\n${SEP}\n\n_Za mało danych do analizy trendu. Potrzebuję co najmniej 2 dni danych._`;
  }

  const prices30d = data30d.map((d) => Number(d.avg_price));
  const prices7d = data7d.map((d) => Number(d.avg_price));

  const change30d = prices30d.length >= 2
    ? ((prices30d[prices30d.length - 1] - prices30d[0]) / prices30d[0] * 100)
    : 0;
  const change7d = prices7d.length >= 2
    ? ((prices7d[prices7d.length - 1] - prices7d[0]) / prices7d[0] * 100)
    : 0;

  const current = prices30d[prices30d.length - 1];
  const spark30 = sparkline(prices30d);
  const spark7 = prices7d.length >= 2 ? sparkline(prices7d) : '—';

  let msg = `📉 *Trend: ${KATEGORIE_LABELS[category]}*\n${SEP}\n\n`;
  msg += `💰 Aktualna śr. cena: *${current.toFixed(2)} zł*\n\n`;

  msg += `*Ostatnie 7 dni:*\n`;
  msg += `${spark7}\n`;
  msg += `${trendArrow(change7d)} Zmiana: *${change7d > 0 ? '+' : ''}${change7d.toFixed(2)}%*\n\n`;

  msg += `*Ostatnie 30 dni:*\n`;
  msg += `${spark30}\n`;
  msg += `${trendArrow(change30d)} Zmiana: *${change30d > 0 ? '+' : ''}${change30d.toFixed(2)}%*\n\n`;

  msg += `${SEP_LIGHT}\n`;
  msg += `📅 Okres: ${data30d[0].date} — ${data30d[data30d.length - 1].date}\n`;
  msg += `📦 Produktów: ${data30d[data30d.length - 1].product_count}`;

  return msg;
}

// ─── ALERT ───────────────────────────────────────────────

export function alertCreatedMessage(keyword: string, targetPrice: number): string {
  return `🔔 *Alert cenowy ustawiony!*
${SEP}

🔍 Produkt: *${keyword}*
💰 Powiadomię Cię gdy cena spadnie poniżej: *${targetPrice} zł*

Sprawdzam po każdym scrapingu cen.
Twoje alerty: */alert lista*
Usuń alert: */alert usun [produkt]*`;
}

export function alertListMessage(
  alerts: { keyword: string; target_price: number; created_at: Date }[]
): string {
  if (alerts.length === 0) {
    return `🔔 *Twoje alerty cenowe*\n${SEP}\n\n_Brak aktywnych alertów._\n\nUstaw alert: */alert [produkt] [cena]*\nNp.: /alert cement 25`;
  }

  let msg = `🔔 *Twoje alerty cenowe*\n${SEP}\n\n`;
  for (const a of alerts) {
    const date = new Date(a.created_at).toLocaleDateString('pl-PL');
    msg += `• *${a.keyword}* — poniżej *${a.target_price} zł*\n  _Ustawiono: ${date}_\n`;
  }
  msg += `\n${SEP_LIGHT}\nUsuń: */alert usun [produkt]*`;
  return msg;
}

export function alertDeletedMessage(keyword: string): string {
  return `✅ Alert dla "*${keyword}*" został usunięty.`;
}

export function alertNotFoundMessage(keyword: string): string {
  return `❌ Nie znalazłem aktywnego alertu dla "${keyword}".`;
}

export function alertUsageMessage(): string {
  return `🔔 *Alert cenowy*\n${SEP}\n\nUstaw: */alert [produkt] [cena]*\nNp.: /alert cement 25\n\nLista: */alert lista*\nUsuń: */alert usun [produkt]*`;
}

export function alertTriggeredMessage(
  keyword: string,
  targetPrice: number,
  currentPrice: number,
  productName: string,
  sellerSlug: string,
): string {
  return `🔔 *Alert cenowy!*
${SEP}

🔍 Szukane: *${keyword}*
📦 Produkt: ${productName}
🏪 Sklep: _${sellerName(sellerSlug)}_

💰 Cena docelowa: ${targetPrice} zł
✅ Aktualna cena: *${currentPrice} zł*

_Cena spadła poniżej Twojego progu!_`;
}

// ─── RAPORT NA ŻĄDANIE ──────────────────────────────────

export function onDemandReportMessage(
  categories: { slug: Kategoria; stats: PriceStats | null; changes: PriceChange[] }[],
  articles: { title: string; summary: string | null; source_name: string }[],
): string {
  const date = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });

  let msg = `📋 *Raport na żądanie*\n📅 ${date}\n${SEP}\n\n`;

  // Sekcja cen
  msg += `*💰 CENY*\n\n`;
  for (const cat of categories) {
    msg += `*${KATEGORIE_LABELS[cat.slug]}*\n`;
    if (cat.stats && cat.stats.total_products > 0) {
      msg += `  📦 ${cat.stats.total_products} prod.  ┃  Śr.: *${cat.stats.avg_price} zł*\n`;
      if (cat.stats.promo_count > 0) {
        msg += `  🏷️ Promocji: ${cat.stats.promo_count}\n`;
      }
    }
    if (cat.changes.length > 0) {
      for (const c of cat.changes.slice(0, 3)) {
        const pct = Number(c.change_percent);
        msg += `  ${trendArrow(pct)} ${c.product_name}: ${c.prev_price} → *${c.current_price} zł* (${pct > 0 ? '+' : ''}${pct}%)\n`;
      }
    }
    msg += '\n';
  }

  // Sekcja newsów
  if (articles.length > 0) {
    msg += `${SEP}\n*📰 NEWSY*\n\n`;
    for (const a of articles.slice(0, 5)) {
      msg += `📌 *${a.title}*\n`;
      if (a.summary) msg += `   ${a.summary}\n`;
      msg += `   _${a.source_name}_\n\n`;
    }
  }

  msg += `${SEP_LIGHT}\n_Wygenerowano na żądanie. Automatyczne raporty: 7:00 i 18:00_`;
  return msg;
}

// ─── RANKING ─────────────────────────────────────────────

export interface RankingDrop {
  product_name: string;
  seller_slug: string;
  prev_price: number;
  current_price: number;
  change_percent: number;
}

export interface RankingPromo {
  product_name: string;
  seller_slug: string;
  price: number;
  original_price: number;
  discount_percent: number;
}

export interface SellerRanking {
  seller_slug: string;
  avg_price: number;
  product_count: number;
  promo_count: number;
}

export function rankingMessage(
  drops: RankingDrop[],
  promos: RankingPromo[],
  sellers: SellerRanking[],
): string {
  let msg = `🏆 *Ranking — podsumowanie*\n${SEP}\n\n`;

  // Top spadki
  msg += `*📉 Top spadki cen (24h):*\n\n`;
  if (drops.length === 0) {
    msg += `_Brak spadków w ostatnich 24h._\n\n`;
  } else {
    let i = 1;
    for (const d of drops.slice(0, 10)) {
      const medal = i <= 3 ? ['🥇', '🥈', '🥉'][i - 1] : `${i}.`;
      msg += `${medal} \`${d.product_name}\`\n   ${d.prev_price} → *${d.current_price} zł* (*${d.change_percent}%*) _${sellerName(d.seller_slug)}_\n`;
      i++;
    }
    msg += '\n';
  }

  // Top promocje
  msg += `${SEP_LIGHT}\n*🏷️ Najlepsze promocje:*\n\n`;
  if (promos.length === 0) {
    msg += `_Brak aktywnych promocji._\n\n`;
  } else {
    let i = 1;
    for (const p of promos.slice(0, 10)) {
      const medal = i <= 3 ? ['🥇', '🥈', '🥉'][i - 1] : `${i}.`;
      msg += `${medal} \`${p.product_name}\`\n   ~~${p.original_price} zł~~ → *${p.price} zł* (*-${p.discount_percent}%*) _${sellerName(p.seller_slug)}_\n`;
      i++;
    }
    msg += '\n';
  }

  // Ranking sklepów
  msg += `${SEP_LIGHT}\n*🏪 Ranking sklepów (śr. cena):*\n\n`;
  if (sellers.length === 0) {
    msg += `_Brak danych._\n`;
  } else {
    let i = 1;
    for (const s of sellers) {
      const medal = i <= 3 ? ['🥇', '🥈', '🥉'][i - 1] : `${i}.`;
      msg += `${medal} *${sellerName(s.seller_slug)}*\n   Śr.: *${s.avg_price} zł*  ┃  ${s.product_count} prod.  ┃  🏷️ ${s.promo_count}\n`;
      i++;
    }
  }

  return msg;
}

// ─── NEWSY ───────────────────────────────────────────────

export interface NewsEntry {
  title: string;
  summary: string | null;
  url: string;
  source_name: string;
  published_at: Date | null;
}

export function newsMessage(articles: NewsEntry[]): string {
  if (articles.length === 0) {
    return `📰 *Brak nowych newsów*\n${SEP}\n\n_Brak nowych newsów z ostatnich 24h. Sprawdź ponownie później!_`;
  }

  let msg = `📰 *Najnowsze newsy budowlane:*\n${SEP}\n\n`;
  for (const a of articles) {
    const date = a.published_at ? new Date(a.published_at).toLocaleDateString('pl-PL') : '';
    msg += `📌 *${a.title}*\n`;
    if (a.summary) msg += `   ${a.summary}\n`;
    msg += `   🔗 ${a.url}\n`;
    msg += `   📅 ${date}  ┃  📡 _${a.source_name}_\n\n`;
  }
  return msg;
}

// ─── USTAWIENIA ──────────────────────────────────────────

export function settingsMessage(categories: Kategoria[], region?: string): string {
  const catText = categories.length > 0
    ? categories.map((c) => `  ✅ ${KATEGORIE_LABELS[c]}`).join('\n')
    : '  _Brak wybranych kategorii_';

  return `⚙️ *Twoje ustawienia:*
${SEP}

*Kategorie:*
${catText}
${region ? `\n*Region:* ${region}` : ''}

${SEP_LIGHT}
• /ustawienia kategorie — zmień kategorie
• /ustawienia region [nazwa] — zmień region
• /ustawienia raport [HH:MM] — zmień godzinę raportu`;
}

export function regionListMessage(): string {
  return `🌍 *Dostępne regiony:*\n${SEP}\n\n${REGIONY.map((r) => `• ${r}`).join('\n')}\n\nUżyj: /ustawienia region [nazwa]`;
}

export function regionChangedMessage(region: string): string {
  return `✅ Region zmieniony na: *${region}*`;
}

export function reportTimeChangedMessage(time: string): string {
  return `✅ Godzina raportu zmieniona na: *${time}*`;
}

export function categorySelectionPrompt(): string {
  return `Wybierz kategorie (podaj numery oddzielone przecinkami):\n\n${KATEGORIE.map((k, i) => `${i + 1}. ${KATEGORIE_LABELS[k]}`).join('\n')}`;
}

// ─── PRO ─────────────────────────────────────────────────

export function proActiveMessage(expiresAt: string): string {
  return `⭐ *Twoje konto PRO*
${SEP}

Status: ✅ Aktywne
Ważne do: *${expiresAt}*

*Korzyści PRO:*
• Raporty co godzinę
• Alerty cenowe w czasie rzeczywistym
• Porównania cen między sklepami
• 20 pytań AI dziennie (zamiast 5)
• Eksport danych do CSV`;
}

export function proOfferMessage(): string {
  return `⭐ *Konto PRO*
${SEP}

Odblokuj pełne możliwości bota!

*Korzyści PRO:*
• Raporty co godzinę
• Alerty cenowe w czasie rzeczywistym
• Porównania cen między sklepami
• 20 pytań AI dziennie (zamiast 5)
• Eksport danych do CSV

*Cena: 49 zł/mies.*

Aby aktywować, skontaktuj się z nami lub dokonaj płatności BLIK.`;
}

// ─── AI / PYTAJ ──────────────────────────────────────────

export function aiLimitReachedMessage(limit: number, isPro: boolean): string {
  if (isPro) {
    return `🤖 Wykorzystałeś dzienny limit *${limit}* pytań AI (PRO). Odnawiany o północy.\n\nUżyj komend */ceny* i */newsy* — działają bez limitu!`;
  }
  return `🤖 Wykorzystałeś dzienny limit *${limit}* pytań AI.\n\nChcesz więcej? Przejdź na */pro* (20 pytań/dzień).\nKomendy */ceny*, */newsy*, */porownaj* działają bez limitu!`;
}

export function aiUsageMessage(): string {
  return `🤖 *Pytaj AI*\n${SEP}\n\nUżyj: */pytaj [treść pytania]*\nNp.: /pytaj Czy ceny stali idą w górę?`;
}

export function aiErrorMessage(): string {
  return `😔 Nie udało się przetworzyć pytania. Spróbuj ponownie lub użyj */ceny*, */newsy*, */pomoc*.`;
}

// ─── OGÓLNE ──────────────────────────────────────────────

export function unknownCommandMessage(): string {
  return `Nie rozpoznaję tej komendy. Wpisz */pomoc* żeby zobaczyć listę komend.\n\nChcesz zadać pytanie AI? Użyj */pytaj [treść]*`;
}

export function genericErrorMessage(): string {
  return `😔 Wystąpił błąd. Spróbuj ponownie za chwilę lub użyj */pomoc*.`;
}
