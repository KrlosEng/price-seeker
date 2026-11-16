import 'dotenv/config';

const num = (name, def) => {
  const raw = process.env[name];
  const v = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(v) ? v : def;
};

export const config = {
  port: num('PORT', 3000),
  appToken: process.env.APP_TOKEN || '',
  checkCron: process.env.CHECK_CRON || '0 */6 * * *',
  usdCop: num('USD_COP', 4000),
  minRating: num('MIN_RATING', 4.0),
  minReviews: num('MIN_REVIEWS', 20),
  minSimilarity: num('MIN_SIMILARITY', 0.45),
  minPriceRatio: num('MIN_PRICE_RATIO', 0.4),
  offersPerStore: num('OFFERS_PER_STORE', 5),
  dropPct: num('DROP_PCT', 3),
  realertPct: num('REALERT_PCT', 2),
  alertEmailTo: process.env.ALERT_EMAIL_TO || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: num('SMTP_PORT', 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
  amazonDomain: process.env.AMAZON_DOMAIN || 'www.amazon.com',
  mlDomain: process.env.ML_DOMAIN || 'mercadolibre.com.co',
  mlListingDomain: process.env.ML_LISTING_DOMAIN || 'listado.mercadolibre.com.co',
  mlCurrency: process.env.ML_CURRENCY || 'COP',
  mlSite: process.env.ML_SITE || 'MCO',
  mlClientId: process.env.ML_CLIENT_ID || '',
  mlClientSecret: process.env.ML_CLIENT_SECRET || '',
  mlRedirectUri: process.env.ML_REDIRECT_URI || '',
  headless: (process.env.HEADLESS ?? 'true').toLowerCase() !== 'false',
};
