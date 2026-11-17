// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
import { config } from '../config.js';
import { parsePrice, parseRating, parseCount, detectCurrency, jitter } from '../util.js';
import { gotoSoft, assertNotBlocked, firstText, attrOf, jsonLdProduct } from './common.js';

export default {
  id: 'amazon',
  name: 'Amazon',
  currency: 'USD',
  matches: (url) => /(^|\.)amazon\.[a-z.]+$/i.test(new URL(url).hostname) || /(^|\.)a\.co$/i.test(new URL(url).hostname),

  async product(page) {
    const ld = (await jsonLdProduct(page)) || {};
    const title = ld.title || (await firstText(page, ['#productTitle', '#title']));
    const priceText = await firstText(page, [
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#apex_desktop .a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.a-price .a-offscreen',
    ]);
    const image = (await attrOf(page, '#landingImage', 'data-old-hires')) || (await attrOf(page, '#landingImage', 'src')) || ld.image;
    const ratingText = (await attrOf(page, '#acrPopover', 'title')) || (await firstText(page, ['#acrPopover .a-icon-alt']));
    const reviewsText = await firstText(page, ['#acrCustomerReviewText']);
    return {
      title,
      image,
      price: parsePrice(priceText) ?? ld.price,
      currency: detectCurrency(priceText) || ld.currency || null,
      rating: parseRating(ratingText) ?? ld.rating,
      reviews: parseCount(reviewsText) ?? ld.reviews,
    };
  },

  async search(page, query) {
    const url = `https://${config.amazonDomain}/s?k=${encodeURIComponent(query)}`;
    const CARD = '[data-component-type="s-search-result"]';
    await gotoSoft(page, url);
    await assertNotBlocked(page, 'Amazon');
    // A veces Amazon responde con una página de error o vacía: se reintenta una vez antes de rendirse.
    if (!(await page.waitForSelector(CARD, { timeout: 10000 }).catch(() => null))) {
      await jitter(3000, 6000);
      await gotoSoft(page, url);
      await assertNotBlocked(page, 'Amazon');
      if (!(await page.waitForSelector(CARD, { timeout: 10000 }).catch(() => null))) {
        const title = (await page.title().catch(() => '')) || 'sin título';
        throw new Error(`Amazon no mostró resultados (página: "${title.slice(0, 60)}")`);
      }
    }
    return page.$$eval('[data-component-type="s-search-result"]', (cards) =>
      cards
        .filter((c) => !c.querySelector('.puis-sponsored-label-text, [aria-label*="Sponsored"], [aria-label*="Patrocinado"]'))
        .slice(0, 10)
        .map((c) => {
        const a = c.querySelector('h2 a, a.a-link-normal.s-no-outline, a.a-link-normal[href*="/dp/"]');
        const title = c.querySelector('h2 span, h2')?.textContent?.trim();
        return {
          title,
          url: a ? new URL(a.getAttribute('href'), location.origin).href.split('?')[0] : null,
          image: c.querySelector('img.s-image')?.src || null,
          priceText: c.querySelector('.a-price .a-offscreen')?.textContent || null,
          ratingText: c.querySelector('.a-icon-alt')?.textContent || null,
          reviewsText: c.querySelector('[aria-label$="ratings"], [aria-label$="calificaciones"], a[href*="customerReviews"] span')?.textContent
            || c.querySelector('[aria-label*="rating"]')?.getAttribute('aria-label') || null,
        };
      }).filter((r) => r.title && r.url),
    );
  },
};
