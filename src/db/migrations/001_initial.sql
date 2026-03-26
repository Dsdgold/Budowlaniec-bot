-- ============================================================
-- Migracja początkowa: pełna struktura bazy danych
-- Budowlaniec Bot - monitoring cen materiałów budowlanych
-- ============================================================

-- Rozszerzenie do generowania UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- === Tabela użytkowników ===
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone VARCHAR(20) UNIQUE NOT NULL,          -- Numer telefonu WhatsApp (z kodem kraju)
    name VARCHAR(100),                           -- Nazwa użytkownika
    is_pro BOOLEAN DEFAULT FALSE,                -- Czy ma konto PRO
    pro_expires_at TIMESTAMP,                    -- Data wygaśnięcia PRO
    region VARCHAR(50) DEFAULT 'mazowieckie',    -- Region użytkownika
    is_active BOOLEAN DEFAULT TRUE,              -- Czy aktywny (nie zablokowany)
    onboarding_complete BOOLEAN DEFAULT FALSE,   -- Czy przeszedł onboarding
    daily_report_time VARCHAR(5) DEFAULT '07:00',-- Preferowana godzina raportu
    ai_queries_today INTEGER DEFAULT 0,          -- Licznik pytań AI (resetowany co noc)
    ai_queries_reset_date DATE DEFAULT CURRENT_DATE, -- Data ostatniego resetu
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- === Kategorie materiałów ===
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,       -- Identyfikator: cement, stal, drewno...
    name VARCHAR(100) NOT NULL,             -- Nazwa po polsku
    icon VARCHAR(10),                        -- Emoji ikona
    created_at TIMESTAMP DEFAULT NOW()
);

-- Wstawienie domyślnych kategorii
INSERT INTO categories (slug, name, icon) VALUES
    ('cement', 'Cement i beton', '🧱'),
    ('stal', 'Stal i metale', '🔩'),
    ('drewno', 'Drewno', '🪵'),
    ('izolacja', 'Izolacja', '🧊'),
    ('ceramika', 'Ceramika i płytki', '🏺'),
    ('chemia-budowlana', 'Chemia budowlana', '🧪'),
    ('instalacje', 'Instalacje', '🔧'),
    ('dachy', 'Dachy', '🏠'),
    ('okna-drzwi', 'Okna i drzwi', '🪟'),
    ('narzedzia', 'Narzędzia', '🛠️')
ON CONFLICT (slug) DO NOTHING;

-- === Sklepy/sprzedawcy ===
CREATE TABLE IF NOT EXISTS sellers (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,       -- Identyfikator: castorama, leroy...
    name VARCHAR(100) NOT NULL,             -- Nazwa sklepu
    base_url VARCHAR(255) NOT NULL,         -- URL bazowy
    is_active BOOLEAN DEFAULT TRUE,         -- Czy scraper aktywny
    last_scraped_at TIMESTAMP,              -- Ostatni scraping
    created_at TIMESTAMP DEFAULT NOW()
);

-- Wstawienie domyślnych sklepów
INSERT INTO sellers (slug, name, base_url) VALUES
    ('castorama', 'Castorama', 'https://www.castorama.pl'),
    ('leroy', 'Leroy Merlin', 'https://www.leroymerlin.pl'),
    ('trzyw', '3W', 'https://3wdb.pl'),
    ('bechcicki', 'Bechcicki', 'https://www.bechcicki.pl')
ON CONFLICT (slug) DO NOTHING;

-- === Preferencje użytkowników ===
CREATE TABLE IF NOT EXISTS user_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_slug VARCHAR(50) NOT NULL REFERENCES categories(slug),
    notify_on_change BOOLEAN DEFAULT TRUE,   -- Powiadamiaj o zmianach cen
    price_drop_threshold DECIMAL(5,2) DEFAULT 5.00, -- Próg powiadomienia o spadku (%)
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, category_slug)
);

-- === Produkty ===
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seller_slug VARCHAR(50) NOT NULL REFERENCES sellers(slug),
    category_slug VARCHAR(50) NOT NULL REFERENCES categories(slug),
    external_id VARCHAR(255),                -- ID produktu w sklepie
    name VARCHAR(500) NOT NULL,              -- Nazwa produktu
    url VARCHAR(1000),                       -- Link do produktu
    unit VARCHAR(50),                        -- Jednostka: szt, m2, kg, m3...
    image_url VARCHAR(1000),                 -- URL zdjęcia
    is_active BOOLEAN DEFAULT TRUE,          -- Czy produkt nadal dostępny
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(seller_slug, external_id)
);

-- === Historia cen ===
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price DECIMAL(12,2) NOT NULL,            -- Cena w PLN
    original_price DECIMAL(12,2),            -- Cena przed promocją
    is_promo BOOLEAN DEFAULT FALSE,          -- Czy cena promocyjna
    scraped_at TIMESTAMP DEFAULT NOW()
);

-- Indeks na datę scrapowania (szybkie zapytania o ostatnią cenę)
CREATE INDEX IF NOT EXISTS idx_price_history_product_date
    ON price_history(product_id, scraped_at DESC);

-- === Alerty cenowe ===
CREATE TABLE IF NOT EXISTS price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    target_price DECIMAL(12,2),              -- Cena docelowa (powiadom gdy spadnie poniżej)
    alert_type VARCHAR(20) DEFAULT 'drop',   -- Typ: drop, any_change, promo
    is_active BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, product_id, alert_type)
);

-- === Artykuły/newsy ===
CREATE TABLE IF NOT EXISTS news_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_name VARCHAR(100) NOT NULL,       -- Nazwa źródła: WNP, Bankier...
    title VARCHAR(500) NOT NULL,             -- Tytuł artykułu
    url VARCHAR(1000) UNIQUE NOT NULL,       -- Link do artykułu
    summary TEXT,                             -- Podsumowanie AI
    content TEXT,                             -- Treść (jeśli scraping)
    category VARCHAR(100),                   -- Kategoria artykułu
    published_at TIMESTAMP,                  -- Data publikacji
    fetched_at TIMESTAMP DEFAULT NOW(),
    is_summarized BOOLEAN DEFAULT FALSE      -- Czy AI podsumował
);

-- Indeks na datę publikacji
CREATE INDEX IF NOT EXISTS idx_news_published
    ON news_articles(published_at DESC);

-- === Log wiadomości ===
CREATE TABLE IF NOT EXISTS message_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    phone VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,          -- 'in' lub 'out'
    message_type VARCHAR(20) DEFAULT 'text', -- text, command, report, alert
    content TEXT,
    command VARCHAR(50),                     -- Komenda jeśli to komenda
    sent_at TIMESTAMP DEFAULT NOW()
);

-- Indeks na telefon i datę
CREATE INDEX IF NOT EXISTS idx_message_log_phone
    ON message_log(phone, sent_at DESC);

-- === Płatności (PRO) ===
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,           -- Kwota w PLN
    currency VARCHAR(3) DEFAULT 'PLN',
    payment_method VARCHAR(50),              -- blik, przelew, karta
    status VARCHAR(20) DEFAULT 'pending',    -- pending, completed, failed, refunded
    external_id VARCHAR(255),                -- ID płatności w systemie zewnętrznym
    pro_months INTEGER DEFAULT 1,            -- Ile miesięcy PRO zakupiono
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- === Funkcja automatycznej aktualizacji updated_at ===
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggery do automatycznej aktualizacji timestamps
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- === Widok: najnowsze ceny produktów ===
CREATE OR REPLACE VIEW latest_prices AS
SELECT DISTINCT ON (ph.product_id)
    ph.product_id,
    p.name AS product_name,
    p.seller_slug,
    p.category_slug,
    p.unit,
    p.url,
    ph.price,
    ph.original_price,
    ph.is_promo,
    ph.scraped_at
FROM price_history ph
JOIN products p ON p.id = ph.product_id
WHERE p.is_active = TRUE
ORDER BY ph.product_id, ph.scraped_at DESC;

-- === Widok: zmiany cen w ciągu ostatnich 24h ===
CREATE OR REPLACE VIEW price_changes_24h AS
WITH current_prices AS (
    SELECT DISTINCT ON (product_id)
        product_id, price, scraped_at
    FROM price_history
    ORDER BY product_id, scraped_at DESC
),
previous_prices AS (
    SELECT DISTINCT ON (product_id)
        product_id, price AS prev_price, scraped_at AS prev_scraped_at
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
    cp.scraped_at
FROM current_prices cp
JOIN previous_prices pp ON cp.product_id = pp.product_id
JOIN products p ON p.id = cp.product_id
WHERE cp.price != pp.prev_price;

-- === Cache odpowiedzi AI (minimalizacja tokenów) ===
CREATE TABLE IF NOT EXISTS ai_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    query_hash VARCHAR(32) UNIQUE NOT NULL,     -- MD5 hash znormalizowanego pytania
    query_text VARCHAR(500),                     -- Oryginalne pytanie (do debugowania)
    response TEXT NOT NULL,                      -- Odpowiedź AI
    hit_count INTEGER DEFAULT 1,                 -- Ile razy cache trafiony
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indeks na hash (szybki lookup)
CREATE INDEX IF NOT EXISTS idx_ai_cache_hash
    ON ai_cache(query_hash);

-- Indeks na datę (czyszczenie starego cache)
CREATE INDEX IF NOT EXISTS idx_ai_cache_date
    ON ai_cache(created_at);
