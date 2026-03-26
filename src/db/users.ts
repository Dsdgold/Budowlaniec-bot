/**
 * Operacje CRUD na użytkownikach i ich preferencjach
 */
import { query, transaction } from './client';
import { Kategoria, Region } from '../config';
import logger from '../utils/logger';

/** Typ użytkownika z bazy */
export interface User {
  id: string;
  phone: string;
  name: string | null;
  is_pro: boolean;
  pro_expires_at: Date | null;
  region: Region;
  is_active: boolean;
  onboarding_complete: boolean;
  daily_report_time: string;
  ai_queries_today: number;
  ai_queries_reset_date: string;
  created_at: Date;
  updated_at: Date;
}

/** Preferencja kategorii użytkownika */
export interface UserPreference {
  id: string;
  user_id: string;
  category_slug: Kategoria;
  notify_on_change: boolean;
  price_drop_threshold: number;
}

/**
 * Znajdź użytkownika po numerze telefonu
 */
export async function findUserByPhone(phone: string): Promise<User | null> {
  const rows = await query<User>(
    'SELECT * FROM users WHERE phone = $1',
    [phone]
  );
  return rows[0] || null;
}

/**
 * Utwórz nowego użytkownika (przy pierwszym kontakcie)
 */
export async function createUser(phone: string, name?: string): Promise<User> {
  const rows = await query<User>(
    `INSERT INTO users (phone, name)
     VALUES ($1, $2)
     ON CONFLICT (phone) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [phone, name || null]
  );
  logger.info(`👤 Nowy użytkownik: ${phone}`);
  return rows[0];
}

/**
 * Aktualizuj region użytkownika
 */
export async function updateUserRegion(userId: string, region: Region): Promise<void> {
  await query('UPDATE users SET region = $1 WHERE id = $2', [region, userId]);
}

/**
 * Oznacz onboarding jako ukończony
 */
export async function completeOnboarding(userId: string): Promise<void> {
  await query('UPDATE users SET onboarding_complete = TRUE WHERE id = $1', [userId]);
}

/**
 * Aktywuj PRO na określoną liczbę miesięcy
 */
export async function activatePro(userId: string, months: number): Promise<void> {
  await query(
    `UPDATE users SET
       is_pro = TRUE,
       pro_expires_at = NOW() + INTERVAL '1 month' * $1
     WHERE id = $2`,
    [months, userId]
  );
  logger.info(`⭐ PRO aktywowane dla użytkownika ${userId} na ${months} mies.`);
}

/**
 * Pobierz preferencje kategorii użytkownika
 */
export async function getUserPreferences(userId: string): Promise<UserPreference[]> {
  return query<UserPreference>(
    'SELECT * FROM user_preferences WHERE user_id = $1',
    [userId]
  );
}

/**
 * Ustaw preferencje kategorii użytkownika (zamień istniejące)
 */
export async function setUserPreferences(
  userId: string,
  categories: Kategoria[]
): Promise<void> {
  await transaction(async (client) => {
    // Usuń stare preferencje
    await client.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);

    // Wstaw nowe
    for (const cat of categories) {
      await client.query(
        `INSERT INTO user_preferences (user_id, category_slug)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, cat]
      );
    }
  });
  logger.info(`📋 Zaktualizowano preferencje użytkownika ${userId}: ${categories.join(', ')}`);
}

/**
 * Pobierz wszystkich aktywnych użytkowników z preferencjami (do raportów)
 */
export async function getActiveUsersWithPreferences(): Promise<
  (User & { categories: Kategoria[] })[]
> {
  const users = await query<User>(
    'SELECT * FROM users WHERE is_active = TRUE AND onboarding_complete = TRUE'
  );

  const result = [];
  for (const user of users) {
    const prefs = await getUserPreferences(user.id);
    result.push({
      ...user,
      categories: prefs.map((p) => p.category_slug),
    });
  }
  return result;
}

/**
 * Aktualizuj godzinę dziennego raportu
 */
export async function updateReportTime(userId: string, time: string): Promise<void> {
  await query('UPDATE users SET daily_report_time = $1 WHERE id = $2', [time, userId]);
}

/**
 * Sprawdź i dezaktywuj wygasłe konta PRO
 */
export async function deactivateExpiredPro(): Promise<number> {
  const rows = await query(
    `UPDATE users SET is_pro = FALSE
     WHERE is_pro = TRUE AND pro_expires_at < NOW()
     RETURNING id`
  );
  if (rows.length > 0) {
    logger.info(`⏰ Dezaktywowano PRO dla ${rows.length} użytkowników`);
  }
  return rows.length;
}

/**
 * Sprawdź limit dzienny pytań AI i zinkrementuj jeśli dozwolone
 * Automatycznie resetuje licznik gdy zmieni się data
 * Zwraca true jeśli pytanie dozwolone, false jeśli limit wyczerpany
 */
export async function checkAndIncrementAiQueries(
  userId: string,
  dailyLimit: number
): Promise<boolean> {
  // Resetuj licznik jeśli nowy dzień, potem sprawdź limit
  const rows = await query<{ ai_queries_today: number }>(
    `UPDATE users SET
       ai_queries_today = CASE
         WHEN ai_queries_reset_date < CURRENT_DATE THEN 1
         WHEN ai_queries_today < $2 THEN ai_queries_today + 1
         ELSE ai_queries_today
       END,
       ai_queries_reset_date = CURRENT_DATE
     WHERE id = $1
     RETURNING ai_queries_today`,
    [userId, dailyLimit]
  );

  if (rows.length === 0) return false;

  const current = rows[0].ai_queries_today;
  const allowed = current <= dailyLimit;

  if (!allowed) {
    logger.info(`🚫 [AI Limit] Użytkownik ${userId} wyczerpał limit (${current}/${dailyLimit})`);
  } else {
    logger.debug(`🤖 [AI Limit] Użytkownik ${userId}: ${current}/${dailyLimit} pytań`);
  }

  return allowed;
}

/**
 * Statystyki użytkowników do dashboardu / API
 */
export async function getUserStats(): Promise<{
  total: number;
  pro: number;
  active_today: number;
}> {
  const rows = await query<{ total: string; pro: string; active_today: string }>(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN is_pro THEN 1 ELSE 0 END) AS pro,
       SUM(CASE WHEN updated_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END) AS active_today
     FROM users
     WHERE is_active = TRUE`
  );
  const r = rows[0];
  return {
    total: parseInt(r.total) || 0,
    pro: parseInt(r.pro) || 0,
    active_today: parseInt(r.active_today) || 0,
  };
}

/**
 * Resetuj liczniki AI dla wszystkich użytkowników (cron o północy)
 */
export async function resetDailyAiQueries(): Promise<void> {
  await query(
    `UPDATE users SET ai_queries_today = 0, ai_queries_reset_date = CURRENT_DATE
     WHERE ai_queries_today > 0`
  );
  logger.info('🔄 Zresetowano dzienne limity AI');
}
