/**
 * Operacje na cenach produktów i historii cen
 */
import { query, transaction } from './client';
import { Kategoria } from '../config';
import logger from '../utils/logger';

/** Dane produktu z ceną */
export interface ProductWithPrice {
  id: string;
  seller_slug: string;
  category_slug: Kategoria;
  name: string;
  url: string | null;
  unit: string | null;
  price: number;
  original_price: number | null;
  is_promo: boolean;
  scraped_at: Date;
}

/** Zmiana ceny produktu */
export interface PriceChange {
  product_id: string;
  product_name: string;
  seller_slug: string;
  category_slug: string;
  prev_price: number;
  current_price: number;
  change_percent: number;
  scraped_at: Date;
}

/** Dane scrapowanego produktu (wejście) */
export interface ScrapedProduct {
  sellerSlug: string;
  categorySlug: Kategoria;
  externalId: string;
  name: string;
  price: number;
  originalPrice?: number;
  isPromo?: boolean;
  url?: string;
  unit?: string;
  imageUrl?: string;
}

/**
 * Wstaw lub zaktualizuj produkt i zapisz nową cenę
 */
export async function upsertProductPrice(data: ScrapedProduct): Promise<void> {
  await transaction(async (client) => {
    // Upsert produktu
    const productResult = await client.query(
      `INSERT INTO products (seller_slug, category_slug, external_id, name, url, unit, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (seller_slug, external_id) DO UPDATE SET
         name = EXCLUDED.name,
         url = EXCLUDED.url,
         unit = EXCLUDED.unit,
         image_url = EXCLUDED.image_url,
         is_active = TRUE,
         updated_at = NOW()
       RETURNING id`,
      [
        data.sellerSlug,
        data.categorySlug,
        data.externalId,
        data.name,
        data.url || null,
        data.unit || null,
        data.imageUrl || null,
      ]
    );

    const productId = productResult.rows[0].id;

    // Wstaw nowy wpis cenowy
    await client.query(
      `INSERT INTO price_history (product_id, price, original_price, is_promo)
       VALUES ($1, $2, $3, $4)`,
      [productId, data.price, data.originalPrice || null, data.isPromo || false]
    );
  });
}

/**
 * Masowe wstawienie cen (po scrapingu)
 */
export async function bulkUpsertPrices(products: ScrapedProduct[]): Promise<number> {
  let count = 0;
  for (const product of products) {
    try {
      await upsertProductPrice(product);
      count++;
    } catch (error) {
      logger.error(`❌ Błąd zapisu ceny: ${product.name}`, error);
    }
  }
  logger.info(`💾 Zapisano ${count}/${products.length} cen`);
  return count;
}

/**
 * Pobierz najnowsze ceny dla kategorii
 */
export async function getLatestPrices(
  categorySlug: Kategoria,
  limit: number = 20
): Promise<ProductWithPrice[]> {
  return query<ProductWithPrice>(
    `SELECT * FROM latest_prices
     WHERE category_slug = $1
     ORDER BY product_name
     LIMIT $2`,
    [categorySlug, limit]
  );
}

/**
 * Pobierz zmiany cen z ostatnich 24h
 */
export async function getPriceChanges24h(
  categorySlug?: Kategoria
): Promise<PriceChange[]> {
  if (categorySlug) {
    return query<PriceChange>(
      `SELECT * FROM price_changes_24h
       WHERE category_slug = $1
       ORDER BY ABS(change_percent) DESC`,
      [categorySlug]
    );
  }
  return query<PriceChange>(
    `SELECT * FROM price_changes_24h
     ORDER BY ABS(change_percent) DESC
     LIMIT 50`
  );
}

/**
 * Porównanie cen tego samego produktu w różnych sklepach
 */
export async function comparePrices(
  productName: string
): Promise<ProductWithPrice[]> {
  return query<ProductWithPrice>(
    `SELECT * FROM latest_prices
     WHERE LOWER(product_name) LIKE LOWER($1)
     ORDER BY price ASC`,
    [`%${productName}%`]
  );
}

/**
 * Pobierz historię cen produktu (do wykresu)
 */
export async function getPriceHistory(
  productId: string,
  days: number = 30
): Promise<{ price: number; scraped_at: Date }[]> {
  return query(
    `SELECT price, scraped_at
     FROM price_history
     WHERE product_id = $1 AND scraped_at > NOW() - INTERVAL '1 day' * $2
     ORDER BY scraped_at ASC`,
    [productId, days]
  );
}

/**
 * Pobierz produkty z alertami cenowymi do powiadomienia
 */
export async function getTriggeredAlerts(): Promise<
  {
    user_phone: string;
    product_name: string;
    target_price: number;
    current_price: number;
    alert_id: string;
  }[]
> {
  return query(
    `SELECT
       u.phone AS user_phone,
       p.name AS product_name,
       pa.target_price,
       lp.price AS current_price,
       pa.id AS alert_id
     FROM price_alerts pa
     JOIN users u ON u.id = pa.user_id
     JOIN products p ON p.id = pa.product_id
     JOIN latest_prices lp ON lp.product_id = pa.product_id
     WHERE pa.is_active = TRUE
       AND lp.price <= pa.target_price
       AND (pa.last_triggered_at IS NULL
            OR pa.last_triggered_at < NOW() - INTERVAL '24 hours')`
  );
}

/**
 * Oznacz alert jako wyzwolony
 */
export async function markAlertTriggered(alertId: string): Promise<void> {
  await query(
    'UPDATE price_alerts SET last_triggered_at = NOW() WHERE id = $1',
    [alertId]
  );
}

/**
 * Pobierz dane trendu cenowego dla kategorii (ostatnie N dni)
 */
export async function getCategoryTrend(
  categorySlug: Kategoria,
  days: number = 30
): Promise<{ date: string; avg_price: number; product_count: number }[]> {
  return query(
    `SELECT
       DATE(ph.scraped_at) AS date,
       ROUND(AVG(ph.price)::numeric, 2) AS avg_price,
       COUNT(DISTINCT ph.product_id) AS product_count
     FROM price_history ph
     JOIN products p ON p.id = ph.product_id
     WHERE p.category_slug = $1
       AND ph.scraped_at > NOW() - INTERVAL '1 day' * $2
       AND p.is_active = TRUE
     GROUP BY DATE(ph.scraped_at)
     ORDER BY DATE(ph.scraped_at)`,
    [categorySlug, days]
  );
}

/**
 * Utwórz alert cenowy po słowie kluczowym
 */
export async function createKeywordAlert(
  userId: string,
  keyword: string,
  targetPrice: number,
  categorySlug?: Kategoria
): Promise<void> {
  await query(
    `INSERT INTO keyword_alerts (user_id, keyword, target_price, category_slug)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, keyword) DO UPDATE SET
       target_price = EXCLUDED.target_price,
       category_slug = EXCLUDED.category_slug,
       is_active = TRUE`,
    [userId, keyword.toLowerCase(), targetPrice, categorySlug || null]
  );
}

/**
 * Pobierz aktywne alerty użytkownika
 */
export async function getUserAlerts(
  userId: string
): Promise<{ id: string; keyword: string; target_price: number; category_slug: string | null; created_at: Date }[]> {
  return query(
    `SELECT id, keyword, target_price, category_slug, created_at
     FROM keyword_alerts
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC`,
    [userId]
  );
}

/**
 * Usuń alert użytkownika
 */
export async function deleteUserAlert(userId: string, keyword: string): Promise<boolean> {
  const rows = await query(
    `UPDATE keyword_alerts SET is_active = FALSE
     WHERE user_id = $1 AND LOWER(keyword) = LOWER($2) AND is_active = TRUE
     RETURNING id`,
    [userId, keyword]
  );
  return rows.length > 0;
}

/**
 * Sprawdź keyword alerts po scrapingu
 */
export async function getTriggeredKeywordAlerts(): Promise<
  {
    user_phone: string;
    keyword: string;
    target_price: number;
    current_price: number;
    product_name: string;
    seller_slug: string;
    alert_id: string;
  }[]
> {
  return query(
    `SELECT
       u.phone AS user_phone,
       ka.keyword,
       ka.target_price,
       lp.price AS current_price,
       lp.product_name,
       lp.seller_slug,
       ka.id AS alert_id
     FROM keyword_alerts ka
     JOIN users u ON u.id = ka.user_id
     JOIN latest_prices lp ON LOWER(lp.product_name) LIKE '%' || LOWER(ka.keyword) || '%'
     WHERE ka.is_active = TRUE
       AND lp.price <= ka.target_price
       AND (ka.last_triggered_at IS NULL
            OR ka.last_triggered_at < NOW() - INTERVAL '24 hours')
       AND (ka.category_slug IS NULL OR lp.category_slug = ka.category_slug)`
  );
}

/**
 * Oznacz keyword alert jako wyzwolony
 */
export async function markKeywordAlertTriggered(alertId: string): Promise<void> {
  await query(
    'UPDATE keyword_alerts SET last_triggered_at = NOW() WHERE id = $1',
    [alertId]
  );
}

/**
 * Ranking: Top N produktów z największym spadkiem cen (24h)
 */
export async function getPriceDropsRanking(limit: number = 10): Promise<
  {
    product_name: string;
    seller_slug: string;
    category_slug: string;
    prev_price: number;
    current_price: number;
    change_percent: number;
    is_promo: boolean;
  }[]
> {
  return query(
    `WITH current_prices AS (
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
       p.name AS product_name,
       p.seller_slug,
       p.category_slug,
       pp.prev_price,
       cp.price AS current_price,
       ROUND(((cp.price - pp.prev_price) / pp.prev_price * 100)::numeric, 2) AS change_percent,
       cp.is_promo
     FROM current_prices cp
     JOIN previous_prices pp ON cp.product_id = pp.product_id
     JOIN products p ON p.id = cp.product_id
     WHERE cp.price < pp.prev_price
     ORDER BY change_percent ASC
     LIMIT $1`,
    [limit]
  );
}

/**
 * Ranking: Najlepsze promocje (aktywne)
 */
export async function getBestPromos(limit: number = 10): Promise<
  {
    product_name: string;
    seller_slug: string;
    price: number;
    original_price: number;
    discount_percent: number;
  }[]
> {
  return query(
    `SELECT
       p.name AS product_name,
       p.seller_slug,
       lp.price,
       lp.original_price,
       ROUND(((lp.original_price - lp.price) / lp.original_price * 100)::numeric, 1) AS discount_percent
     FROM latest_prices lp
     JOIN products p ON p.id = lp.product_id
     WHERE lp.is_promo = TRUE
       AND lp.original_price IS NOT NULL
       AND lp.original_price > lp.price
     ORDER BY discount_percent DESC
     LIMIT $1`,
    [limit]
  );
}

/**
 * Ranking: Sklepy — średnia cena
 */
export async function getSellerRanking(): Promise<
  {
    seller_slug: string;
    avg_price: number;
    product_count: number;
    promo_count: number;
  }[]
> {
  return query(
    `SELECT
       seller_slug,
       ROUND(AVG(price)::numeric, 2) AS avg_price,
       COUNT(*) AS product_count,
       SUM(CASE WHEN is_promo THEN 1 ELSE 0 END) AS promo_count
     FROM latest_prices
     GROUP BY seller_slug
     ORDER BY avg_price ASC`
  );
}

/**
 * Dane wykresu cen dla dashboardu (API)
 */
export async function getChartData(
  categorySlug: Kategoria,
  days: number = 30
): Promise<{ date: string; avg_price: number; min_price: number; max_price: number }[]> {
  return query(
    `SELECT
       TO_CHAR(DATE(ph.scraped_at), 'YYYY-MM-DD') AS date,
       ROUND(AVG(ph.price)::numeric, 2) AS avg_price,
       MIN(ph.price) AS min_price,
       MAX(ph.price) AS max_price
     FROM price_history ph
     JOIN products p ON p.id = ph.product_id
     WHERE p.category_slug = $1
       AND ph.scraped_at > NOW() - INTERVAL '1 day' * $2
       AND p.is_active = TRUE
     GROUP BY DATE(ph.scraped_at)
     ORDER BY DATE(ph.scraped_at)`,
    [categorySlug, days]
  );
}

/**
 * Statystyki ogólne do dashboardu / API
 */
export async function getDashboardStats(): Promise<{
  products_total: number;
  products_with_prices: number;
  promos_count: number;
}> {
  const rows = await query(
    `SELECT
       (SELECT COUNT(*) FROM products WHERE is_active = TRUE) AS products_total,
       (SELECT COUNT(*) FROM latest_prices) AS products_with_prices,
       (SELECT COUNT(*) FROM latest_prices WHERE is_promo = TRUE) AS promos_count`
  );
  return rows[0] || { products_total: 0, products_with_prices: 0, promos_count: 0 };
}

/**
 * Statystyki cenowe dla kategorii
 */
/**
 * Wyszukiwanie produktów — do inline mode i wyszukiwarki
 */
export async function searchProducts(
  searchQuery: string,
  limit: number = 20
): Promise<{ name: string; price: number; seller_slug: string; category_slug: string; url: string }[]> {
  return query(
    `SELECT
       p.name,
       lp.price,
       p.seller_slug,
       p.category_slug,
       COALESCE(p.url, '') AS url
     FROM latest_prices lp
     JOIN products p ON p.id = lp.product_id
     WHERE LOWER(p.name) LIKE LOWER($1)
       AND p.is_active = TRUE
     ORDER BY lp.price ASC
     LIMIT $2`,
    [`%${searchQuery}%`, limit]
  );
}

/**
 * Statystyki produktów — do dashboardu / API
 */
export async function getProductStats(): Promise<{
  total: number;
  with_prices: number;
  promos: number;
}> {
  const stats = await getDashboardStats();
  return {
    total: stats.products_total,
    with_prices: stats.products_with_prices,
    promos: stats.promos_count,
  };
}

export async function getCategoryStats(categorySlug: Kategoria): Promise<{
  total_products: number;
  avg_price: number;
  min_price: number;
  max_price: number;
  promo_count: number;
} | null> {
  const rows = await query(
    `SELECT
       COUNT(*) as total_products,
       ROUND(AVG(price)::numeric, 2) as avg_price,
       MIN(price) as min_price,
       MAX(price) as max_price,
       SUM(CASE WHEN is_promo THEN 1 ELSE 0 END) as promo_count
     FROM latest_prices
     WHERE category_slug = $1`,
    [categorySlug]
  );
  return rows[0] || null;
}

/**
 * Trend cenowy — średnie ceny dzienne w ostatnich N dniach
 */
export async function getPriceTrend(
  categorySlug: string,
  days: number = 30
): Promise<{ date: string; avg_price: number; product_count: number }[]> {
  return query(
    `SELECT DATE(ph.scraped_at) as date,
            ROUND(AVG(ph.price)::numeric, 2) as avg_price,
            COUNT(DISTINCT ph.product_id) as product_count
     FROM price_history ph
     JOIN products p ON p.id = ph.product_id
     WHERE p.category_slug = $1 AND ph.scraped_at > NOW() - ($2 || ' days')::interval
     GROUP BY DATE(ph.scraped_at)
     ORDER BY date`,
    [categorySlug, days]
  );
}

/**
 * Top spadki cen w ostatnich 24h
 */
export async function getTopDrops(limit: number = 10) {
  return query(
    `SELECT product_name, seller_slug, prev_price, current_price, change_percent
     FROM price_changes_24h
     WHERE change_percent < 0
     ORDER BY change_percent ASC
     LIMIT $1`,
    [limit]
  );
}

/**
 * Top promocje (największy rabat)
 */
export async function getTopPromos(limit: number = 10) {
  return query(
    `SELECT p.name as product_name, p.seller_slug, lp.price, lp.original_price,
            ROUND(((lp.original_price - lp.price) / lp.original_price * 100)::numeric, 1) as discount_percent
     FROM latest_prices lp
     JOIN products p ON p.id = lp.product_id
     WHERE lp.is_promo = TRUE AND lp.original_price IS NOT NULL AND lp.original_price > lp.price
     ORDER BY discount_percent DESC
     LIMIT $1`,
    [limit]
  );
}
