// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
import { chromium } from 'playwright';
import { config } from './config.js';

let browserPromise = null;
let context = null;

async function getContext() {
  if (!browserPromise) {
    const args = ['--disable-blink-features=AutomationControlled'];
    // En un contenedor (Railway) Chromium corre como root y necesita estas opciones.
    if (process.env.CHROMIUM_NO_SANDBOX === '1') args.push('--no-sandbox', '--disable-dev-shm-usage');
    browserPromise = chromium.launch({ headless: config.headless, args });
  }
  const browser = await browserPromise;
  if (!context) {
    context = await browser.newContext({
      locale: 'es-CO',
      timezoneId: 'America/Bogota',
      viewport: { width: 1366, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  return context;
}

/** Abre una página limpia, ejecuta fn(page) y la cierra pase lo que pase. */
export async function withPage(fn) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  // Sin fuentes ni video: carga más rápido. Las imágenes se dejan (algunas tiendas las usan para detectar bots).
  await page.route('**/*', (route) => {
    const t = route.request().resourceType();
    return t === 'font' || t === 'media' ? route.abort() : route.continue();
  });
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (context) await context.close().catch(() => {});
  if (browserPromise) await (await browserPromise).close().catch(() => {});
  context = null;
  browserPromise = null;
}
