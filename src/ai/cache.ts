/**
 * Cache AI — minimalizacja kosztów tokenów
 * Warstwa 1: Redis (szybki, TTL 24h)
 * Warstwa 2: PostgreSQL (trwały, dla powtarzających się pytań)
 */
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { query } from '../db/client';
import { config } from '../config';
import logger from '../utils/logger';

let redis: Redis | null = null;

/** Inicjalizacja Redis (opcjonalna — działa też bez) */
export function initCache(): void {
  try {
    redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    redis.connect().catch((err) => {
      logger.warn(`⚠️ [Cache] Redis niedostępny, działam bez cache Redis: ${err.message}`);
      redis = null;
    });
  } catch {
    logger.warn('⚠️ [Cache] Nie udało się połączyć z Redis');
    redis = null;
  }
}

/** TTL cache w sekundach (24h) */
const CACHE_TTL = 86400;

/** Prefix dla kluczy Redis */
const REDIS_PREFIX = 'ai:cache:';

/**
 * Generuj hash pytania do użycia jako klucz cache
 * Normalizujemy tekst żeby podobne pytania trafiały w ten sam cache
 */
function hashQuery(text: string): string {
  const normalized = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?!.,;:]/g, '');
  return createHash('md5').update(normalized).digest('hex');
}

/**
 * Sprawdź cache — najpierw Redis, potem PostgreSQL
 */
export async function getCachedResponse(queryText: string): Promise<string | null> {
  const hash = hashQuery(queryText);

  // Warstwa 1: Redis
  if (redis) {
    try {
      const cached = await redis.get(`${REDIS_PREFIX}${hash}`);
      if (cached) {
        logger.debug(`✅ [Cache] Hit Redis: ${queryText.substring(0, 50)}...`);
        return cached;
      }
    } catch {
      // Redis niedostępny — kontynuuj
    }
  }

  // Warstwa 2: PostgreSQL
  try {
    const rows = await query<{ response: string }>(
      `SELECT response FROM ai_cache
       WHERE query_hash = $1
       AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [hash]
    );
    if (rows.length > 0) {
      logger.debug(`✅ [Cache] Hit PostgreSQL: ${queryText.substring(0, 50)}...`);
      // Zapisz też w Redis na szybki dostęp
      if (redis) {
        await redis.setex(`${REDIS_PREFIX}${hash}`, CACHE_TTL, rows[0].response).catch(() => {});
      }
      return rows[0].response;
    }
  } catch (err) {
    logger.warn(`⚠️ [Cache] Błąd odczytu z PostgreSQL: ${(err as Error).message}`);
  }

  return null;
}

/**
 * Zapisz odpowiedź AI w cache (obie warstwy)
 */
export async function setCachedResponse(queryText: string, response: string): Promise<void> {
  const hash = hashQuery(queryText);

  // Redis
  if (redis) {
    await redis.setex(`${REDIS_PREFIX}${hash}`, CACHE_TTL, response).catch(() => {});
  }

  // PostgreSQL
  try {
    await query(
      `INSERT INTO ai_cache (query_hash, query_text, response)
       VALUES ($1, $2, $3)
       ON CONFLICT (query_hash) DO UPDATE SET
         response = $3,
         hit_count = ai_cache.hit_count + 1,
         created_at = NOW()`,
      [hash, queryText.substring(0, 500), response]
    );
  } catch (err) {
    logger.warn(`⚠️ [Cache] Błąd zapisu do PostgreSQL: ${(err as Error).message}`);
  }
}

/**
 * Cache dla dziennego digestu newsów — generowany RAZ, używany przez WSZYSTKICH
 */
export async function getCachedDailyDigest(): Promise<string | null> {
  const today = new Date().toISOString().split('T')[0];
  const key = `daily_digest:${today}`;

  // Redis
  if (redis) {
    try {
      const cached = await redis.get(`${REDIS_PREFIX}${key}`);
      if (cached) return cached;
    } catch {}
  }

  // PostgreSQL
  try {
    const rows = await query<{ response: string }>(
      `SELECT response FROM ai_cache
       WHERE query_hash = $1
       AND created_at > NOW() - INTERVAL '20 hours'
       LIMIT 1`,
      [key]
    );
    if (rows.length > 0) return rows[0].response;
  } catch {}

  return null;
}

export async function setCachedDailyDigest(digest: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const key = `daily_digest:${today}`;

  if (redis) {
    await redis.setex(`${REDIS_PREFIX}${key}`, CACHE_TTL, digest).catch(() => {});
  }

  try {
    await query(
      `INSERT INTO ai_cache (query_hash, query_text, response)
       VALUES ($1, 'daily_digest', $2)
       ON CONFLICT (query_hash) DO UPDATE SET
         response = $2,
         created_at = NOW()`,
      [key, digest]
    );
  } catch {}
}

/**
 * Wyczyść stary cache (uruchamiaj raz dziennie)
 */
export async function cleanOldCache(): Promise<void> {
  try {
    await query(`DELETE FROM ai_cache WHERE created_at < NOW() - INTERVAL '7 days'`);
    logger.info('🧹 [Cache] Wyczyszczono stary cache');
  } catch {}
}
