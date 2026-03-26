/**
 * Wysyłanie wiadomości Telegram z rate limitingiem
 * Odpowiednik whatsapp/sender.ts — kolejka z ograniczeniem tempa
 */
import PQueue from 'p-queue';
import { Telegraf } from 'telegraf';
import { telegramRateLimiter } from '../utils/rate-limiter';
import logger from '../utils/logger';

/** Pojedyncza wiadomość w kolejce */
interface QueuedMessage {
  chatId: number | string;
  text: string;
  priority?: number;
  parseMode?: 'Markdown' | 'HTML';
}

class TelegramSender {
  private queue: PQueue;
  private bot: Telegraf | null = null;

  constructor() {
    // Kolejka z ograniczeniem współbieżności
    this.queue = new PQueue({
      concurrency: 1,       // Jedna wiadomość na raz
      interval: 1000,       // Minimum 1s między wiadomościami
      intervalCap: 1,       // Jedna wiadomość na interwał
    });
  }

  /** Ustaw instancję bota (wywoływane przy starcie) */
  setBot(bot: Telegraf): void {
    this.bot = bot;
  }

  /** Pobierz instancję bota */
  getBot(): Telegraf {
    if (!this.bot) {
      throw new Error('Bot Telegram nie jest zainicjalizowany');
    }
    return this.bot;
  }

  /**
   * Wyślij wiadomość z rate limitingiem
   * Telegram wspiera Markdown — używamy parse_mode
   */
  async send(
    chatId: number | string,
    text: string,
    priority: number = 0,
    parseMode: 'Markdown' | 'HTML' = 'Markdown'
  ): Promise<void> {
    await this.queue.add(
      async () => {
        // Czekaj na zwolnienie limitu
        await telegramRateLimiter.waitAndRecord('global');

        try {
          const bot = this.getBot();
          await bot.telegram.sendMessage(chatId, text, {
            parse_mode: parseMode,
          });
          logger.debug(`📤 Wysłano wiadomość do ${chatId}`);
        } catch (error: any) {
          // Jeśli Markdown się nie parsuje — wyślij bez formatowania
          if (error?.response?.description?.includes('parse')) {
            logger.warn(`⚠️ Błąd Markdown, wysyłam bez formatowania do ${chatId}`);
            try {
              const bot = this.getBot();
              await bot.telegram.sendMessage(chatId, text);
            } catch (retryError) {
              logger.error(`❌ Błąd wysyłania (retry) do ${chatId}:`, retryError);
              throw retryError;
            }
          } else {
            logger.error(`❌ Błąd wysyłania do ${chatId}:`, error);
            throw error;
          }
        }
      },
      { priority }
    );
  }

  /**
   * Wyślij wiadomość do wielu odbiorców (raporty dzienne)
   * Automatycznie z rate limitingiem
   */
  async sendBatch(
    messages: QueuedMessage[]
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    logger.info(`📨 Rozpoczynam batch sending: ${messages.length} wiadomości`);

    for (const msg of messages) {
      try {
        await this.send(msg.chatId, msg.text, msg.priority || 0, msg.parseMode || 'Markdown');
        sent++;
      } catch (error) {
        failed++;
        logger.error(`❌ Batch: nie udało się wysłać do ${msg.chatId}`);
      }
    }

    logger.info(`📨 Batch zakończony: wysłano ${sent}, błędów ${failed}`);
    return { sent, failed };
  }

  /**
   * Wyślij długą wiadomość podzieloną na części (Telegram limit ~4096 znaków)
   */
  async sendLong(
    chatId: number | string,
    text: string,
    maxLength: number = 4000
  ): Promise<void> {
    if (text.length <= maxLength) {
      await this.send(chatId, text);
      return;
    }

    // Podziel na fragmenty po akapitach
    const parts: string[] = [];
    let current = '';

    for (const line of text.split('\n')) {
      if ((current + '\n' + line).length > maxLength && current.length > 0) {
        parts.push(current.trim());
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }
    if (current.trim()) {
      parts.push(current.trim());
    }

    // Wyślij kolejne części z numeracją
    for (let i = 0; i < parts.length; i++) {
      const header = parts.length > 1 ? `(${i + 1}/${parts.length})\n\n` : '';
      await this.send(chatId, header + parts[i]);
    }
  }

  /** Liczba wiadomości w kolejce */
  get pending(): number {
    return this.queue.size + this.queue.pending;
  }

  /** Wyczyść kolejkę */
  clear(): void {
    this.queue.clear();
    logger.info('🗑️ Kolejka wiadomości wyczyszczona');
  }
}

/** Globalny singleton sendera Telegram */
export const messageSender = new TelegramSender();
