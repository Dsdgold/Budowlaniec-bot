/**
 * Spektra Agent Network v3.0
 * Zunifikowana sieć agentów — Budowlaniec Bot + BuildLeads + Analytics
 * Hetzner deployment ready
 */
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { config, KATEGORIE, KATEGORIE_LABELS, Kategoria } from './config';
import { startTelegramBot, stopTelegramBot, isBotRunning } from './telegram/bot';
import { messageSender } from './telegram/sender';
import * as coordinator from './agents/coordinator';
import { agentNetwork } from './core/network';
import { eventBus } from './core/events';
import { pool, checkConnection, closePool, query } from './db/client';
import { getUserStats, findUserByPhone, getUserPreferences, setUserPreferences } from './db/users';
import { getProductStats, getChartData, getLatestPrices, getPriceChanges24h, getPriceDropsRanking, getBestPromos, getSellerRanking, getCategoryTrend, getUserAlerts, createKeywordAlert } from './db/prices';
import { getNewsStats, getSummarizedArticles } from './db/news';
import logger from './utils/logger';

// ─── MIGRACJE ──────────────────────────────────────────────

async function runMigrations(): Promise<void> {
  logger.info('🔄 Sprawdzam migracje bazy danych...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const executed = await pool.query('SELECT filename FROM migrations ORDER BY id');
  const executedFiles = new Set(executed.rows.map((r: any) => r.filename));

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

// ─── SERWER HTTP + API + WEBSOCKET ─────────────────────────

function startServer(): http.Server {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // ─── HEALTH & METRICS ───

  app.get('/health', async (_req, res) => {
    const dbOk = await checkConnection();
    const botOk = isBotRunning();
    const status = dbOk && botOk ? 'healthy' : 'degraded';

    res.status(dbOk ? 200 : 503).json({
      status,
      version: agentNetwork.version,
      timestamp: new Date().toISOString(),
      services: {
        database: dbOk ? 'ok' : 'error',
        telegram: botOk ? 'connected' : 'disconnected',
        messageQueue: messageSender.pending,
        agents: agentNetwork.getAllAgents().length,
      },
    });
  });

  app.get('/metrics', async (_req, res) => {
    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      messageQueueSize: messageSender.pending,
      agentHistory: coordinator.getRunHistory().slice(-10),
    });
  });

  // ─── AGENT NETWORK API ───

  // Status całej sieci agentów
  app.get('/api/network', (_req, res) => {
    res.json(agentNetwork.getStatus());
  });

  // Lista agentów ze szczegółami
  app.get('/api/agents', (_req, res) => {
    const agents = agentNetwork.getAllAgents().map((a) => a.toJSON());
    res.json(agents);
  });

  // Szczegóły konkretnego agenta
  app.get('/api/agents/:name', (req, res) => {
    const agent = agentNetwork.getAgent(req.params.name);
    if (!agent) {
      res.status(404).json({ error: `Agent "${req.params.name}" nie istnieje` });
      return;
    }
    res.json({
      ...agent.toJSON(),
      history: agent.history.slice(-20),
    });
  });

  // Uruchom agenta
  app.post('/api/agents/:name/run', async (req, res) => {
    const agent = agentNetwork.getAgent(req.params.name);
    if (!agent) {
      res.status(404).json({ error: `Agent "${req.params.name}" nie istnieje` });
      return;
    }
    const result = await agent.run();
    res.json(result);
  });

  // Włącz/wyłącz agenta
  app.post('/api/agents/:name/toggle', (req, res) => {
    const agent = agentNetwork.getAgent(req.params.name);
    if (!agent) {
      res.status(404).json({ error: `Agent "${req.params.name}" nie istnieje` });
      return;
    }
    if (agent.enabled) {
      agent.disable();
    } else {
      agent.enable();
    }
    res.json(agent.toJSON());
  });

  // Logi sieci
  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    const source = req.query.source as string | undefined;
    const level = req.query.level as string | undefined;
    res.json(eventBus.getLogs({ limit, source, level }));
  });

  // ─── KOMPATYBILNOŚĆ WSTECZNA: /agents/:name ───

  app.post('/agents/:name', async (req, res) => {
    const name = req.params.name as any;
    const valid = ['price', 'news', 'morning_report', 'evening_report', 'maintenance', 'leads', 'monitor', 'analytics'];
    if (!valid.includes(name)) {
      res.status(400).json({ error: `Nieznany agent. Dostępne: ${valid.join(', ')}` });
      return;
    }
    const result = await coordinator.runManual(name);
    res.json(result);
  });

  app.post('/agents/run-all', async (_req, res) => {
    const results = await agentNetwork.runAll();
    res.json(results);
  });

  // ─── DATA API ───

  app.get('/api/stats', async (_req, res) => {
    try {
      const [users, products, news] = await Promise.all([
        getUserStats(),
        getProductStats(),
        getNewsStats(),
      ]);
      const agents = coordinator.getRunHistory().slice(-20);

      // Dodaj dane leadów i insights
      let leads = { total: 0, new: 0, today: 0 };
      let insights = { total: 0, today: 0 };
      try {
        const leadsResult = await query(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'new') as new,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today
          FROM build_leads
        `);
        if (leadsResult[0]) leads = leadsResult[0];
      } catch { /* tabela może nie istnieć */ }

      try {
        const insightsResult = await query(`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today
          FROM analytics_insights
        `);
        if (insightsResult[0]) insights = insightsResult[0];
      } catch { /* tabela może nie istnieć */ }

      res.json({ users, products, news, agents, leads, insights });
    } catch (error) {
      logger.error('❌ [API] Błąd /api/stats:', error);
      res.status(500).json({ error: 'Błąd pobierania statystyk' });
    }
  });

  // Leady
  app.get('/api/leads', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const category = req.query.category as string;
      let sql = 'SELECT * FROM build_leads WHERE 1=1';
      const params: any[] = [];

      if (category) {
        params.push(category);
        sql += ` AND category = $${params.length}`;
      }

      sql += ' ORDER BY created_at DESC';
      params.push(limit);
      sql += ` LIMIT $${params.length}`;

      const data = await query(sql, params);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Błąd pobierania leadów' });
    }
  });

  // Insights
  app.get('/api/insights', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const data = await query(
        'SELECT * FROM analytics_insights ORDER BY created_at DESC LIMIT $1',
        [limit],
      );
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Błąd pobierania insights' });
    }
  });

  // ─── CHART / PRICES API ───

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
      res.status(500).json({ error: 'Błąd pobierania danych wykresu' });
    }
  });

  app.get('/api/categories', (_req, res) => {
    const cats = KATEGORIE.map((slug) => ({ slug, label: KATEGORIE_LABELS[slug] }));
    res.json(cats);
  });

  // ─── WEBAPP API ───

  app.get('/webapp', (_req, res) => {
    const webappPath = path.join(__dirname, 'webapp', 'index.html');
    res.sendFile(webappPath);
  });

  app.get('/api/webapp/prices/:category', async (req, res) => {
    try {
      const category = req.params.category as Kategoria;
      if (!KATEGORIE.includes(category)) {
        res.status(400).json({ error: `Nieznana kategoria: ${category}` });
        return;
      }
      const prices = await getLatestPrices(category, 50);
      const changes = await getPriceChanges24h(category);
      const changeMap = new Map<string, number>();
      for (const c of changes) changeMap.set(c.product_name, c.change_percent);

      const result = prices.map((p: any) => ({
        name: p.product_name || p.name,
        price: Number(p.price),
        seller_slug: p.seller_slug,
        is_promo: p.is_promo,
        original_price: p.original_price ? Number(p.original_price) : null,
        url: p.url || null,
        change_percent: changeMap.get(p.product_name || p.name) || null,
      }));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Błąd pobierania cen' });
    }
  });

  app.get('/api/webapp/news', async (_req, res) => {
    try {
      const articles = await getSummarizedArticles(48, 30);
      res.json(articles.map((a) => ({
        title: a.title,
        summary: a.summary,
        url: a.url,
        source_name: a.source_name,
        published_at: a.published_at,
      })));
    } catch (error) {
      res.status(500).json({ error: 'Błąd pobierania newsów' });
    }
  });

  app.get('/api/webapp/trends/:category', async (req, res) => {
    try {
      const category = req.params.category as Kategoria;
      if (!KATEGORIE.includes(category)) {
        res.status(400).json({ error: `Nieznana kategoria: ${category}` });
        return;
      }
      const days = parseInt(req.query.period as string) || 7;
      const data = await getChartData(category, days);
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Błąd pobierania trendów' });
    }
  });

  app.get('/api/webapp/ranking/drops', async (_req, res) => {
    try { res.json(await getPriceDropsRanking(20)); }
    catch { res.status(500).json({ error: 'Błąd' }); }
  });

  app.get('/api/webapp/ranking/promos', async (_req, res) => {
    try { res.json(await getBestPromos(20)); }
    catch { res.status(500).json({ error: 'Błąd' }); }
  });

  app.get('/api/webapp/ranking/sellers', async (_req, res) => {
    try { res.json(await getSellerRanking()); }
    catch { res.status(500).json({ error: 'Błąd' }); }
  });

  app.get('/api/webapp/profile', async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) { res.status(400).json({ error: 'Brak tg_id' }); return; }
      const user = await findUserByPhone(tgId);
      if (!user) { res.json({ name: null, is_pro: false, categories: [], ai_queries_today: 0 }); return; }
      const prefs = await getUserPreferences(user.id);
      res.json({
        name: user.name, is_pro: user.is_pro, region: user.region,
        categories: prefs.map((p) => p.category_slug),
        ai_queries_today: user.ai_queries_today,
        daily_report_time: user.daily_report_time,
      });
    } catch (error) {
      res.status(500).json({ error: 'Błąd profilu' });
    }
  });

  app.get('/api/webapp/profile/alerts', async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) { res.status(400).json({ error: 'Brak tg_id' }); return; }
      const user = await findUserByPhone(tgId);
      if (!user) { res.json([]); return; }
      res.json(await getUserAlerts(user.id));
    } catch (error) {
      res.status(500).json({ error: 'Błąd alertów' });
    }
  });

  app.post('/api/webapp/profile/categories', async (req, res) => {
    try {
      const { tg_id, categories } = req.body;
      if (!tg_id || !Array.isArray(categories)) {
        res.status(400).json({ error: 'Brak tg_id lub categories' }); return;
      }
      const user = await findUserByPhone(tg_id.toString());
      if (!user) { res.status(404).json({ error: 'Użytkownik nie znaleziony' }); return; }
      const validCats = categories.filter((c: string) => KATEGORIE.includes(c as Kategoria)) as Kategoria[];
      await setUserPreferences(user.id, validCats);
      res.json({ success: true, categories: validCats });
    } catch (error) {
      res.status(500).json({ error: 'Błąd zapisu' });
    }
  });

  app.post('/api/webapp/alerts', async (req, res) => {
    try {
      const { tg_id, keyword, target_price } = req.body;
      if (!tg_id || !keyword || !target_price) {
        res.status(400).json({ error: 'Brak wymaganych pól' }); return;
      }
      const user = await findUserByPhone(tg_id.toString());
      if (!user) { res.status(404).json({ error: 'Użytkownik nie znaleziony' }); return; }
      await createKeywordAlert(user.id, keyword, target_price);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Błąd tworzenia alertu' });
    }
  });

  app.delete('/api/webapp/alerts/:id', async (req, res) => {
    try {
      const tgId = req.query.tg_id as string;
      if (!tgId) { res.status(400).json({ error: 'Brak tg_id' }); return; }
      const user = await findUserByPhone(tgId);
      if (!user) { res.status(404).json({ error: 'Nie znaleziony' }); return; }
      await query(
        'UPDATE keyword_alerts SET is_active = FALSE WHERE id = $1 AND user_id = $2',
        [req.params.id, user.id],
      );
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Błąd usuwania alertu' });
    }
  });

  // ─── CONTENT API ───

  // Social media posts
  app.get('/api/content/posts', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const posts = await query(
        'SELECT * FROM social_posts ORDER BY created_at DESC LIMIT $1', [limit]
      );
      res.json(posts);
    } catch { res.json([]); }
  });

  // Blog articles
  app.get('/api/content/articles', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const articles = await query(
        'SELECT id, title, slug, excerpt, category, tags, views, created_at FROM blog_articles WHERE published = true ORDER BY created_at DESC LIMIT $1', [limit]
      );
      res.json(articles);
    } catch { res.json([]); }
  });

  app.get('/api/content/articles/:slug', async (req, res) => {
    try {
      const articles = await query('SELECT * FROM blog_articles WHERE slug = $1', [req.params.slug]);
      if (articles.length === 0) { res.status(404).json({ error: 'Nie znaleziono' }); return; }
      await query('UPDATE blog_articles SET views = views + 1 WHERE slug = $1', [req.params.slug]);
      res.json(articles[0]);
    } catch { res.status(500).json({ error: 'Błąd' }); }
  });

  // Newsletter subscribe
  app.post('/api/subscribe', async (req, res) => {
    try {
      const { email, name } = req.body;
      if (!email) { res.status(400).json({ error: 'Brak email' }); return; }
      await query(
        'INSERT INTO email_subscribers (email, name) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
        [email, name || null]
      );
      res.json({ success: true, message: 'Zapisano do newslettera!' });
    } catch { res.status(500).json({ error: 'Błąd zapisu' }); }
  });

  app.get('/api/subscribers/count', async (_req, res) => {
    try {
      const r = await query('SELECT COUNT(*) as cnt FROM email_subscribers WHERE is_active = true');
      res.json({ count: r[0]?.cnt || 0 });
    } catch { res.json({ count: 0 }); }
  });

  // ─── NOTIFICATIONS API (dla PWA Android) ───

  app.get('/api/notifications', async (req, res) => {
    try {
      const since = parseInt(req.query.since as string) || Date.now() - 300000; // ostatnie 5 min
      const sinceDate = new Date(since);
      const notifications: Array<{ title: string; body: string; tag: string; at: Date }> = [];

      // Nowo wdrożone taski
      try {
        const applied = await query(
          `SELECT id, title, type, source, updated_at FROM code_tasks
           WHERE status = 'applied' AND updated_at > $1
           ORDER BY updated_at DESC LIMIT 5`,
          [sinceDate],
        );
        for (const t of applied) {
          notifications.push({
            title: `⚡ Wdrożono: ${t.title}`,
            body: `${t.source} → ${t.type}`,
            tag: `applied-${t.id}`,
            at: t.updated_at,
          });
        }
      } catch {}

      // Nowe pomysły w review
      try {
        const review = await query(
          `SELECT id, title, source, created_at FROM code_tasks
           WHERE status = 'review' AND created_at > $1
           ORDER BY created_at DESC LIMIT 3`,
          [sinceDate],
        );
        for (const t of review) {
          notifications.push({
            title: `👁️ Nowy pomysł: ${t.title}`,
            body: `Źródło: ${t.source}`,
            tag: `review-${t.id}`,
            at: t.created_at,
          });
        }
      } catch {}

      // Agent errors
      const agents = agentNetwork.getAllAgents();
      for (const agent of agents) {
        if (agent.metrics.lastResult && !agent.metrics.lastResult.success && agent.metrics.lastRunAt) {
          if (agent.metrics.lastRunAt.getTime() > since) {
            notifications.push({
              title: `❌ ${agent.name} ERROR`,
              body: agent.metrics.lastResult.message.substring(0, 100),
              tag: `error-${agent.name}`,
              at: agent.metrics.lastRunAt,
            });
          }
        }
      }

      // Nowi agenci zarejestrowani
      const agentCount = agents.length;
      if (agentCount > 14) {
        notifications.push({
          title: `🤖 Nowy agent w sieci!`,
          body: `Sieć ma teraz ${agentCount} agentów`,
          tag: `agents-${agentCount}`,
          at: new Date(),
        });
      }

      res.json({ notifications, count: notifications.length, since: sinceDate });
    } catch (error) {
      res.status(500).json({ notifications: [], error: 'Błąd' });
    }
  });

  // ─── PRICING API ───

  app.get('/api/pricing', (_req, res) => {
    const { PRICING_PLANS } = require('./config');
    res.json(PRICING_PLANS);
  });

  app.get('/api/pricing/:plan', (req, res) => {
    const { PRICING_PLANS } = require('./config');
    const plan = PRICING_PLANS[req.params.plan as keyof typeof PRICING_PLANS];
    if (!plan) { res.status(404).json({ error: 'Plan nie istnieje' }); return; }
    res.json(plan);
  });

  // ─── EVOLUTION API ───

  // Lista task queue
  app.get('/api/evolution/tasks', async (req, res) => {
    try {
      const status = req.query.status as string;
      let sql = 'SELECT * FROM code_tasks';
      const params: any[] = [];
      if (status) { params.push(status); sql += ` WHERE status = $${params.length}`; }
      sql += ' ORDER BY created_at DESC LIMIT 50';
      res.json(await query(sql, params));
    } catch (error) { res.status(500).json({ error: 'Błąd' }); }
  });

  // Szczegóły zadania
  app.get('/api/evolution/tasks/:id', async (req, res) => {
    try {
      const data = await query('SELECT * FROM code_tasks WHERE id = $1', [req.params.id]);
      if (data.length === 0) { res.status(404).json({ error: 'Nie znaleziono' }); return; }
      res.json(data[0]);
    } catch (error) { res.status(500).json({ error: 'Błąd' }); }
  });

  // Utwórz nowe zadanie (ręcznie z dashboardu)
  app.post('/api/evolution/tasks', async (req, res) => {
    try {
      const { type, title, description, priority } = req.body;
      if (!title) { res.status(400).json({ error: 'Brak tytułu' }); return; }
      const result = await query(
        `INSERT INTO code_tasks (type, title, description, priority, source, status)
         VALUES ($1, $2, $3, $4, 'dashboard', 'pending') RETURNING *`,
        [type || 'improvement', title, description || '', priority || 'medium'],
      );
      res.json(result[0]);
    } catch (error) { res.status(500).json({ error: 'Błąd tworzenia zadania' }); }
  });

  // Zatwierdź zadanie
  app.post('/api/evolution/tasks/:id/approve', async (req, res) => {
    try {
      await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['approved', req.params.id]);
      eventBus.log('success', 'API', `Zadanie #${req.params.id} zatwierdzone`);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Błąd' }); }
  });

  // Odrzuć zadanie
  app.post('/api/evolution/tasks/:id/reject', async (req, res) => {
    try {
      await query('UPDATE code_tasks SET status = $1, updated_at = NOW() WHERE id = $2', ['rejected', req.params.id]);
      eventBus.log('info', 'API', `Zadanie #${req.params.id} odrzucone`);
      res.json({ success: true });
    } catch (error) { res.status(500).json({ error: 'Błąd' }); }
  });

  // Statystyki ewolucji
  app.get('/api/evolution/stats', async (_req, res) => {
    try {
      const result = await query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'review') as review,
          COUNT(*) FILTER (WHERE status = 'approved') as approved,
          COUNT(*) FILTER (WHERE status = 'applied') as applied,
          COUNT(*) FILTER (WHERE status = 'rejected') as rejected
        FROM code_tasks
      `);
      res.json(result[0] || {});
    } catch (error) { res.status(500).json({ error: 'Błąd' }); }
  });

  // ─── DASHBOARD & LANDING ───

  app.get('/dashboard', (_req, res) => {
    const dashPath = path.join(__dirname, '..', 'public', 'dashboard.html');
    if (fs.existsSync(dashPath)) {
      res.sendFile(dashPath);
    } else {
      res.send('<h1>Dashboard not found. Deploy public/dashboard.html</h1>');
    }
  });

  app.get('/landing', (_req, res) => {
    const landingPath = path.join(__dirname, '..', 'landing-page.html');
    res.sendFile(landingPath);
  });

  app.get('/', (_req, res) => {
    const clientPath = path.join(__dirname, '..', 'public', 'client.html');
    if (fs.existsSync(clientPath)) {
      res.sendFile(clientPath);
    } else {
      res.redirect('/dashboard');
    }
  });

  // ─── START HTTP + WEBSOCKET ───

  const server = http.createServer(app);

  // Inicjalizuj WebSocket na tym samym serwerze
  agentNetwork.initWebSocket(server);

  server.listen(config.PORT, () => {
    logger.info(`🌐 Serwer HTTP+WS na porcie ${config.PORT}`);
  });

  return server;
}

// ─── GRACEFUL SHUTDOWN ─────────────────────────────────────

function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`\n🛑 Otrzymano ${signal} — zamykam...`);

    try {
      stopTelegramBot(signal);
      agentNetwork.stop();
      messageSender.clear();
      await closePool();
      logger.info('👋 Spektra Agent Network zamknięta. Do zobaczenia!');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Błąd podczas zamykania:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (error) => logger.error('💥 Nieobsłużony wyjątek:', error));
  process.on('unhandledRejection', (reason) => logger.error('💥 Nieobsłużona obietnica:', reason));
}

// ─── MAIN ──────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('⚡ ════════════════════════════════════');
  logger.info('⚡  Spektra Agent Network v3.0');
  logger.info('⚡  Budowlaniec + BuildLeads + Analytics');
  logger.info('⚡  Hetzner Deployment');
  logger.info('⚡ ════════════════════════════════════');

  setupGracefulShutdown();

  // 1. Baza danych
  const dbOk = await checkConnection();
  if (!dbOk) {
    logger.error('❌ Brak połączenia z bazą danych');
    process.exit(1);
  }

  // 2. Migracje
  await runMigrations();

  // 3. Serwer HTTP + WebSocket
  startServer();

  // 4. Sieć agentów (PRZED Telegramem — bot.launch() blokuje)
  coordinator.start();

  // 5. Telegram Bot (nie-blokujący — launch w tle)
  logger.info('🤖 Łączę z Telegram...');
  startTelegramBot().then(() => {
    logger.info('✅ Bot Telegram połączony');
  }).catch((error) => {
    logger.error('❌ Błąd Telegram (kontynuuję bez bota):', error);
  });

  logger.info('✅ Spektra Agent Network v3.0 gotowa!');
  eventBus.log('success', 'System', 'Spektra Agent Network uruchomiona pomyślnie');
}

main().catch((error) => {
  logger.error('💥 Krytyczny błąd:', error);
  process.exit(1);
});
