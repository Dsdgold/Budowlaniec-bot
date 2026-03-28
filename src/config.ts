/**
 * Konfiguracja aplikacji — ładowanie zmiennych środowiskowych i stałych
 */
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Schemat walidacji zmiennych środowiskowych
const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'Token bota Telegram jest wymagany'),
  ANTHROPIC_API_KEY: z.string().min(1, 'Klucz API Anthropic jest wymagany'),
  AI_DAILY_LIMIT_FREE: z.coerce.number().default(5),
  AI_DAILY_LIMIT_PRO: z.coerce.number().default(20),
  DATABASE_URL: z.string().url('Niepoprawny URL bazy danych'),
  PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  PROXY_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  TELEGRAM_MSG_PER_MIN: z.coerce.number().default(30),
  SCRAPE_RETRY_COUNT: z.coerce.number().default(3),
  SCRAPE_RETRY_DELAY_MS: z.coerce.number().default(5000),
});

// Parsowanie i walidacja
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Błąd konfiguracji zmiennych środowiskowych:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;

// === Stałe aplikacji ===

/** Kategorie materiałów budowlanych */
export const KATEGORIE = [
  'cement',
  'stal',
  'drewno',
  'izolacja',
  'ceramika',
  'chemia-budowlana',
  'instalacje',
  'dachy',
  'okna-drzwi',
  'narzedzia',
] as const;

export type Kategoria = (typeof KATEGORIE)[number];

/** Etykiety kategorii po polsku */
export const KATEGORIE_LABELS: Record<Kategoria, string> = {
  cement: '🧱 Cement i beton',
  stal: '🔩 Stal i metale',
  drewno: '🪵 Drewno',
  izolacja: '🧊 Izolacja',
  ceramika: '🏺 Ceramika i płytki',
  'chemia-budowlana': '🧪 Chemia budowlana',
  instalacje: '🔧 Instalacje',
  dachy: '🏠 Dachy',
  'okna-drzwi': '🪟 Okna i drzwi',
  narzedzia: '🛠️ Narzędzia',
};

/** Regiony Polski */
export const REGIONY = [
  'mazowieckie',
  'malopolskie',
  'slaskie',
  'wielkopolskie',
  'dolnoslaskie',
  'pomorskie',
  'lodzkie',
  'lubelskie',
  'podkarpackie',
  'kujawsko-pomorskie',
  'warminsko-mazurskie',
  'zachodniopomorskie',
  'podlaskie',
  'swietokrzyskie',
  'lubuskie',
  'opolskie',
] as const;

export type Region = (typeof REGIONY)[number];

/** Źródła newsów RSS */
export const RSS_SOURCES = [
  { name: 'WNP Budownictwo', url: 'https://www.wnp.pl/rss/budownictwo.xml' },
  { name: 'PropertyNews', url: 'https://propertynews.pl/rss/all.xml' },
  { name: 'Bankier Nieruchomości', url: 'https://www.bankier.pl/rss/nieruchomosci.xml' },
  { name: 'Muratordom', url: 'https://muratordom.pl/rss.xml' },
  { name: 'Inżynier Budownictwa', url: 'https://www.inzynierbudownictwa.pl/feed/' },
] as const;

/** Sklepy do scrapowania */
export const SELLERS = {
  castorama: { name: 'Castorama', baseUrl: 'https://www.castorama.pl' },
  leroy: { name: 'Leroy Merlin', baseUrl: 'https://www.leroymerlin.pl' },
  trzyw: { name: '3W', baseUrl: 'https://3wdb.pl' },
  bechcicki: { name: 'Bechcicki', baseUrl: 'https://www.bechcicki.pl' },
  ceneo: { name: 'Ceneo', baseUrl: 'https://www.ceneo.pl' },
} as const;

/** Plany monetyzacji */
export const PRICING_PLANS = {
  free: {
    name: 'Free',
    price: 0,
    features: [
      'Podstawowe ceny (odświeżane co 24h)',
      'Top 3 kategorie',
      '5 pytań AI/dzień',
      'Raport poranny',
    ],
    limits: {
      categories: 3,
      aiQueries: 5,
      alerts: 2,
      reportsPerDay: 1,
      historyDays: 7,
    },
  },
  pro: {
    name: 'Pro',
    price: 49,
    features: [
      'Wszystkie kategorie',
      'Ceny w czasie rzeczywistym',
      '20 pytań AI/dzień',
      'Raporty poranny + wieczorny',
      'Alerty cenowe (10)',
      'Historia 30 dni',
      'Porównania cen',
    ],
    limits: {
      categories: 10,
      aiQueries: 20,
      alerts: 10,
      reportsPerDay: 2,
      historyDays: 30,
    },
  },
  business: {
    name: 'Business',
    price: 199,
    features: [
      'Wszystko z Pro',
      'API dostęp',
      'Eksport CSV/Excel',
      'Leady budowlane',
      'Analytics & Insights',
      'Nielimitowane alerty',
      'Historia 365 dni',
      'Priorytetowe wsparcie',
      'Własne scrapery',
    ],
    limits: {
      categories: 10,
      aiQueries: 100,
      alerts: -1,
      reportsPerDay: -1,
      historyDays: 365,
    },
  },
} as const;

export type PlanType = keyof typeof PRICING_PLANS;

/** Harmonogram CRON */
export const CRON_SCHEDULES = {
  /** Scraping cen — 2x dziennie (6:00 i 17:00) */
  PRICE_SCRAPE: '0 6,17 * * *',
  /** Pobieranie newsów — co 2 godziny */
  NEWS_FETCH: '0 */2 * * *',
  /** Raport poranny — 7:00 */
  MORNING_REPORT: '0 7 * * *',
  /** Raport wieczorny — 18:00 */
  EVENING_REPORT: '0 18 * * *',
} as const;
