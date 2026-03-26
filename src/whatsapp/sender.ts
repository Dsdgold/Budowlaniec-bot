/**
 * Kolejka wiadomości WhatsApp z rate limitingiem
 * Zapewnia bezpieczne tempo wysyłania i obsługę batch sending
 */
import PQueue from 'p-queue';
import { sendMessage } from './client';
import { whatsappRateLimiter } from '../utils/rate-limiter';
import logger from '../utils/logger';

/** Pojedyncza wiadomość w kolejce */
interface QueuedMessage {
  jid: string;
  text: string;
  priority?: number;
}

class MessageSender {
  private queue: PQueue;

  constructor() {
    // Kolejka z ograniczeniem współbieżności
    this.queue = new PQueue({
      concurrency: 1, // Tylko jedna wiadomość na raz
      interval: 2000, // Minimum 2s między wiadomościami
      intervalCap: 1, // Jedna wiadomość na interwał
    });
  }

  /**
   * Wyślij wiadomość z rate limitingiem
   */
  async send(jid: string, text: string, priority: number = 0): Promise<void> {
    await this.queue.add(
      async () => {
        // Czekaj na zwolnienie limitu
        await whatsappRateLimiter.waitAndRecord('global');

        try {
          await sendMessage(jid, text);
          logger.debug(`📤 Wysłano wiadomość do ${jid.substring(0, 10)}...`);
        } catch (error) {
          logger.error(`❌ Błąd wysyłania do ${jid}:`, error);
          throw error;
        }
      },
      { priority }
    );
  }

  /**
   * Wyślij wiadomość do wielu odbiorców (raporty dzienne)
   * Automatycznie rozbija na mniejsze partie z opóźnieniami
   */
  async sendBatch(
    messages: QueuedMessage[]
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    logger.info(`📨 Rozpoczynam batch sending: ${messages.length} wiadomości`);

    for (const msg of messages) {
      try {
        await this.send(msg.jid, msg.text, msg.priority || 0);
        sent++;
      } catch (error) {
        failed++;
        logger.error(`❌ Batch: nie udało się wysłać do ${msg.jid}`);
      }
    }

    logger.info(`📨 Batch zakończony: wysłano ${sent}, błędów ${failed}`);
    return { sent, failed };
  }

  /**
   * Wyślij długą wiadomość podzieloną na części (WhatsApp limit ~65000 znaków)
   */
  async sendLong(jid: string, text: string, maxLength: number = 4000): Promise<void> {
    if (text.length <= maxLength) {
      await this.send(jid, text);
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
      await this.send(jid, header + parts[i]);
    }
  }

  /**
   * Liczba wiadomości w kolejce
   */
  get pending(): number {
    return this.queue.size + this.queue.pending;
  }

  /**
   * Wyczyść kolejkę
   */
  clear(): void {
    this.queue.clear();
    logger.info('🗑️ Kolejka wiadomości wyczyszczona');
  }
}

/** Globalny singleton sendera */
export const messageSender = new MessageSender();
