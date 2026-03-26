-- ============================================================
-- Migracja 002: Rozszerzenie alertów cenowych i widoki trendów
-- Budowlaniec Bot v2.1 — nowe funkcje
-- ============================================================

-- === Alerty cenowe po nazwie produktu (keyword) ===
-- Istniejąca tabela price_alerts wymaga product_id
-- Dodajemy nową tabelę dla alertów po słowie kluczowym
CREATE TABLE IF NOT EXISTS keyword_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    keyword VARCHAR(200) NOT NULL,                  -- Szukana fraza, np. "cement"
    category_slug VARCHAR(50) REFERENCES categories(slug),  -- Opcjonalna kategoria
    target_price DECIMAL(12,2) NOT NULL,           -- Cena docelowa
    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, keyword)
);

-- === Widok: trend cenowy kategorii (ostatnie 30 dni) ===
CREATE OR REPLACE VIEW category_price_trend AS
SELECT
    p.category_slug,
    DATE(ph.scraped_at) AS date,
    ROUND(AVG(ph.price)::numeric, 2) AS avg_price,
    COUNT(DISTINCT ph.product_id) AS product_count,
    MIN(ph.price) AS min_price,
    MAX(ph.price) AS max_price
FROM price_history ph
JOIN products p ON p.id = ph.product_id
WHERE ph.scraped_at > NOW() - INTERVAL '30 days'
  AND p.is_active = TRUE
GROUP BY p.category_slug, DATE(ph.scraped_at)
ORDER BY p.category_slug, DATE(ph.scraped_at);

-- === Widok: ranking spadków cen (24h) ===
CREATE OR REPLACE VIEW price_drops_ranking AS
WITH current_prices AS (
    SELECT DISTINCT ON (product_id)
        product_id, price, is_promo, scraped_at
    FROM price_history
    ORDER BY product_id, scraped_at DESC
),
previous_prices AS (
    SELECT DISTINCT ON (product_id)
        product_id, price AS prev_price
    FROM price_history
    WHERE scraped_at < NOW() - INTERVAL '12 hours'
    ORDER BY product_id, scraped_at DESC
)
SELECT
    cp.product_id,
    p.name AS product_name,
    p.seller_slug,
    p.category_slug,
    pp.prev_price,
    cp.price AS current_price,
    ROUND(((cp.price - pp.prev_price) / pp.prev_price * 100)::numeric, 2) AS change_percent,
    (pp.prev_price - cp.price) AS price_drop,
    cp.is_promo,
    cp.scraped_at
FROM current_prices cp
JOIN previous_prices pp ON cp.product_id = pp.product_id
JOIN products p ON p.id = cp.product_id
WHERE cp.price < pp.prev_price
ORDER BY change_percent ASC;

-- Indeks na keyword_alerts
CREATE INDEX IF NOT EXISTS idx_keyword_alerts_active
    ON keyword_alerts(is_active, keyword);
