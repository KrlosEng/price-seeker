// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
import express from 'express';
import cron from 'node-cron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { BANNER, CREDIT, FINGERPRINT, REPO, LICENSE_ID, AUTHOR } from './src/brand.js';
import { db, now } from './src/db.js';
import { STORES, storeFor, storeById, canonicalUrl } from './src/stores/index.js';
import { parsePrice, parseRating, parseCount, detectCurrency, resolveCurrency, toCOP, cleanTitle } from './src/util.js';
import { scrapeLink, refreshProduct, searchProducts, UserError } from './src/checker.js';
import { closeBrowser } from './src/browser.js';
import * as ml from './src/mlApi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1); // detrás de un proxy (Docker, un servidor), req.ip debe ser la IP real del visitante

// Autoría: cada respuesta lleva el crédito y la huella del proyecto.
app.disable('x-powered-by');
app.use((req, res, next) => {
  // Las cabeceras HTTP solo admiten ASCII: (c) en vez de ©.
  res.set('X-Powered-By', `${CREDIT.replace('©', '(c)')} (${FINGERPRINT})`);
  next();
});
app.get('/api/about', (req, res) => {
  res.json({ name: 'Price Seeker', author: AUTHOR, repo: REPO, license: LICENSE_ID, fingerprint: FINGERPRINT });
});
app.use(express.json({ limit: '1mb' })); // la foto recortada con el botón viaja dentro del JSON
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Cola: un scraping a la vez ----------
let chain = Promise.resolve();
const refreshing = new Set();
let pending = 0;

function enqueue(task) {
  pending++;
  const run = chain.then(task, task);
  chain = run.catch(() => {}).finally(async () => {
    // Cola vacía: se cierra Chromium para no dejarlo ocupando memoria hasta la próxima revisión.
    if (--pending === 0) await closeBrowser();
  });
  return run;
}

function enqueueRefresh(id, prefetched = null) {
  if (refreshing.has(id)) return;
  refreshing.add(id);
  enqueue(() => refreshProduct(id, prefetched))
    .catch((e) => console.error(`[producto ${id}] error inesperado:`, e))
    .finally(() => refreshing.delete(id));
}

// ---------- Mercado Libre: conexión OAuth (navegación del navegador, sin token de la app) ----------
app.get('/api/ml/login', (req, res) => {
  try {
    res.redirect(ml.authUrl());
  } catch (e) {
    res.redirect(`/?ml_error=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/ml/callback', async (req, res) => {
  try {
    await ml.exchangeCode(String(req.query.code || ''), String(req.query.state || '') || null);
    res.redirect('/?ml=ok');
  } catch (e) {
    res.redirect(`/?ml_error=${encodeURIComponent(e.message)}`);
  }
});

// ---------- Token opcional ----------
app.use('/api', (req, res, next) => {
  if (!config.appToken) return next();
  if (req.get('x-app-token') === config.appToken) return next();
  res.status(401).json({ error: 'Token inválido' });
});

// ---------- Helpers ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseTarget(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || n <= 0) throw new UserError('Precio objetivo inválido');
  return Math.round(n);
}

function parseEmail(v) {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === '') return null;
  const e = String(v).trim();
  if (!EMAIL_RE.test(e) || e.length > 200) throw new UserError('Correo inválido');
  return e;
}

function cleanUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new UserError('Pega un link válido (https://...)');
  }
  if (!/^https?:$/.test(u.protocol)) throw new UserError('Solo links http o https');
  if (!storeFor(u.href)) throw new UserError('Tienda no soportada. Usa Amazon, Mercado Libre, AliExpress, Temu o Shein.');
  u.hash = '';
  return canonicalUrl(u.href);
}

function serialize(p) {
  // Tu link primero; luego cada tienda (la que tiene la publicación más barata, antes),
  // y dentro de cada tienda de la más barata a la más cara.
  const offers = db.prepare(`
    SELECT o.*, (SELECT MIN(price_cop) FROM offers m
                 WHERE m.product_id = o.product_id AND m.store = o.store AND m.matched = 1) AS store_min
    FROM offers o WHERE o.product_id = ?
    ORDER BY o.is_source DESC, store_min IS NULL, store_min, o.store, o.price_cop IS NULL, o.price_cop`).all(p.id);
  const history = db.prepare(`SELECT store, price_cop, is_source, checked_at FROM prices
    WHERE product_id = ? ORDER BY checked_at ASC LIMIT 2000`).all(p.id);
  return {
    ...p,
    store_name: storeById(p.store)?.name || p.store,
    store_errors: p.store_errors ? JSON.parse(p.store_errors) : {},
    best_store_name: p.last_metric_store ? storeById(p.last_metric_store)?.name || p.last_metric_store : null,
    offers: offers.map((o) => ({ ...o, store_name: storeById(o.store)?.name || o.store })),
    history,
    refreshing: refreshing.has(p.id),
  };
}

const wrap = (fn) => (req, res) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch((e) => {
      if (e instanceof UserError) return res.status(400).json({ error: e.message });
      console.error(e);
      res.status(500).json({ error: 'Error interno' });
    });

// ---------- API ----------
app.get('/api/products', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json(rows.map(serialize));
}));

app.post('/api/products', wrap(async (req, res) => {
  const url = cleanUrl(req.body?.url);
  const target = parseTarget(req.body?.targetPrice) ?? null;
  const email = parseEmail(req.body?.email) ?? null;

  if (db.prepare('SELECT id FROM products WHERE url = ?').get(url)) {
    return res.status(409).json({ error: 'Ya sigues ese producto' });
  }

  let source;
  try {
    source = await enqueue(() => scrapeLink(url));
  } catch (e) {
    return res.status(422).json({ error: e.message || 'No pude leer el link' });
  }

  const info = db.prepare(`INSERT INTO products (url, store, title, image, email, target_price, source_price, last_checked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(url, source.store, source.title, source.image, email, target, source.priceCop, now());
  const id = Number(info.lastInsertRowid);
  enqueueRefresh(id, source); // la comparación sigue en segundo plano
  res.status(201).json(serialize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
}));

/**
 * Producto enviado con el botón "Enviar a Price Seeker" desde la página que el usuario está viendo.
 * Si ya lo sigues, actualiza el precio de tu link; si no, lo agrega. En ambos casos vuelve a
 * buscar el mismo producto en las otras tiendas.
 */
app.post('/api/products/manual', wrap(async (req, res) => {
  const b = req.body || {};
  const url = cleanUrl(b.url);
  const store = storeFor(url);
  const title = cleanTitle(String(b.title || '')).slice(0, 300);
  if (title.length < 3) throw new UserError('Falta el nombre del producto');

  const amount = parsePrice(b.price);
  if (amount == null) throw new UserError('Falta el precio o no se entiende (ej.: 59.900)');
  const currency = resolveCurrency(amount, String(b.currency || '').toUpperCase() || detectCurrency(String(b.price)), store.currency);
  const priceCop = toCOP(amount, currency);
  if (priceCop == null) throw new UserError(`Moneda no soportada: ${currency}`);

  // Foto: un link de la tienda o el recorte de la captura (data:image/jpeg;base64,…, máx. ~700 KB).
  const rawImage = String(b.image || '');
  const image = /^https?:\/\//i.test(rawImage) && rawImage.length <= 1500 ? rawImage
    : /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawImage) && rawImage.length <= 700_000 ? rawImage
      : null;
  const description = String(b.description || '').replace(/\s+/g, ' ').trim().slice(0, 600) || null;
  const rating = parseRating(b.rating);
  const reviews = parseCount(b.reviews);
  const target = parseTarget(b.targetPrice);
  const email = parseEmail(b.email);
  // Las tiendas que la app sí puede leer sola siguen funcionando en automático.
  const manual = store.manualOnly ? 1 : 0;
  const ts = now();

  const existing = db.prepare('SELECT * FROM products WHERE url = ?').get(url);
  let id;
  let created = false;
  if (existing) {
    id = existing.id;
    db.prepare(`UPDATE products SET title = ?, image = COALESCE(?, image), description = COALESCE(?, description),
      source_price = ?, source_rating = ?, source_reviews = ?, source_updated_at = ?, manual = ?, last_error = NULL,
      target_price = COALESCE(?, target_price), email = COALESCE(?, email) WHERE id = ?`)
      .run(title, image, description, priceCop, rating, reviews, ts, manual, target ?? null, email ?? null, id);
  } else {
    const info = db.prepare(`INSERT INTO products (url, store, title, image, description, email, target_price,
      source_price, source_rating, source_reviews, source_updated_at, manual, last_checked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(url, store.id, title, image, description, email ?? null, target ?? null, priceCop, rating, reviews, ts, manual, ts);
    id = Number(info.lastInsertRowid);
    created = true;
  }

  const saved = db.prepare('SELECT image, description FROM products WHERE id = ?').get(id);
  enqueueRefresh(id, {
    store: store.id, url, title, image: saved.image, description: saved.description, priceCop, rating, reviews,
  });
  res.status(created ? 201 : 200).json({ created, product: serialize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)) });
}));

app.post('/api/products/:id/refresh', wrap((req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM products WHERE id = ?').get(id)) return res.status(404).json({ error: 'No existe' });
  enqueueRefresh(id);
  res.status(202).json({ ok: true });
}));

app.patch('/api/products/:id', wrap((req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const target = parseTarget(req.body?.targetPrice);
  const email = parseEmail(req.body?.email);
  // Al cambiar la configuración se reinicia la referencia de alertas al precio actual.
  db.prepare(`UPDATE products SET target_price = ?, email = ?, last_alerted_price = NULL,
    baseline_metric = last_metric WHERE id = ?`)
    .run(target === undefined ? p.target_price : target, email === undefined ? p.email : email, id);
  res.json(serialize(db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
}));

app.delete('/api/products/:id', wrap((req, res) => {
  const r = db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) return res.status(404).json({ error: 'No existe' });
  res.status(204).end();
}));

// ---------- Barra de búsqueda ----------
// Cada búsqueda abre Chromium en 2-3 tiendas: se guarda 10 minutos y se limita por IP.
const searchCache = new Map(); // clave -> { at, data }
const SEARCH_TTL = 10 * 60_000;
const searchHits = new Map(); // ip -> [timestamps]

function searchAllowed(ip) {
  const now = Date.now();
  const recent = (searchHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (recent.length >= 6) return false;
  recent.push(now);
  searchHits.set(ip, recent);
  return true;
}

app.post('/api/search', wrap(async (req, res) => {
  const q = String(req.body?.q || '').replace(/\s+/g, ' ').trim();
  if (q.length < 2) throw new UserError('Escribe qué producto buscas');
  if (q.length > 120) throw new UserError('La búsqueda es muy larga (máx. 120 caracteres)');
  const rawImage = String(req.body?.image || '');
  const image = (/^https?:\/\//i.test(rawImage) && rawImage.length <= 1500)
    || (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(rawImage) && rawImage.length <= 700_000)
    ? rawImage : null;

  const key = `${q.toLowerCase()}|${image ? image.slice(-64) : ''}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return res.json({ ...hit.data, cached: true });

  if (!searchAllowed(req.ip)) {
    return res.status(429).json({ error: 'Demasiadas búsquedas seguidas. Espera un minuto.' });
  }

  const data = await enqueue(() => searchProducts(q, { image }));
  searchCache.set(key, { at: Date.now(), data });
  if (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value);
  res.json(data);
}));

app.get('/api/stores', (req, res) => {
  res.json(STORES.map((s) => ({ id: s.id, name: s.name, currency: s.currency, manualOnly: !!s.manualOnly })));
});

app.get('/api/ml/status', (req, res) => res.json(ml.status()));

// Para cuando la redirección no abre (p. ej. https://localhost): se pega la URL o el código.
app.post('/api/ml/code', wrap(async (req, res) => {
  const { code, state } = ml.parseCodeInput(req.body?.code);
  if (!code) throw new UserError('Pega la URL completa a la que te mandó Mercado Libre (o solo el código)');
  try {
    await ml.exchangeCode(code, state);
  } catch (e) {
    throw new UserError(e.message);
  }
  res.json(ml.status());
}));

app.post('/api/ml/disconnect', (req, res) => {
  ml.disconnect();
  res.json(ml.status());
});

app.get('/api/config', (req, res) => {
  res.json({ minRating: config.minRating, minReviews: config.minReviews, dropPct: config.dropPct, usdCop: config.usdCop });
});

// ---------- Cron ----------
if (!cron.validate(config.checkCron)) {
  console.error(`CHECK_CRON inválido: "${config.checkCron}"`);
  process.exit(1);
}
cron.schedule(config.checkCron, () => {
  const ids = db.prepare('SELECT id FROM products').all().map((r) => r.id);
  console.log(`[cron] revisando ${ids.length} producto(s)`);
  ids.forEach((id) => enqueueRefresh(id));
});

const server = app.listen(config.port, config.host, () => {
  console.log(BANNER);
  const where = config.host === '127.0.0.1' || config.host === 'localhost'
    ? `http://localhost:${config.port} (solo desde este computador)`
    : `${config.host}:${config.port} — ABIERTA a otros equipos (HOST=${config.host})`;
  console.log(`Price Seeker en ${where}  (cron: ${config.checkCron})`);
  if (process.env.RAILWAY_ENVIRONMENT && !config.appToken) {
    console.warn('AVISO: la app está en internet sin APP_TOKEN: cualquiera con el link puede usarla. Configúralo en Variables.');
  }
});

async function shutdown() {
  server.close();
  await closeBrowser();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
