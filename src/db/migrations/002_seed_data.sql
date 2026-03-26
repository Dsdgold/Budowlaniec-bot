-- ============================================================
-- Seed data: realistyczne ceny materiałów budowlanych
-- Dane testowe dla rozwoju i demonstracji
-- ============================================================

-- === Produkty: Cement i beton ===
INSERT INTO products (seller_slug, category_slug, external_id, name, url, unit) VALUES
('castorama', 'cement', 'CST-CEM-001', 'Cement portlandzki CEM I 42,5R Górażdże 25kg', 'https://castorama.pl/cement-portlandzki', 'szt'),
('castorama', 'cement', 'CST-CEM-002', 'Zaprawa murarska M5 25kg', 'https://castorama.pl/zaprawa-murarska', 'szt'),
('castorama', 'cement', 'CST-CEM-003', 'Beton B25 gotowy 25kg', 'https://castorama.pl/beton-gotowy', 'szt'),
('leroy', 'cement', 'LER-CEM-001', 'Cement portlandzki CEM I 42,5R Lafarge 25kg', 'https://leroymerlin.pl/cement-lafarge', 'szt'),
('leroy', 'cement', 'LER-CEM-002', 'Zaprawa tynkarska uniwersalna 25kg', 'https://leroymerlin.pl/zaprawa-tynkarska', 'szt'),
('trzyw', 'cement', 'TRZ-CEM-001', 'Cement CEM II 32,5R Odra 25kg', 'https://3wdb.pl/cement-odra', 'szt'),
('bechcicki', 'cement', 'BEC-CEM-001', 'Cement portlandzki CEM I 42,5R 25kg', 'https://bechcicki.pl/cement', 'szt')
ON CONFLICT (seller_slug, external_id) DO NOTHING;

-- === Produkty: Stal i metale ===
INSERT INTO products (seller_slug, category_slug, external_id, name, url, unit) VALUES
('castorama', 'stal', 'CST-STL-001', 'Pręt żebrowany fi 12mm 6m', 'https://castorama.pl/pret-zebrowany', 'szt'),
('castorama', 'stal', 'CST-STL-002', 'Siatka zbrojeniowa 2x1m fi 4mm', 'https://castorama.pl/siatka-zbrojeniowa', 'szt'),
('leroy', 'stal', 'LER-STL-001', 'Pręt żebrowany fi 10mm 6m', 'https://leroymerlin.pl/pret-zebrowany', 'szt'),
('leroy', 'stal', 'LER-STL-002', 'Kątownik stalowy 40x40x3mm 2m', 'https://leroymerlin.pl/katownik', 'szt'),
('trzyw', 'stal', 'TRZ-STL-001', 'Pręt żebrowany fi 12mm 12m', 'https://3wdb.pl/pret-zebrowany-12', 'szt'),
('bechcicki', 'stal', 'BEC-STL-001', 'Siatka ogrodzeniowa 1.5x25m', 'https://bechcicki.pl/siatka', 'szt')
ON CONFLICT (seller_slug, external_id) DO NOTHING;

-- === Produkty: Drewno ===
INSERT INTO products (seller_slug, category_slug, external_id, name, url, unit) VALUES
('castorama', 'drewno', 'CST-DRW-001', 'Deska szalunkowa 25x150x4000mm', 'https://castorama.pl/deska-szalunkowa', 'szt'),
('castorama', 'drewno', 'CST-DRW-002', 'Łata dachowa 40x60x4000mm', 'https://castorama.pl/lata-dachowa', 'szt'),
('leroy', 'drewno', 'LER-DRW-001', 'Kantówka strugana 45x45x3000mm', 'https://leroymerlin.pl/kantowka', 'szt'),
('leroy', 'drewno', 'LER-DRW-002', 'Deska tarasowa sosna 28x145x3000mm', 'https://leroymerlin.pl/deska-tarasowa', 'szt'),
('trzyw', 'drewno', 'TRZ-DRW-001', 'Belka konstrukcyjna 100x200x6000mm', 'https://3wdb.pl/belka', 'szt')
ON CONFLICT (seller_slug, external_id) DO NOTHING;

-- === Produkty: Izolacja ===
INSERT INTO products (seller_slug, category_slug, external_id, name, url, unit) VALUES
('castorama', 'izolacja', 'CST-IZO-001', 'Styropian fasadowy EPS 70-038 10cm', 'https://castorama.pl/styropian-fasadowy', 'm2'),
('castorama', 'izolacja', 'CST-IZO-002', 'Wełna mineralna 15cm 035', 'https://castorama.pl/welna-mineralna', 'm2'),
('leroy', 'izolacja', 'LER-IZO-001', 'Styropian grafitowy EPS 031 10cm', 'https://leroymerlin.pl/styropian-grafitowy', 'm2'),
('leroy', 'izolacja', 'LER-IZO-002', 'Pianka poliuretanowa 750ml', 'https://leroymerlin.pl/pianka-pu', 'szt'),
('trzyw', 'izolacja', 'TRZ-IZO-001', 'Styropian podłogowy EPS 100 5cm', 'https://3wdb.pl/styropian-podlogowy', 'm2'),
('bechcicki', 'izolacja', 'BEC-IZO-001', 'Wełna skalna Rockwool 20cm', 'https://bechcicki.pl/welna-rockwool', 'm2')
ON CONFLICT (seller_slug, external_id) DO NOTHING;

-- === Produkty: Narzędzia ===
INSERT INTO products (seller_slug, category_slug, external_id, name, url, unit) VALUES
('castorama', 'narzedzia', 'CST-NAR-001', 'Wiertarko-wkrętarka akumulatorowa 18V', 'https://castorama.pl/wiertarko-wkretarka', 'szt'),
('castorama', 'narzedzia', 'CST-NAR-002', 'Szlifierka kątowa 125mm 1200W', 'https://castorama.pl/szlifierka-katowa', 'szt'),
('leroy', 'narzedzia', 'LER-NAR-001', 'Młot udarowy SDS+ 800W', 'https://leroymerlin.pl/mlot-udarowy', 'szt'),
('leroy', 'narzedzia', 'LER-NAR-002', 'Poziomica laserowa 360° zielona', 'https://leroymerlin.pl/poziomica-laserowa', 'szt')
ON CONFLICT (seller_slug, external_id) DO NOTHING;

-- === Historia cen — ostatnie 7 dni (realistyczne wahania) ===
-- Generujemy ceny dla każdego produktu z lekkimi zmianami dzień po dniu

-- Cement portlandzki Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d
    WHEN 0 THEN 24.99 WHEN 1 THEN 24.99 WHEN 2 THEN 25.49 WHEN 3 THEN 25.49
    WHEN 4 THEN 24.49 WHEN 5 THEN 23.99 WHEN 6 THEN 23.99
  END,
  CASE WHEN d >= 5 THEN 25.49 ELSE NULL END,
  CASE WHEN d >= 5 THEN true ELSE false END,
  NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d
WHERE p.external_id = 'CST-CEM-001';

-- Cement Lafarge Leroy
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 26.90 WHEN 1 THEN 26.90 WHEN 2 THEN 27.50 WHEN 3 THEN 27.50 WHEN 4 THEN 26.90 WHEN 5 THEN 26.50 WHEN 6 THEN 26.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'LER-CEM-001';

-- Cement Odra 3W
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 21.50 WHEN 1 THEN 21.50 WHEN 2 THEN 22.00 WHEN 3 THEN 22.50 WHEN 4 THEN 22.50 WHEN 5 THEN 21.90 WHEN 6 THEN 21.90 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'TRZ-CEM-001';

-- Cement Bechcicki
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 23.90 WHEN 1 THEN 24.50 WHEN 2 THEN 24.50 WHEN 3 THEN 24.90 WHEN 4 THEN 24.90 WHEN 5 THEN 24.90 WHEN 6 THEN 25.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'BEC-CEM-001';

-- Zaprawa murarska Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 14.99 WHEN 1 THEN 14.99 WHEN 2 THEN 15.49 WHEN 3 THEN 15.49 WHEN 4 THEN 15.49 WHEN 5 THEN 14.99 WHEN 6 THEN 14.99 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-CEM-002';

-- Beton gotowy
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 18.50 WHEN 1 THEN 18.50 WHEN 2 THEN 19.00 WHEN 3 THEN 19.00 WHEN 4 THEN 18.50 WHEN 5 THEN 18.50 WHEN 6 THEN 18.00 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-CEM-003';

-- Pręt żebrowany fi 12 Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 38.90 WHEN 1 THEN 39.50 WHEN 2 THEN 39.50 WHEN 3 THEN 40.00 WHEN 4 THEN 40.00 WHEN 5 THEN 39.00 WHEN 6 THEN 38.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-STL-001';

-- Pręt żebrowany Leroy
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 32.50 WHEN 1 THEN 33.00 WHEN 2 THEN 33.00 WHEN 3 THEN 34.00 WHEN 4 THEN 33.50 WHEN 5 THEN 33.00 WHEN 6 THEN 32.00 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'LER-STL-001';

-- Pręt żebrowany 3W
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 72.00 WHEN 1 THEN 73.50 WHEN 2 THEN 74.00 WHEN 3 THEN 74.00 WHEN 4 THEN 72.50 WHEN 5 THEN 71.00 WHEN 6 THEN 70.00 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'TRZ-STL-001';

-- Styropian fasadowy Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 22.90 WHEN 1 THEN 22.90 WHEN 2 THEN 23.50 WHEN 3 THEN 24.00 WHEN 4 THEN 24.00 WHEN 5 THEN 22.90 WHEN 6 THEN 22.90 END,
  CASE WHEN d IN (0, 1) THEN 24.00 ELSE NULL END,
  CASE WHEN d IN (0, 1) THEN true ELSE false END,
  NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-IZO-001';

-- Styropian grafitowy Leroy
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 31.50 WHEN 1 THEN 32.00 WHEN 2 THEN 32.00 WHEN 3 THEN 33.00 WHEN 4 THEN 33.50 WHEN 5 THEN 33.00 WHEN 6 THEN 32.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'LER-IZO-001';

-- Wełna mineralna Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 45.00 WHEN 1 THEN 45.00 WHEN 2 THEN 46.50 WHEN 3 THEN 46.50 WHEN 4 THEN 47.00 WHEN 5 THEN 47.00 WHEN 6 THEN 45.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-IZO-002';

-- Wełna Rockwool Bechcicki
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 65.00 WHEN 1 THEN 67.00 WHEN 2 THEN 68.00 WHEN 3 THEN 69.00 WHEN 4 THEN 69.00 WHEN 5 THEN 68.00 WHEN 6 THEN 67.50 END,
  CASE WHEN d = 0 THEN 69.00 ELSE NULL END,
  CASE WHEN d = 0 THEN true ELSE false END,
  NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'BEC-IZO-001';

-- Deska szalunkowa Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 12.50 WHEN 1 THEN 12.50 WHEN 2 THEN 13.00 WHEN 3 THEN 13.00 WHEN 4 THEN 12.90 WHEN 5 THEN 12.50 WHEN 6 THEN 12.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-DRW-001';

-- Deska tarasowa Leroy
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 28.90 WHEN 1 THEN 29.50 WHEN 2 THEN 29.50 WHEN 3 THEN 30.00 WHEN 4 THEN 30.00 WHEN 5 THEN 29.00 WHEN 6 THEN 28.50 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'LER-DRW-002';

-- Wiertarko-wkrętarka Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 249.00 WHEN 1 THEN 249.00 WHEN 2 THEN 279.00 WHEN 3 THEN 279.00 WHEN 4 THEN 279.00 WHEN 5 THEN 259.00 WHEN 6 THEN 259.00 END,
  CASE WHEN d IN (0, 1) THEN 279.00 ELSE NULL END,
  CASE WHEN d IN (0, 1) THEN true ELSE false END,
  NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-NAR-001';

-- Szlifierka kątowa Castorama
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 189.00 WHEN 1 THEN 189.00 WHEN 2 THEN 199.00 WHEN 3 THEN 199.00 WHEN 4 THEN 199.00 WHEN 5 THEN 195.00 WHEN 6 THEN 195.00 END,
  NULL, false, NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'CST-NAR-002';

-- Poziomica laserowa Leroy (duża promocja!)
INSERT INTO price_history (product_id, price, original_price, is_promo, scraped_at)
SELECT p.id,
  CASE d WHEN 0 THEN 399.00 WHEN 1 THEN 399.00 WHEN 2 THEN 549.00 WHEN 3 THEN 549.00 WHEN 4 THEN 549.00 WHEN 5 THEN 499.00 WHEN 6 THEN 499.00 END,
  CASE WHEN d IN (0, 1) THEN 549.00 ELSE NULL END,
  CASE WHEN d IN (0, 1) THEN true ELSE false END,
  NOW() - (d || ' days')::interval
FROM products p, generate_series(0, 6) AS d WHERE p.external_id = 'LER-NAR-002';
