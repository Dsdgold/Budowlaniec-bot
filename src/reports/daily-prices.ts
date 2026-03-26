/**
 * Generator dziennych raportów cenowych
 * Tworzy spersonalizowane raporty na podstawie preferencji użytkownika
 * Wysyła przez Telegram
 */
import { getActiveUsersWithPreferences, User } from '../db/users';
import { getPriceChanges24h, getCategoryStats, getTriggeredAlerts, markAlertTriggered } from '../db/prices';
import { KATEGORIE_LABELS, Kategoria } from '../config';
import { messageSender } from '../telegram/sender';
import logger from '../utils/logger';

/**
 * Wygeneruj raport cenowy dla jednego użytkownika
 */
async function generateUserPriceReport(
  user: User & { categories: Kategoria[] }
): Promise<string> {
  const date = new Date().toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  let report = `📊 *Raport cenowy — ${date}*\n\n`;
  let hasChanges = false;

  for (const category of user.categories) {
    const changes = await getPriceChanges24h(category);
    const stats = await getCategoryStats(category);

    report += `*${KATEGORIE_LABELS[category]}*\n`;

    if (stats && stats.total_products > 0) {
      report += `  Produktów: ${stats.total_products} | Śr.: ${stats.avg_price} zł\n`;

      if (stats.promo_count > 0) {
        report += `  🏷️ Promocji: ${stats.promo_count}\n`;
      }
    }

    if (changes.length > 0) {
      hasChanges = true;
      // Top 5 zmian cenowych
      const topChanges = changes.slice(0, 5);
      for (const change of topChanges) {
        const arrow = change.change_percent > 0 ? '📈' : '📉';
        const sign = change.change_percent > 0 ? '+' : '';
        report += `  ${arrow} ${change.product_name}: `;
        report += `${change.prev_price}→${change.current_price} zł `;
        report += `(${sign}${change.change_percent}%)\n`;
      }

      if (changes.length > 5) {
        report += `  ...i ${changes.length - 5} więcej zmian\n`;
      }
    } else {
      report += `  ✅ Brak zmian cenowych\n`;
    }
    report += '\n';
  }

  if (!hasChanges) {
    report += '✅ Brak istotnych zmian cenowych w Twoich kategoriach.\n\n';
  }

  report += `💬 Pytania? Użyj /ceny [kategoria] lub /pytaj`;

  return report;
}

/**
 * Wyślij dzienne raporty cenowe do wszystkich użytkowników
 */
export async function sendDailyPriceReports(): Promise<void> {
  logger.info('📊 Generuję dzienne raporty cenowe...');

  const users = await getActiveUsersWithPreferences();

  if (users.length === 0) {
    logger.info('📊 Brak aktywnych użytkowników do wysłania raportów');
    return;
  }

  logger.info(`📊 Wysyłam raporty do ${users.length} użytkowników`);

  const messages = [];

  for (const user of users) {
    if (user.categories.length === 0) continue;

    try {
      const report = await generateUserPriceReport(user);
      // Telegram — chatId to phone (zapisany w bazie jako identyfikator)
      messages.push({ chatId: user.phone, text: report });
    } catch (error) {
      logger.error(`❌ Błąd generowania raportu dla ${user.phone}:`, error);
    }
  }

  // Wyślij batch z rate limitingiem
  const result = await messageSender.sendBatch(messages);
  logger.info(`📊 Raporty cenowe wysłane: ${result.sent}/${messages.length}`);
}

/**
 * Sprawdź i wyślij alerty cenowe
 */
export async function checkAndSendPriceAlerts(): Promise<void> {
  logger.info('🔔 Sprawdzam alerty cenowe...');

  const alerts = await getTriggeredAlerts();

  if (alerts.length === 0) {
    logger.debug('🔔 Brak aktywnych alertów do wysłania');
    return;
  }

  logger.info(`🔔 Znaleziono ${alerts.length} alertów do wysłania`);

  for (const alert of alerts) {
    const message =
      `🔔 *Alert cenowy!*\n\n` +
      `Produkt: *${alert.product_name}*\n` +
      `Cena docelowa: ${alert.target_price} zł\n` +
      `Aktualna cena: *${alert.current_price} zł* ✅\n\n` +
      `Cena spadła poniżej Twojego progu!`;

    try {
      // Telegram — chatId to phone (zapisany w bazie)
      await messageSender.send(alert.user_phone, message);
      await markAlertTriggered(alert.alert_id);
    } catch (error) {
      logger.error(`❌ Błąd wysyłania alertu do ${alert.user_phone}:`, error);
    }
  }
}
