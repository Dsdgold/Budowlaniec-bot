/**
 * Klient WhatsApp oparty na Baileys
 * Obsługa połączenia, kodów parowania i nasłuchiwania wiadomości
 */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { config } from '../config';
import { handleIncomingMessage } from './handlers';
import logger from '../utils/logger';

/** Globalna instancja socketa WhatsApp */
let sock: WASocket | null = null;

/** Stan parowania — udostępniony dla endpointu HTTP */
let pairingCode: string | null = null;
let pairingRequested = false;
let isWaConnected = false;

export function getPairingCode(): string | null { return pairingCode; }
export function getIsConnected(): boolean { return isWaConnected; }
export function isPairingRequested(): boolean { return pairingRequested; }

/**
 * Poproś o kod parowania dla numeru telefonu
 */
export async function requestPairing(phoneNumber: string): Promise<string | null> {
  if (!sock) {
    logger.error('❌ Socket WhatsApp nie jest zainicjalizowany');
    return null;
  }

  try {
    // Wyczyść numer — tylko cyfry, z kodem kraju (np. 48 dla Polski)
    const cleaned = phoneNumber.replace(/[^0-9]/g, '');
    logger.info(`📲 Proszę o kod parowania dla: ${cleaned}`);

    const code = await sock.requestPairingCode(cleaned);
    pairingCode = code;
    pairingRequested = true;

    logger.info(`📲 ========================================`);
    logger.info(`📲  KOD PAROWANIA: ${code}`);
    logger.info(`📲 ========================================`);

    return code;
  } catch (error) {
    logger.error(`❌ Błąd parowania: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Pobierz instancję socketa WhatsApp
 */
export function getSocket(): WASocket {
  if (!sock) {
    throw new Error('Socket WhatsApp nie jest zainicjalizowany');
  }
  return sock;
}

/**
 * Uruchom klienta WhatsApp z obsługą reconnect
 */
export async function startWhatsAppClient(): Promise<WASocket> {
  logger.info('📱 Uruchamiam klienta WhatsApp...');

  const { state, saveCreds } = await useMultiFileAuthState(
    config.WHATSAPP_SESSION_PATH
  );

  sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger as any),
    },
    printQRInTerminal: false,
    logger: logger as any,
    browser: ['Budowlaniec Bot', 'Chrome', '120.0.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  // === Obsługa zdarzeń połączenia ===
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info('📲 QR wygenerowany — użyj /qr w przeglądarce żeby się połączyć');
      logger.info('📲 OTWÓRZ: http://localhost:3000/qr');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn(
        `⚠️ Połączenie zamknięte (kod: ${statusCode}). Ponowne połączenie: ${shouldReconnect}`
      );

      isWaConnected = false;

      if (shouldReconnect) {
        setTimeout(() => {
          logger.info('🔄 Próbuję ponownie połączyć...');
          startWhatsAppClient();
        }, 5000);
      } else {
        logger.error('❌ Wylogowano z WhatsApp. Usuń folder auth_info i uruchom ponownie.');
      }
    }

    if (connection === 'open') {
      isWaConnected = true;
      pairingCode = null;
      pairingRequested = false;
      logger.info('✅ Połączono z WhatsApp!');
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // === Obsługa przychodzących wiadomości ===
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const message of messages) {
      if (message.key.fromMe) continue;
      if (message.key.remoteJid?.endsWith('@g.us')) continue;
      if (message.key.remoteJid === 'status@broadcast') continue;

      try {
        await handleIncomingMessage(message);
      } catch (error) {
        logger.error('❌ Błąd obsługi wiadomości:', error);
      }
    }
  });

  return sock;
}

/**
 * Wyślij wiadomość tekstową
 */
export async function sendMessage(
  jid: string,
  text: string
): Promise<proto.WebMessageInfo | undefined> {
  const socket = getSocket();
  try {
    return await socket.sendMessage(jid, { text });
  } catch (error) {
    logger.error(`❌ Błąd wysyłania wiadomości do ${jid}:`, error);
    throw error;
  }
}

/**
 * Wyślij wiadomość z przyciskami (lista)
 */
export async function sendListMessage(
  jid: string,
  title: string,
  description: string,
  buttonText: string,
  sections: { title: string; rows: { title: string; description?: string; rowId: string }[] }[]
): Promise<void> {
  const socket = getSocket();
  try {
    await socket.sendMessage(jid, {
      text: `${title}\n\n${description}\n\n${sections
        .map(
          (s) =>
            `*${s.title}*\n${s.rows.map((r) => `• ${r.title} → /${r.rowId}`).join('\n')}`
        )
        .join('\n\n')}`,
    });
  } catch (error) {
    logger.error(`❌ Błąd wysyłania listy do ${jid}:`, error);
    throw error;
  }
}

/**
 * Sprawdź czy klient jest połączony
 */
export function isConnected(): boolean {
  return isWaConnected;
}
