/**
 * Skrypt migracji bazy danych
 * Uruchomienie: ts-node src/db/migrate.ts
 */
import fs from 'fs';
import path from 'path';
import { pool } from './client';
import logger from '../utils/logger';

async function runMigrations(): Promise<void> {
  logger.info('🔄 Rozpoczynam migracje bazy danych...');

  // Tabela śledzenia migracji
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Pobierz listę wykonanych migracji
  const executed = await pool.query('SELECT filename FROM migrations ORDER BY id');
  const executedFiles = new Set(executed.rows.map((r: any) => r.filename));

  // Pobierz pliki migracji
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let migrationsRun = 0;

  for (const file of files) {
    if (executedFiles.has(file)) {
      logger.debug(`⏭️  Pominięto (już wykonana): ${file}`);
      continue;
    }

    logger.info(`▶️  Wykonuję migrację: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      migrationsRun++;
      logger.info(`✅ Migracja zakończona: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`❌ Błąd migracji ${file}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  if (migrationsRun === 0) {
    logger.info('✅ Baza danych jest aktualna - brak nowych migracji');
  } else {
    logger.info(`✅ Wykonano ${migrationsRun} migracji`);
  }
}

// Uruchomienie jako skrypt
runMigrations()
  .then(() => {
    logger.info('🏁 Migracje zakończone');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('💥 Migracje nie powiodły się:', err);
    process.exit(1);
  });
