// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
import { config } from '../config.js';
import { gotoSoft, assertNotBlocked, genericProduct } from './common.js';
import * as ml from '../mlApi.js';

// ---------- API oficial (preferida) ----------

async function reviewsFor(itemId) {
  try {
    const r = await ml.apiGet(`/reviews/item/${itemId}`);
    return { rating: r.rating_average ?? null, reviews: r.paging?.total ?? null };
  } catch {
    return { rating: null, reviews: null };
  }
}

const bigPicture = (url) => (url ? url.replace(/^http:/, 'https:').replace(/-[A-Z]\.(jpg|webp)$/i, '-O.$1') : null);

async function apiProduct(url) {
  const { itemId, productId } = ml.idsFromUrl(url);
  if (itemId) {
    const it = await ml.apiGet(`/items/${itemId}`);
    const rv = await reviewsFor(itemId);
    return {
      title: it.title,
      image: it.pictures?.[0]?.secure_url || bigPicture(it.thumbnail),
      price: it.price,
      currency: it.currency_id,
      ...rv,
    };
  }
  if (productId) {
    const p = await ml.apiGet(`/products/${productId}`);
    const win = p.buy_box_winner;
    const rv = win?.item_id ? await reviewsFor(win.item_id) : { rating: null, reviews: null };
    return {
      title: p.name,
      image: p.pictures?.[0]?.url || null,
      price: win?.price ?? null,
      currency: win?.currency_id ?? config.mlCurrency,
      ...rv,
    };
  }
  throw new Error('No reconozco el id del producto en ese link de Mercado Libre');
}

async function apiSearch(query) {
  const q = encodeURIComponent(query);
  let results = [];
  try {
    // Búsqueda de publicaciones.
    const data = await ml.apiGet(`/sites/${config.mlSite}/search?q=${q}&limit=12`);
    results = (data.results || []).map((r) => ({
      id: r.id,
      title: r.title,
      url: r.permalink,
      image: bigPicture(r.thumbnail),
      price: r.price,
      currency: r.currency_id,
    }));
  } catch (e) {
    if (!/\b403\b/.test(e.message)) throw e;
    // Si la búsqueda de publicaciones no está permitida para la app, usar el catálogo.
    const data = await ml.apiGet(`/products/search?status=active&site_id=${config.mlSite}&q=${q}&limit=8`);
    for (const p of (data.results || []).slice(0, 8)) {
      const full = await ml.apiGet(`/products/${p.id}`).catch(() => null);
      const win = full?.buy_box_winner;
      if (!win?.price) continue;
      results.push({
        id: win.item_id,
        title: p.name,
        url: full.permalink || `https://www.${config.mlDomain}/p/${p.id}`,
        image: p.pictures?.[0]?.url || null,
        price: win.price,
        currency: win.currency_id,
      });
    }
  }
  // Rating solo para los primeros resultados (una llamada por publicación).
  const out = [];
  for (const [i, r] of results.entries()) {
    const rv = i < 6 && r.id ? await reviewsFor(r.id) : { rating: null, reviews: null };
    out.push({
      title: r.title,
      url: r.url,
      image: r.image,
      priceText: `${r.currency || config.mlCurrency} ${r.price}`,
      ratingText: rv.rating != null ? String(rv.rating) : null,
      reviewsText: rv.reviews != null ? String(rv.reviews) : null,
    });
  }
  return out;
}

// ---------- Lectura de la página (respaldo si la API no está conectada) ----------

async function pageProduct(page) {
  const p = await genericProduct(page, {
    titleSelectors: ['h1.ui-pdp-title', 'h1'],
    priceSelectors: [
      '.ui-pdp-price__second-line .andes-money-amount__fraction',
      '.ui-pdp-price .andes-money-amount__fraction',
      '.andes-money-amount__fraction',
    ],
    ratingSelectors: ['.ui-pdp-review__rating'],
    reviewsSelectors: ['.ui-pdp-review__amount'],
  });
  return { ...p, currency: p.currency || config.mlCurrency };
}

async function pageSearch(page, query) {
  const slug = query.trim().replace(/\s+/g, '-');
  await gotoSoft(page, `https://${config.mlListingDomain}/${encodeURIComponent(slug)}`);
  await assertNotBlocked(page, 'Mercado Libre');
  await page.waitForSelector('li.ui-search-layout__item, .poly-card', { timeout: 15000 }).catch(() => {});
  return page.$$eval('li.ui-search-layout__item, div.poly-card', (cards) => {
    const seen = new Set();
    const out = [];
    for (const c of cards) {
      const a = c.querySelector('a.poly-component__title, h2 a, a.ui-search-link');
      if (!a) continue;
      const url = a.href.split('#')[0].split('?')[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const priceEl = c.querySelector('.poly-price__current .andes-money-amount__fraction')
        || c.querySelector('.andes-money-amount:not(.andes-money-amount--previous) .andes-money-amount__fraction');
      out.push({
        title: (a.textContent || '').trim(),
        url,
        image: c.querySelector('img')?.src || null,
        priceText: priceEl?.textContent || null,
        ratingText: c.querySelector('.poly-reviews__rating, .ui-search-reviews__rating-number')?.textContent || null,
        reviewsText: c.querySelector('.poly-reviews__total, .ui-search-reviews__amount')?.textContent || null,
      });
      if (out.length >= 10) break;
    }
    return out;
  });
}

export default {
  id: 'mercadolibre',
  name: 'Mercado Libre',
  currency: config.mlCurrency,
  matches: (url) => /(^|\.)mercadoli(b|v)re\.[a-z.]+$/i.test(new URL(url).hostname),

  // Sin la API conectada, Mercado Libre bloquea la búsqueda (pide iniciar sesión):
  // no se intenta, para no gastar tiempo ni llenar las tarjetas de avisos.
  searchEnabled: () => ml.isConnected(),

  // Si la API está conectada, checker.js las usa sin abrir el navegador.
  api: {
    available: () => ml.isConnected(),
    product: apiProduct,
    search: apiSearch,
  },

  product: (page) => pageProduct(page),
  search: (page, query) => pageSearch(page, query).catch((e) => {
    if (/sesi[oó]n/.test(e.message)) throw new Error('pide iniciar sesión: conecta la API de Mercado Libre arriba');
    throw e;
  }),
};
