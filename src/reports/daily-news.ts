/**
 * Generator dziennych raportów newsowych
 * Tworzy przegląd najważniejszych wiadomości z branży budowlanej
 * Wysyła przez Telegram
 */
import { getActiveUsersWithPreferences } from '../db/users';
import { getSummarizedArticles, getLatestArticles } from '../db/news';
import { generateDailyDigest } from '../news/summarizer';
import { messageSender } from '../telegram/sender';
import logger from '../utils/logger';

/**
 * Wygeneruj i wyślij dzienny przegląd newsów do wszystkich użytkowników
 */
export async function sendDailyNewsReports(): Promise<void> {
  logger.info('📰 Generuję dzienne raporty newsowe...');

  // Pobierz artykuły z ostatnich 24h
  const articles = await getSummarizedArticles(24, 10);

  if (articles.length === 0) {
    logger.info('📰 Brak nowych artykułów — pomijam raporty newsowe');
    return;
  }

  // Wygeneruj wspólny digest AI
  const allArticles = await getLatestArticles(24, 15);
  const digest = await generateDailyDigest(allArticles);

  // Przygotuj treść raportu
  const date = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  let report = `📰 *Przegląd rynku budowlanego — ${date}*\n\n`;
  report += digest;
  report += '\n\n';
  report += `*📌 Najważniejsze artykuły:*\n\n`;

  for (const article of articles.slice(0, 5)) {
    report += `• *${article.title}*\n`;
    if (article.summary) {
      report += `  ${article.summary}\n`;
    }
    report += `  🔗 ${article.url}\n`;
    report += `  📡 ${article.source_name}\n\n`;
  }

  if (articles.length > 5) {
    report += `...i ${articles.length - 5} więcej artykułów. Użyj /newsy żeby zobaczyć wszystkie.\n`;
  }

  // Pobierz użytkowników i wyślij
  const users = await getActiveUsersWithPreferences();

  if (users.length === 0) {
    logger.info('📰 Brak aktywnych użytkowników');
    return;
  }

  // Telegram — chatId to phone (zapisany w bazie jako identyfikator)
  const messages = users.map((user) => ({
    chatId: user.phone,
    text: report,
  }));

  const result = await messageSender.sendBatch(messages);
  logger.info(`📰 Raporty newsowe wysłane: ${result.sent}/${messages.length}`);
}
