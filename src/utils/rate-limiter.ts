/**
 * Rate limiter dla wiadomości Telegram
 * Telegram API pozwala max ~30 wiadomości/s, ale ograniczamy do bezpiecznego poziomu
 */
import { config } from '../config';
import logger from './logger';

interface RateLimitEntry {
  /** Liczba wiadomości wysłanych w bieżącej minucie */
  count: number;
  /** Timestamp początku okna czasowego */
  windowStart: number;
}

export class RateLimiter {
  private limits: Map<string, RateLimitEntry> = new Map();
  private maxPerMinute: number;

  constructor(maxPerMinute?: number) {
    this.maxPerMinute = maxPerMinute || config.TELEGRAM_MSG_PER_MIN;
  }

  /**
   * Sprawdza czy można wysłać wiadomość
   * @param key - klucz identyfikujący nadawcę (np. 'global' lub numer telefonu)
   * @returns true jeśli można wysłać, false jeśli limit przekroczony
   */
  canSend(key: string = 'global'): boolean {
    const now = Date.now();
    const entry = this.limits.get(key);

    // Brak wpisu lub upłynęła minuta - resetuj
    if (!entry || now - entry.windowStart >= 60_000) {
      this.limits.set(key, { count: 0, windowStart: now });
      return true;
    }

    return entry.count < this.maxPerMinute;
  }

  /**
   * Rejestruje wysłanie wiadomości
   * @param key - klucz identyfikujący nadawcę
   */
  record(key: string = 'global'): void {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now - entry.windowStart >= 60_000) {
      this.limits.set(key, { count: 1, windowStart: now });
    } else {
      entry.count++;
    }
  }

  /**
   * Oblicza czas oczekiwania do zwolnienia limitu (w ms)
   * @param key - klucz identyfikujący nadawcę
   * @returns czas w ms do czekania, 0 jeśli można wysłać od razu
   */
  getWaitTime(key: string = 'global'): number {
    const now = Date.now();
    const entry = this.limits.get(key);

    if (!entry || now - entry.windowStart >= 60_000) {
      return 0;
    }

    if (entry.count < this.maxPerMinute) {
      return 0;
    }

    // Czekaj do końca okna czasowego
    const waitMs = 60_000 - (now - entry.windowStart);
    logger.debug(`Rate limit: czekam ${waitMs}ms (klucz: ${key})`);
    return waitMs;
  }

  /**
   * Czeka na zwolnienie limitu i rejestruje wysłanie
   * @param key - klucz identyfikujący nadawcę
   */
  async waitAndRecord(key: string = 'global'): Promise<void> {
    const waitTime = this.getWaitTime(key);
    if (waitTime > 0) {
      logger.info(`⏳ Rate limit: czekam ${Math.ceil(waitTime / 1000)}s`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.record(key);
  }
}

/** Globalny rate limiter dla Telegram */
export const telegramRateLimiter = new RateLimiter();
