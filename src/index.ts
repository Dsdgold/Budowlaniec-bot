/**
 * Budowlaniec Bot v2.0 — główny punkt wejścia
 * Uruchamia bota Telegram, koordynatora agentów i endpoint health check
 */
import express from 'express';
import { config } from './config';
import { startTelegramBot, stopTelegramBot, isBotRunning } from './telegram/bot';
import { messageSender } from './telegram/sender';
import * as coordinator from './agents/coordinator';
import { checkConnection, closePool } from './db/client';
import { getUserStats, findUserByPhone, getUserPreferences, setUserPreferences } from './db/users';
import { getProductStats, getChartData, getLatestPrices, getPriceChanges24h, getPriceDropsRanking, getBestPromos, getSellerRanking, getCategoryTrend, getUserAlerts, createKeywordAlert } from './db/prices';
import { getNewsStats, getSummarizedArticles } from './db/news';
import { KATEGORIE, KATEGORIE_LABELS, Kategoria } from './config';
import logger from './utils/logger';

// Importy do migracji
import fs from 'fs';
import path from 'path';
import { pool } from './db/client';

/**
 * Uruchom migracje bazy danych
 */
async function runMigrations(): Promise<void> {
  logger.info('🔄 Sprawdzam migracje bazy danych...');

  // Utwórz tabelę migracji
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Sprawdź wykonane migracje
  const executed = await pool.query('SELECT filename FROM migrations ORDER BY id');
  const executedFiles = new Set(executed.rows.map((r: any) => r.filename));

  // Znajdź pliki migracji
  const migrationsDir = path.join(__dirname, 'db', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.warn('⚠️ Katalog migracji nie istnieje');
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (executedFiles.has(file)) continue;

    logger.info(`▶️ Wykonuję migrację: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info(`✅ Migracja: ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error(`❌ Błąd migracji ${file}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  logger.info('✅ Baza danych gotowa');
}

/**
 * Uruchom serwer Express (health check + metryki)
 */
function startHealthServer(): void {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/health', async (_req, res) => {
    const dbOk = await checkConnection();
    const botOk = isBotRunning();

    const status = dbOk && botOk ? 'healthy' : 'degraded';
    const httpCode = dbOk ? 200 : 503;

    res.status(httpCode).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'ok' : 'error',
        telegram: botOk ? 'connected' : 'disconnected',
        messageQueue: messageSender.pending,
      },
    });
  });

  // Metryki
  app.get('/metrics', async (_req, res) => {
    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      messageQueueSize: messageSender.pending,
      agentHistory: coordinator.getRunHistory().slice(-10),
    });
  });

  // Ręczne uruchamianie agentów
  app.post('/agents/:name', async (req, res) => {
    const name = req.params.name as any;
    const valid = ['price', 'news', 'morning_report', 'evening_report', 'maintenance'];
    if (!valid.includes(name)) {
      res.status(400).json({ error: `Nieznany agent. Dostępne: ${valid.join(', ')}` });
      return;
    }
    logger.info(`🔧 Ręczne uruchomienie agenta: ${name}`);
    const result = await coordinator.runManual(name);
    res.json(result);
  });

  // Uruchom WSZYSTKICH agentów naraz (pierwsze zasilenie danych)
  app.post('/agents/run-all', async (_req, res) => {
    logger.info('🔧 Ręczne uruchomienie WSZYSTKICH agentów...');
    const results: Record<string, any> = {};
    results.news = await coordinator.runManual('news');
    results.price = await coordinator.runManual('price');
    res.json(results);
  });

  // === ENDPOINTY API ===

  // API: Statystyki ogólne — użytkownicy, produkty, newsy, agenci
  app.get('/api/stats', async (_req, res) => {
    try {
      const [users, products, news] = await Promise.all([
        getUserStats(),
        getProductStats(),
        getNewsStats(),
      ]);
      const agents = coordinator.getRunHistory().slice(-20);
      res.json({ users, products, news, agents });
    } catch (error) {
      logger.error('❌ [API] Błąd /api/stats:', error);
      res.status(500).json({ error: 'Błąd pobierania statystyk' });
    }
  });

  // API: Dane wykresu cen dla kategorii (ostatnie 30 dni)
  app.get('/api/prices/chart/:category', async (req, res) => {
    try {
      const category = req.params.category as Kategoria;
      if (!KATEGORIE.includes(category)) {
        res.status(400).json({ error: `Nieznana kategoria: ${category}` });
        return;
      }
      const data = await getChartData(category, 30);
      res.json(data);
    } catch (error) {
      logger.error('❌ [API] Błąd /api/prices/chart:', error);
      res.status(500).json({ error: 'Błąd pobierania danych wykresu' });
    }
  });

  // API: Lista kategorii (do selecta w dashboardzie)
  app.get('/api/categories', (_req, res) => {
    const cats = KATEGORIE.map((slug) => ({
      slug,
      label: KATEGORIE_LABELS[slug],
    }));
    res.json(cats);
  });

  // === TELEGRAM WEBAPP ===

  // Serwuj plik HTML Mini App
  app.get('/webapp', (_req, res) => {
    const webappPath = path.join(__dirname, 'webapp', 'index.html');
    res.sendFile(webappPath);
  });

  // API: Ceny produktów z kategorii (z historią i zmianą procentową)
  app.get('/api/webapp/prices/:category', async (req, res) => {
    try {
      const category = req.params.category as Kategoria;
      if (!KATEGORIE.includes(category)) {
        res.status(400).json({ error: `Nieznana kategoria: ${category}` });
        return;
      }
      const prices = await getLatestPrices(category, 50);
      const changes = await getPriceChanges24h(category);

      // Mapa zmian procentowych per product
      const changeMap = new Map<string, number>();
      for (const c of changes) {
        changeMap.set(c.product_name, c.change_percent);
      }

      const result = prices.map((p: any) => ({
        name: p.product_name || p.name,
        price: Number(p.price),
        seller_slug: p.seller_slug,
        is_promo: p.is_promo,
        original_price: p.original_price ? Number(p.original_price) : null,
        url: p.url || null,
        change_percent: changeMap.get(p.product_name || p.name) || null,
        history: null, // Opcjonalnie: mini historia cen do sparkline
      }));

      res.json(result);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/prices:', error);
      res.status(500).json({ error: 'Błąd pobierania cen' });
    }
  });

  // API: Newsy z ostatnich 48h
  app.get('/api/webapp/news', async (_req, res) => {
    try {
      const articles = await getSummarizedArticles(48, 30);
      const result = articles.map(a => ({
        title: a.title,
        summary: a.summary,
        url: a.url,
        source_name: a.source_name,
        published_at: a.published_at,
      }));
      res.json(result);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/news:', error);
      res.status(500).json({ error: 'Błąd pobierania newsów' });
    }
  });

  // API: Dane trendu cenowego dla kategorii
  app.get('/api/webapp/trends/:category', async (req, res) => {
    try {
      const category = req.params.category as Kategoria;
      if (!KATEGORIE.includes(category)) {
        res.status(400).json({ error: `Nieznana kategoria: ${category}` });
        return;
      }
      // Parsuj okres z query string, np. ?period=7d
      const periodStr = (req.query.period as string) || '7d';
      const days = parseInt(periodStr) || 7;
      const data = await getChartData(category, days);
      res.json(data);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/trends:', error);
      res.status(500).json({ error: 'Błąd pobierania trendów' });
    }
  });

  // API: Ranking — top spadki cen
  app.get('/api/webapp/ranking/drops', async (_req, res) => {
    try {
      const data = await getPriceDropsRanking(20);
      res.json(data);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/ranking/drops:', error);
      res.status(500).json({ error: 'Błąd rankingu spadków' });
    }
  });

  // API: Ranking — top promocje
  app.get('/api/webapp/ranking/promos', async (_req, res) => {
    try {
      const data = await getBestPromos(20);
      res.json(data);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/ranking/promos:', error);
      res.status(500).json({ error: 'Błąd rankingu promocji' });
    }
  });

  // API: Ranking — sklepy
  app.get('/api/webapp/ranking/sellers', async (_req, res) => {
    try {
      const data = await getSellerRanking();
      res.json(data);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/ranking/sellers:', error);
      res.status(500).json({ error: 'Błąd rankingu sklepów' });
    }
  });

  // API: Profil użytkownika (identyfikacja po tg_id = chatId)
  app.get('/api/webapp/profile', async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) {
        res.status(400).json({ error: 'Brak tg_id' });
        return;
      }
      // W bocie Telegram chatId jest zapisany jako phone
      const user = await findUserByPhone(tgId);
      if (!user) {
        res.json({ name: null, is_pro: false, categories: [], ai_queries_today: 0 });
        return;
      }
      const prefs = await getUserPreferences(user.id);
      res.json({
        name: user.name,
        is_pro: user.is_pro,
        region: user.region,
        categories: prefs.map(p => p.category_slug),
        ai_queries_today: user.ai_queries_today,
        daily_report_time: user.daily_report_time,
      });
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/profile:', error);
      res.status(500).json({ error: 'Błąd profilu' });
    }
  });

  // API: Alerty użytkownika
  app.get('/api/webapp/profile/alerts', async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) { res.status(400).json({ error: 'Brak tg_id' }); return; }
      const user = await findUserByPhone(tgId);
      if (!user) { res.json([]); return; }
      const alerts = await getUserAlerts(user.id);
      res.json(alerts);
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd /api/webapp/profile/alerts:', error);
      res.status(500).json({ error: 'Błąd alertów' });
    }
  });

  // API: Zmień kategorie użytkownika
  app.post('/api/webapp/profile/categories', async (req, res) => {
    try {
      const { tg_id, categories } = req.body;
      if (!tg_id || !Array.isArray(categories)) {
        res.status(400).json({ error: 'Brak tg_id lub categories' });
        return;
      }
      const user = await findUserByPhone(tg_id.toString());
      if (!user) { res.status(404).json({ error: 'Użytkownik nie znaleziony' }); return; }

      // Waliduj kategorie
      const validCats = categories.filter((c: string) => KATEGORIE.includes(c as Kategoria)) as Kategoria[];
      await setUserPreferences(user.id, validCats);
      res.json({ success: true, categories: validCats });
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd POST /api/webapp/profile/categories:', error);
      res.status(500).json({ error: 'Błąd zapisu kategorii' });
    }
  });

  // API: Dodaj alert cenowy
  app.post('/api/webapp/alerts', async (req, res) => {
    try {
      const { tg_id, keyword, target_price } = req.body;
      if (!tg_id || !keyword || !target_price) {
        res.status(400).json({ error: 'Brak wymaganych pól' });
        return;
      }
      const user = await findUserByPhone(tg_id.toString());
      if (!user) { res.status(404).json({ error: 'Użytkownik nie znaleziony' }); return; }

      await createKeywordAlert(user.id, keyword, target_price);
      res.json({ success: true });
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd POST /api/webapp/alerts:', error);
      res.status(500).json({ error: 'Błąd tworzenia alertu' });
    }
  });

  // API: Usuń alert cenowy
  app.delete('/api/webapp/alerts/:id', async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) { res.status(400).json({ error: 'Brak tg_id' }); return; }
      const user = await findUserByPhone(tgId);
      if (!user) { res.status(404).json({ error: 'Użytkownik nie znaleziony' }); return; }

      // Usunięcie alertu po ID — keyword_alerts nie ma delete by id, użyjemy raw query
      const { query: dbQuery } = await import('./db/client');
      await dbQuery(
        'UPDATE keyword_alerts SET is_active = FALSE WHERE id = $1 AND user_id = $2',
        [req.params.id, user.id]
      );
      res.json({ success: true });
    } catch (error) {
      logger.error('❌ [WebApp API] Błąd DELETE /api/webapp/alerts:', error);
      res.status(500).json({ error: 'Błąd usuwania alertu' });
    }
  });

  // === DASHBOARD HTML ===
  app.get('/dashboard', (_req, res) => {
    res.send(getDashboardHtml());
  });

  // Landing page — strona reklamowa
  app.get('/landing', (_req, res) => {
    const landingPath = require('path').join(__dirname, '..', 'landing-page.html');
    res.sendFile(landingPath);
  });

  // Ping
  app.get('/', (_req, res) => {
    res.send('🏗️ Budowlaniec Bot v2.1 działa!');
  });

  app.listen(config.PORT, () => {
    logger.info(`🌐 Health server na porcie ${config.PORT}`);
  });
}

/**
 * Graceful shutdown — zamknij wszystko czysto
 */
function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`\n🛑 Otrzymano ${signal} — zamykam...`);

    try {
      // Zatrzymaj bota Telegram
      stopTelegramBot(signal);

      // Wyczyść kolejkę wiadomości
      messageSender.clear();

      // Zamknij połączenie z bazą
      await closePool();

      logger.info('👋 Budowlaniec Bot zamknięty. Do zobaczenia!');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Błąd podczas zamykania:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Obsługa nieobsłużonych błędów
  process.on('uncaughtException', (error) => {
    logger.error('💥 Nieobsłużony wyjątek:', error);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('💥 Nieobsłużona odrzucona obietnica:', reason);
  });
}

/**
 * Generuj HTML dashboardu — ciemny motyw, Chart.js, auto-refresh
 */
function getDashboardHtml(): string {
  // Lista kategorii do selecta
  const categoryOptions = KATEGORIE.map(
    (slug) => `<option value="${slug}">${KATEGORIE_LABELS[slug]}</option>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Budowlaniec Bot — Dashboard</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      min-height: 100vh;
      padding: 1rem;
    }
    .header {
      text-align: center;
      padding: 1.5rem 0;
      margin-bottom: 1.5rem;
    }
    .header h1 { font-size: 1.8rem; color: #f8fafc; }
    .header p { color: #94a3b8; font-size: 0.9rem; margin-top: 0.4rem; }
    .header .status { display: inline-block; padding: 0.3rem 0.8rem; border-radius: 999px; font-size: 0.75rem; margin-top: 0.5rem; }
    .header .status.ok { background: #064e3b; color: #6ee7b7; }
    .header .status.err { background: #7f1d1d; color: #fca5a5; }

    /* Karty statystyk */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.2rem;
      text-align: center;
      transition: transform 0.2s;
    }
    .stat-card:hover { transform: translateY(-2px); border-color: #475569; }
    .stat-card .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .stat-card .value { font-size: 2rem; font-weight: 700; color: #f8fafc; }
    .stat-card .label { color: #94a3b8; font-size: 0.85rem; margin-top: 0.3rem; }
    .stat-card .sub { color: #64748b; font-size: 0.75rem; margin-top: 0.2rem; }

    /* Sekcje */
    .section {
      background: rgba(30, 41, 59, 0.8);
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .section h2 { font-size: 1.1rem; margin-bottom: 1rem; color: #f1f5f9; }

    /* Wykres */
    .chart-controls { display: flex; gap: 0.8rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
    .chart-controls select {
      background: #0f172a; color: #e2e8f0; border: 1px solid #475569;
      border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.9rem; cursor: pointer;
    }
    .chart-container { position: relative; height: 300px; }

    /* Historia agentów */
    .agent-list { list-style: none; max-height: 350px; overflow-y: auto; }
    .agent-list li {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0; border-bottom: 1px solid #1e293b;
      font-size: 0.85rem; flex-wrap: wrap; gap: 0.3rem;
    }
    .agent-list .agent-name { font-weight: 600; color: #e2e8f0; min-width: 140px; }
    .agent-list .agent-time { color: #64748b; font-size: 0.75rem; }
    .agent-list .agent-status { padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.7rem; }
    .agent-list .agent-status.ok { background: #064e3b; color: #6ee7b7; }
    .agent-list .agent-status.fail { background: #7f1d1d; color: #fca5a5; }
    .agent-list .agent-msg { color: #94a3b8; font-size: 0.75rem; width: 100%; margin-top: 0.2rem; }

    /* Przyciski agentów */
    .agent-buttons {
      display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 1rem;
    }
    .agent-btn {
      background: #1e293b; color: #e2e8f0; border: 1px solid #475569;
      border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.8rem;
      cursor: pointer; transition: all 0.2s;
    }
    .agent-btn:hover { background: #334155; border-color: #64748b; }
    .agent-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .agent-btn.running { border-color: #fbbf24; color: #fbbf24; }

    /* Footer */
    .footer { text-align: center; color: #475569; font-size: 0.75rem; padding: 1rem 0; }
    .refresh-info { color: #64748b; font-size: 0.75rem; text-align: right; margin-bottom: 0.5rem; }

    /* Responsywność */
    @media (max-width: 640px) {
      body { padding: 0.5rem; }
      .header h1 { font-size: 1.3rem; }
      .stat-card .value { font-size: 1.5rem; }
      .chart-container { height: 220px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🏗️ Budowlaniec Bot</h1>
    <p>Dashboard monitoringu cen materiałów budowlanych</p>
    <div class="status" id="statusBadge">Ładowanie...</div>
  </div>

  <div class="refresh-info">Ostatnia aktualizacja: <span id="lastRefresh">—</span></div>

  <!-- Karty statystyk -->
  <div class="stats-grid" id="statsGrid">
    <div class="stat-card">
      <div class="icon">👥</div>
      <div class="value" id="usersTotal">—</div>
      <div class="label">Użytkownicy</div>
      <div class="sub" id="usersSub"></div>
    </div>
    <div class="stat-card">
      <div class="icon">📦</div>
      <div class="value" id="productsTotal">—</div>
      <div class="label">Produkty</div>
      <div class="sub" id="productsSub"></div>
    </div>
    <div class="stat-card">
      <div class="icon">🏷️</div>
      <div class="value" id="promosTotal">—</div>
      <div class="label">Promocje</div>
      <div class="sub">aktywne</div>
    </div>
    <div class="stat-card">
      <div class="icon">📰</div>
      <div class="value" id="newsTotal">—</div>
      <div class="label">Newsy</div>
      <div class="sub" id="newsSub"></div>
    </div>
  </div>

  <!-- Wykres cen -->
  <div class="section">
    <h2>📊 Wykres cen — średnia dzienna</h2>
    <div class="chart-controls">
      <select id="categorySelect">
        ${categoryOptions}
      </select>
    </div>
    <div class="chart-container">
      <canvas id="priceChart"></canvas>
    </div>
  </div>

  <!-- Agenci -->
  <div class="section">
    <h2>🤖 Agenci</h2>
    <div class="agent-buttons" id="agentButtons">
      <button class="agent-btn" data-agent="price" onclick="runAgent('price')">📊 Ceny</button>
      <button class="agent-btn" data-agent="news" onclick="runAgent('news')">📰 Newsy</button>
      <button class="agent-btn" data-agent="morning_report" onclick="runAgent('morning_report')">🌅 Raport poranny</button>
      <button class="agent-btn" data-agent="evening_report" onclick="runAgent('evening_report')">🌆 Raport wieczorny</button>
      <button class="agent-btn" data-agent="maintenance" onclick="runAgent('maintenance')">🧹 Porządki</button>
    </div>
    <ul class="agent-list" id="agentList">
      <li>Ładowanie...</li>
    </ul>
  </div>

  <div class="footer">
    Budowlaniec Bot v2.1 — auto-refresh co 30s
  </div>

  <script>
    // === Stan aplikacji ===
    let priceChart = null;
    let currentCategory = '${KATEGORIE[0]}';

    // === Inicjalizacja ===
    document.addEventListener('DOMContentLoaded', () => {
      initChart();
      loadStats();
      loadChart(currentCategory);

      // Zmiana kategorii
      document.getElementById('categorySelect').addEventListener('change', (e) => {
        currentCategory = e.target.value;
        loadChart(currentCategory);
      });

      // Auto-refresh co 30s
      setInterval(() => {
        loadStats();
        loadChart(currentCategory);
      }, 30000);
    });

    // === Wykres Chart.js ===
    function initChart() {
      const ctx = document.getElementById('priceChart').getContext('2d');
      priceChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Średnia cena (zł)',
              data: [],
              borderColor: '#3b82f6',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              fill: true,
              tension: 0.3,
              pointRadius: 3,
              pointHoverRadius: 6,
            },
            {
              label: 'Min',
              data: [],
              borderColor: '#22c55e',
              borderDash: [5, 5],
              fill: false,
              tension: 0.3,
              pointRadius: 0,
            },
            {
              label: 'Max',
              data: [],
              borderColor: '#ef4444',
              borderDash: [5, 5],
              fill: false,
              tension: 0.3,
              pointRadius: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: '#94a3b8', font: { size: 12 } } },
          },
          scales: {
            x: {
              ticks: { color: '#64748b', maxRotation: 45 },
              grid: { color: 'rgba(71, 85, 105, 0.3)' },
            },
            y: {
              ticks: { color: '#64748b', callback: (v) => v + ' zł' },
              grid: { color: 'rgba(71, 85, 105, 0.3)' },
            },
          },
        },
      });
    }

    // === Ładowanie statystyk ===
    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        // Użytkownicy
        document.getElementById('usersTotal').textContent = data.users.total;
        document.getElementById('usersSub').textContent =
          data.users.pro + ' PRO · ' + data.users.active_today + ' dziś';

        // Produkty
        document.getElementById('productsTotal').textContent = data.products.total;
        document.getElementById('productsSub').textContent =
          data.products.with_prices + ' z cenami';

        // Promocje
        document.getElementById('promosTotal').textContent = data.products.promos;

        // Newsy
        document.getElementById('newsTotal').textContent = data.news.total;
        document.getElementById('newsSub').textContent =
          data.news.today + ' dziś · ' + data.news.summarized + ' z AI';

        // Agenci
        renderAgentHistory(data.agents);

        // Status badge
        const badge = document.getElementById('statusBadge');
        badge.textContent = 'Online';
        badge.className = 'status ok';

        // Czas odświeżenia
        document.getElementById('lastRefresh').textContent =
          new Date().toLocaleTimeString('pl-PL');
      } catch (err) {
        console.error('Błąd ładowania statystyk:', err);
        const badge = document.getElementById('statusBadge');
        badge.textContent = 'Błąd połączenia';
        badge.className = 'status err';
      }
    }

    // === Ładowanie wykresu ===
    async function loadChart(category) {
      try {
        const res = await fetch('/api/prices/chart/' + category);
        const data = await res.json();

        priceChart.data.labels = data.map((d) => {
          const date = new Date(d.date);
          return date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
        });
        priceChart.data.datasets[0].data = data.map((d) => Number(d.avg_price));
        priceChart.data.datasets[1].data = data.map((d) => Number(d.min_price));
        priceChart.data.datasets[2].data = data.map((d) => Number(d.max_price));
        priceChart.update();
      } catch (err) {
        console.error('Błąd ładowania wykresu:', err);
      }
    }

    // === Renderowanie historii agentów ===
    function renderAgentHistory(agents) {
      const list = document.getElementById('agentList');
      if (!agents || agents.length === 0) {
        list.innerHTML = '<li style="color:#64748b">Brak uruchomień agentów</li>';
        return;
      }

      // Odwróć — najnowsze na górze
      const sorted = [...agents].reverse();
      list.innerHTML = sorted.map((a) => {
        const ok = a.result && a.result.success;
        const statusClass = ok ? 'ok' : 'fail';
        const statusText = ok ? 'OK' : 'Błąd';
        const started = new Date(a.startedAt).toLocaleString('pl-PL', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const duration = a.finishedAt
          ? ((new Date(a.finishedAt) - new Date(a.startedAt)) / 1000).toFixed(1) + 's'
          : '...';
        const msg = a.result ? a.result.message : '';
        return '<li>' +
          '<span class="agent-name">' + a.agent + '</span>' +
          '<span class="agent-time">' + started + ' · ' + duration + '</span>' +
          '<span class="agent-status ' + statusClass + '">' + statusText + '</span>' +
          (msg ? '<span class="agent-msg">' + msg + '</span>' : '') +
          '</li>';
      }).join('');
    }

    // === Ręczne uruchamianie agentów ===
    async function runAgent(name) {
      const btn = document.querySelector('[data-agent="' + name + '"]');
      if (!btn) return;

      btn.disabled = true;
      btn.classList.add('running');
      const originalText = btn.textContent;
      btn.textContent = '⏳ ' + name + '...';

      try {
        const res = await fetch('/agents/' + name, { method: 'POST' });
        const data = await res.json();
        btn.textContent = (data.success ? '✅' : '❌') + ' ' + originalText.replace(/^[^ ]+ /, '');
        // Odśwież statystyki po uruchomieniu agenta
        setTimeout(() => { loadStats(); loadChart(currentCategory); }, 1000);
      } catch (err) {
        btn.textContent = '❌ Błąd';
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.classList.remove('running');
          btn.textContent = originalText;
        }, 3000);
      }
    }
  </script>
</body>
</html>`;
}

/**
 * Główna funkcja startowa
 */
async function main(): Promise<void> {
  logger.info('🏗️ ================================');
  logger.info('🏗️  Budowlaniec Bot v2.0');
  logger.info('🏗️  Telegram + Multi-Agent');
  logger.info('🏗️  Monitoring cen materiałów');
  logger.info('🏗️  budowlanych w Polsce');
  logger.info('🏗️ ================================');

  // Konfiguracja graceful shutdown
  setupGracefulShutdown();

  // 1. Sprawdź połączenie z bazą danych
  const dbOk = await checkConnection();
  if (!dbOk) {
    logger.error('❌ Brak połączenia z bazą danych. Upewnij się, że PostgreSQL działa.');
    process.exit(1);
  }

  // 2. Uruchom migracje
  await runMigrations();

  // 3. Uruchom health check server
  startHealthServer();

  // 4. Uruchom bota Telegram
  logger.info('🤖 Łączę z Telegram...');
  await startTelegramBot();

  // 5. Uruchom koordynatora agentów
  coordinator.start();

  logger.info('✅ Budowlaniec Bot v2.0 gotowy do pracy!');
}

// Uruchomienie
main().catch((error) => {
  logger.error('💥 Krytyczny błąd uruchamiania:', error);
  process.exit(1);
});
