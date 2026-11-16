// Ayudas compartidas por todas las tiendas.
import { parsePrice, parseRating, parseCount, detectCurrency, jitter } from '../util.js';

/** Navega sin morir por timeouts: muchas tiendas nunca terminan de "cargar". */
export async function gotoSoft(page, url, { timeout = 45000 } = {}) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
  } catch (e) {
    if (!/timeout/i.test(e.message)) throw e;
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await jitter(600, 1500);
}

/** Lanza un error claro si la tienda mostró captcha o bloqueo. */
export async function assertNotBlocked(page, storeName) {
  const url = page.url();
  const text = (await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '').catch(() => '')).toLowerCase();
  const blocked =
    /captcha|punish|validatecaptcha|\/challenge/i.test(url) ||
    /enter the characters you see|introduce los caracteres|verify you are human|verifica que eres humano|robot check|slide to verify|desliza para verificar|unusual traffic|tráfico inusual/.test(text);
  if (blocked) throw new Error(`${storeName} mostró un captcha`);
  const loginWall = /\/login|account-verification|\/signin|\/ap\/signin/i.test(url);
  if (loginWall) throw new Error(`${storeName} pide iniciar sesión para buscar`);
}

export async function textOf(page, selector) {
  const loc = page.locator(selector).first();
  if (!(await loc.count())) return null;
  const t = await loc.innerText({ timeout: 3000 }).catch(() => null);
  return t ? t.trim() : null;
}

export async function attrOf(page, selector, attr) {
  const loc = page.locator(selector).first();
  if (!(await loc.count())) return null;
  return loc.getAttribute(attr, { timeout: 3000 }).catch(() => null);
}

export const metaContent = (page, selector) => attrOf(page, selector, 'content');

/** Primer texto no vacío entre varios selectores. */
export async function firstText(page, selectors) {
  for (const s of selectors) {
    const t = await textOf(page, s);
    if (t) return t;
  }
  return null;
}

/**
 * Lee el bloque JSON-LD de tipo Product, si existe. Es lo más estable:
 * no depende de clases CSS.
 */
export async function jsonLdProduct(page) {
  const blocks = await page
    .$$eval('script[type="application/ld+json"]', (els) => els.map((e) => e.textContent))
    .catch(() => []);
  const find = (node) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const n of node) {
        const r = find(n);
        if (r) return r;
      }
      return null;
    }
    const type = node['@type'];
    if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return node;
    return find(node['@graph']) || null;
  };
  for (const raw of blocks) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const p = find(data);
    if (!p) continue;
    let offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    if (offer?.offers) offer = Array.isArray(offer.offers) ? offer.offers[0] : offer.offers;
    const priceRaw = offer?.price ?? offer?.lowPrice ?? p.offers?.lowPrice;
    const agg = p.aggregateRating || {};
    const image = Array.isArray(p.image) ? p.image[0] : typeof p.image === 'object' ? p.image?.url : p.image;
    return {
      title: p.name || null,
      image: image || null,
      price: typeof priceRaw === 'number' ? priceRaw : parsePrice(String(priceRaw ?? '')),
      currency: offer?.priceCurrency || p.offers?.priceCurrency || null,
      rating: parseRating(agg.ratingValue),
      reviews: parseCount(agg.reviewCount ?? agg.ratingCount),
    };
  }
  return null;
}

/** Lectura genérica de un producto: JSON-LD, luego meta tags, luego selectores dados. */
export async function genericProduct(page, { titleSelectors = [], priceSelectors = [], ratingSelectors = [], reviewsSelectors = [] } = {}) {
  const ld = (await jsonLdProduct(page)) || {};
  const title = ld.title || (await firstText(page, titleSelectors)) || (await metaContent(page, 'meta[property="og:title"]'));
  const image = ld.image || (await metaContent(page, 'meta[property="og:image"]'));
  let price = ld.price;
  let currency = ld.currency;
  if (price == null) {
    const metaPrice = (await metaContent(page, 'meta[property="product:price:amount"]'))
      || (await metaContent(page, 'meta[property="og:price:amount"]'))
      || (await metaContent(page, 'meta[itemprop="price"]'));
    const priceText = metaPrice || (await firstText(page, priceSelectors));
    price = parsePrice(priceText);
    currency = currency
      || (await metaContent(page, 'meta[property="product:price:currency"]'))
      || (await metaContent(page, 'meta[itemprop="priceCurrency"]'))
      || detectCurrency(priceText);
  }
  const rating = ld.rating ?? parseRating(await firstText(page, ratingSelectors));
  const reviews = ld.reviews ?? parseCount(await firstText(page, reviewsSelectors));
  return { title, image, price, currency, rating, reviews };
}

/**
 * Extrae tarjetas de resultados cuando las clases CSS son ilegibles.
 * Parte de cada link de producto y sube hasta un contenedor que tenga un precio.
 */
export async function genericCards(page, { linkSelector, limit = 8 }) {
  await page.waitForSelector(linkSelector, { timeout: 15000 }).catch(() => {});
  await page.mouse.wheel(0, 1500).catch(() => {});
  await jitter(500, 1200);
  return page.$$eval(
    linkSelector,
    (links, limit) => {
      const priceRe = /(US\s?\$|COP|\$|€)\s?\d[\d.,]*|\d[\d.,]*\s?(US\$|COP|€)/i;
      const out = [];
      const seen = new Set();
      for (const a of links) {
        const href = a.href.split('?')[0];
        if (seen.has(href)) continue;
        let box = a;
        for (let i = 0; i < 7 && box && !priceRe.test(box.innerText || ''); i++) box = box.parentElement;
        if (!box) continue;
        const text = box.innerText || '';
        const img = box.querySelector('img');
        const title = a.getAttribute('title') || a.getAttribute('aria-label') || img?.alt
          || text.split('\n').map((s) => s.trim()).sort((x, y) => y.length - x.length)[0] || '';
        const price = text.match(priceRe);
        if (!title || !price) continue;
        const rating = text.match(/(?:^|\s)([0-5][.,]\d)(?:\s|$|\s?★)/);
        const reviews = text.match(/\(?(\d[\d.,]*\s?(?:k|mil)?)\+?\)?\s*(?:reseñas|opiniones|reviews|valoraciones|calificaciones)/i)
          || text.match(/(\d[\d.,]*\s?(?:k|mil)?)\+?\s*(?:vendidos|sold)/i);
        seen.add(href);
        out.push({
          title: title.trim(),
          url: href,
          image: img?.src || null,
          priceText: price[0],
          ratingText: rating ? rating[1] : null,
          reviewsText: reviews ? reviews[1] : null,
        });
        if (out.length >= limit) break;
      }
      return out;
    },
    limit,
  );
}
