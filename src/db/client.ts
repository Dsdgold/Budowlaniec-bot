/**
 * Klient bazy danych PostgreSQL
 * Konfiguracja puli połączeń z obsługą reconnect
 */
import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import logger from '../utils/logger';

/** Pula połączeń PostgreSQL */
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20, // Maksymalna liczba połączeń w puli
  idleTimeoutMillis: 30_000, // Zamknij nieaktywne po 30s
  connectionTimeoutMillis: 10_000, // Timeout połączenia 10s
});

// Logowanie zdarzeń puli
pool.on('connect', () => {
  logger.debug('🔌 Nowe połączenie z bazą danych');
});

pool.on('error', (err) => {
  logger.error('❌ Błąd puli połączeń PostgreSQL:', err);
});

/**
 * Wykonanie zapytania SQL z automatycznym zarządzaniem połączeniem
 */
export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`📊 Query (${duration}ms): ${text.substring(0, 80)}...`);
    return result.rows as T[];
  } catch (error) {
    logger.error(`❌ Błąd zapytania SQL: ${text}`, error);
    throw error;
  }
}

/**
 * Wykonanie transakcji z automatycznym rollback przy błędzie
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Rollback transakcji:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Sprawdzenie połączenia z bazą danych
 */
export async function checkConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    logger.info('✅ Połączenie z bazą danych OK');
    return true;
  } catch (error) {
    logger.error('❌ Brak połączenia z bazą danych:', error);
    return false;
  }
}

/**
 * Zamknięcie puli połączeń (przy wyłączaniu aplikacji)
 */
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('🔌 Pula połączeń zamknięta');
}
