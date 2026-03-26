# 🏗️ Budowlaniec Bot v2.0

Telegram bot do monitoringu cen materiałów budowlanych i newsów branżowych w Polsce. Architektura multi-agent.

## Funkcje

- Monitoring cen z Castorama, Leroy Merlin, 3W, Bechcicki
- Newsy z WNP, PropertyNews, Bankier, Muratordom i innych
- AI podsumowania (Anthropic Claude Haiku) — zoptymalizowane pod kątem kosztów
- Codzienne raporty cenowe o 7:00 i 18:00
- Alerty cenowe (powiadomienie o spadku ceny)
- Pytania AI przez /pytaj z cache i limitami dziennymi
- Inline keyboards — klikanie zamiast wpisywania komend

## Architektura multi-agent

Bot korzysta z sieci agentów koordynowanych przez centralny scheduler:

```
Coordinator (node-cron)
├── PriceAgent    — scraping cen, zapis do DB, wykrywanie zmian
├── NewsAgent     — RSS + scraping, podsumowania AI (Claude Haiku)
├── ReportAgent   — raporty dzienne, wysyłka przez Telegram
└── AIAgent       — cache, limity, codzienne porządki
```

Każdy agent implementuje `async run(): Promise<AgentResult>` i jest uruchamiany przez koordynatora według harmonogramu CRON.

## Strategia oszczędności tokenów

Bot jest zaprojektowany tak, żeby zużywać MINIMALNE ilości tokenów AI:

- Komendy /start, /ceny, /newsy, /ustawienia, /pro, /pomoc, /porownaj — **0 tokenów** (szablony)
- Podsumowanie newsów — **raz dziennie** dla WSZYSTKICH użytkowników, z cache
- Pytania AI (/pytaj) — z **cache Redis+PostgreSQL** i **limitem dziennym** (5 free, 20 pro)
- Model: **Claude Haiku** (najtańszy, ~10x taniej niż Sonnet)
- Szacunkowy koszt: **2-10 PLN/mies.** przy 100+ użytkownikach

## Wymagania

- Node.js 20+
- Docker i Docker Compose
- Klucz API Anthropic
- Token bota Telegram (z @BotFather)

## Szybki start

### 1. Utwórz bota Telegram

1. Otwórz [@BotFather](https://t.me/BotFather) na Telegramie
2. Wyślij `/newbot`
3. Podaj nazwę bota (np. "Budowlaniec Bot")
4. Podaj username bota (np. `budowlaniec_ceny_bot`)
5. Skopiuj token API — wklej do `.env` jako `TELEGRAM_BOT_TOKEN`

### 2. Sklonuj repozytorium

```bash
git clone <repo-url>
cd budowlaniec-bot
```

### 3. Skonfiguruj zmienne środowiskowe

```bash
cp .env.example .env
```

Uzupełnij plik `.env`:
- `TELEGRAM_BOT_TOKEN` — token z @BotFather (wymagany)
- `ANTHROPIC_API_KEY` — klucz API Anthropic (wymagany)
- Reszta ma domyślne wartości dla docker-compose

### 4. Uruchom z Docker Compose

```bash
docker-compose up -d
```

Bot uruchomi PostgreSQL, Redis i aplikację. Przy pierwszym uruchomieniu migracje bazy danych wykonają się automatycznie.

### 5. Sprawdź logi

```bash
docker-compose logs -f app
```

## Uruchomienie lokalne (dev)

```bash
npm install
docker-compose up -d postgres redis  # Tylko baza i Redis
npm run dev
```

## Komendy bota

| Komenda | Opis | Tokeny AI |
|---------|------|-----------|
| `/start` | Rozpocznij, wybierz kategorie (inline keyboard) | 0 |
| `/ceny` | Podsumowanie cen Twoich kategorii | 0 |
| `/ceny [kategoria]` | Ceny w kategorii (np. `/ceny cement`) | 0 |
| `/porownaj [produkt]` | Porównaj ceny w sklepach | 0 |
| `/newsy` | Najnowsze newsy budowlane | 0 |
| `/ustawienia` | Zarządzaj preferencjami (inline keyboard) | 0 |
| `/pytaj [treść]` | Zadaj pytanie AI (limit dzienny) | ~400 |
| `/pro` | Informacje o koncie PRO | 0 |
| `/pomoc` | Lista komend i pomoc | 0 |

## Telegram Keyboards

Bot używa dwóch typów klawiatur:

- **Reply Keyboard** (na dole ekranu): [📊 Ceny] [📰 Newsy] [⚙️ Ustawienia] [🤖 Pytaj AI] [⭐ PRO] [❓ Pomoc]
- **Inline Keyboard** (w wiadomościach): wybór kategorii (checkbox), ustawienia, nawigacja

## Kategorie materiałów

- Cement i beton
- Stal i metale
- Drewno
- Izolacja
- Ceramika i płytki
- Chemia budowlana
- Instalacje
- Dachy
- Okna i drzwi
- Narzędzia

## Harmonogram agentów

| Agent | Zadanie | Harmonogram |
|-------|---------|------------|
| PriceAgent | Scraping cen | 6:00 i 17:00 |
| NewsAgent | Pobieranie newsów + AI podsumowania | Co 2 godziny |
| ReportAgent | Raport poranny (ceny + newsy) | 7:00 |
| ReportAgent | Raport wieczorny (ceny) | 18:00 |
| AIAgent | Porządki (cache, limity, PRO) | 0:00 |

## Struktura projektu

```
src/
├── index.ts            # Główny punkt wejścia
├── config.ts           # Konfiguracja i stałe
├── telegram/           # Moduł Telegram (Telegraf)
│   ├── bot.ts          # Inicjalizacja, middleware, start/stop
│   ├── commands.ts     # Handlery komend (szablony + /pytaj)
│   ├── keyboards.ts    # Inline i reply keyboards
│   └── sender.ts       # Kolejka wiadomości z rate limitingiem
├── agents/             # Architektura multi-agent
│   ├── coordinator.ts  # Scheduler CRON, zarządza agentami
│   ├── price-agent.ts  # Scraping cen, alerty
│   ├── news-agent.ts   # RSS + scraping + podsumowania AI
│   ├── report-agent.ts # Raporty dzienne (Telegram)
│   └── ai-agent.ts     # Cache, limity, porządki
├── scrapers/           # Scrapery cen (bez zmian)
│   ├── base.ts         # Klasa bazowa z retry
│   ├── castorama.ts
│   ├── leroy.ts
│   ├── trzyw.ts
│   └── bechcicki.ts
├── news/               # Moduł newsów (bez zmian)
│   ├── rss.ts
│   ├── scraper.ts
│   └── summarizer.ts
├── db/                 # Baza danych (bez zmian)
│   ├── client.ts
│   ├── migrations/
│   ├── users.ts
│   ├── prices.ts
│   └── news.ts
├── ai/                 # AI (bez zmian)
│   ├── assistant.ts
│   └── cache.ts
├── templates/
│   └── messages.ts     # Szablony wiadomości (Telegram Markdown)
├── reports/
│   ├── daily-prices.ts # Raporty cenowe (Telegram)
│   └── daily-news.ts   # Raporty newsowe (Telegram)
└── utils/
    ├── logger.ts
    └── rate-limiter.ts
```

## Licencja

MIT
