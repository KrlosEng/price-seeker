// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
// SQLite incluido en Node (node:sqlite), sin compilar módulos nativos.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'priceseeker.db');
if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

// Migración: la versión anterior guardaba una sola oferta por tienda (PRIMARY KEY product_id, store).
// La tabla solo tiene la foto de la última comparación, así que se puede recrear sin perder historial.
{
  const cols = db.prepare("SELECT name FROM pragma_table_info('offers')").all().map((c) => c.name);
  if (cols.length && !cols.includes('id')) db.exec('DROP TABLE offers');
}

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS products (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    url                TEXT NOT NULL UNIQUE,
    store              TEXT NOT NULL,
    title              TEXT,
    image              TEXT,
    email              TEXT,
    target_price       REAL,             -- COP
    source_price       REAL,             -- último precio del link original, COP
    baseline_metric    REAL,             -- primer mejor precio medido (referencia para alertas)
    last_metric        REAL,             -- último mejor precio, COP
    last_metric_store  TEXT,
    last_alerted_price REAL,
    last_checked       TEXT,
    last_error         TEXT,
    store_errors       TEXT,             -- JSON { tienda: motivo } de la última comparación
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS prices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store       TEXT NOT NULL,
    price_cop   REAL NOT NULL,
    is_source   INTEGER NOT NULL DEFAULT 0,
    checked_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id, checked_at);

  CREATE TABLE IF NOT EXISTS offers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    store         TEXT NOT NULL,
    title         TEXT,
    url           TEXT,
    image         TEXT,
    price_cop     REAL,
    rating        REAL,
    reviews       INTEGER,
    similarity    REAL,
    is_source     INTEGER NOT NULL DEFAULT 0,
    matched       INTEGER NOT NULL DEFAULT 0,  -- 1 = es el mismo producto
    qualified     INTEGER NOT NULL DEFAULT 0,  -- 1 = rating y reseñas suficientes
    reject_reason TEXT,
    checked_at    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id, store);

  -- Ajustes internos (p. ej. tokens de la API de Mercado Libre). Solo vive en tu equipo.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Migración: columnas para productos enviados con el botón (Temu, Shein), cuyo precio no se lee solo.
{
  const cols = db.prepare("SELECT name FROM pragma_table_info('products')").all().map((c) => c.name);
  const add = (name, def) => { if (!cols.includes(name)) db.exec(`ALTER TABLE products ADD COLUMN ${name} ${def}`); };
  add('manual', 'INTEGER NOT NULL DEFAULT 0');      // 1 = el precio de tu link lo envía el botón
  add('source_rating', 'REAL');
  add('source_reviews', 'INTEGER');
  add('source_updated_at', 'TEXT');                 // cuándo se envió el último precio con el botón
  add('description', 'TEXT');                       // descripción leída por el botón (ayuda a comparar)

  const offerCols = db.prepare("SELECT name FROM pragma_table_info('offers')").all().map((c) => c.name);
  if (!offerCols.includes('image_match')) db.exec('ALTER TABLE offers ADD COLUMN image_match INTEGER NOT NULL DEFAULT 0');
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => new Date().toISOString();
