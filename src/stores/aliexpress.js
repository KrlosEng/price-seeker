import { gotoSoft, assertNotBlocked, genericProduct, genericCards } from './common.js';

export default {
  id: 'aliexpress',
  name: 'AliExpress',
  currency: 'USD',
  matches: (url) => /(^|\.)aliexpress\.[a-z.]+$/i.test(new URL(url).hostname),

  async product(page) {
    return genericProduct(page, {
      titleSelectors: ['h1[data-pl="product-title"]', 'h1'],
      priceSelectors: [
        '[class*="price--currentPriceText"]',
        '[class*="price-default--current"]',
        '.product-price-current',
        '[class*="price--current"]',
      ],
      ratingSelectors: ['[class*="reviewer--rating"] strong', '[class*="overview-rating-average"]'],
      reviewsSelectors: ['[class*="reviewer--reviews"]', '[class*="reviewer--sold"]'],
    });
  },

  async search(page, query) {
    const slug = query.trim().replace(/\s+/g, '-');
    await gotoSoft(page, `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slug)}.html`);
    await assertNotBlocked(page, 'AliExpress');
    return genericCards(page, { linkSelector: 'a[href*="/item/"]' });
  },
};
