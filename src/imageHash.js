// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
// "Huella" de una foto de producto (dHash de 64 bits) para saber si dos tiendas usan la misma foto.
// Los productos genéricos (sin marca) suelen venir del mismo proveedor y usar la misma foto,
// aunque cada tienda la reescale, la comprima o le agregue bordes blancos.
//
// La imagen se descarga desde Node y se decodifica en el Chromium de Playwright (que ya está
// instalado), así no hace falta ninguna librería nativa de imágenes.
import { withPage } from './browser.js';

const cache = new Map(); // url -> huella (hex) | null
const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Recorte elegido con el botón: viaja al final del link como #pscrop=x,y,ancho,alto
 * (fracciones de 0 a 1 de la foto). Devuelve [x, y, w, h] o null.
 */
export function parseCrop(url) {
  const m = String(url || '').match(/#pscrop=([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number);
  if (![x, y, w, h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) || w < 0.02 || h < 0.02) return null;
  return [x, y, w, h];
}

async function toDataUrl(url) {
  // La foto recortada con el botón ya viene como data:image/...;base64,…
  if (/^data:image\/(jpeg|png|webp);base64,/i.test(url)) return url.length <= MAX_BYTES * 1.4 ? url : null;
  url = url.split('#')[0]; // el #pscrop no es parte del link real
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (!res.ok || !type.startsWith('image/')) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return null;
  return `data:${type};base64,${buf.toString('base64')}`;
}

/**
 * Calcula la huella de varias fotos. Devuelve Map(url -> hex de 16 caracteres, o null si no se pudo).
 * Las huellas quedan en memoria para no descargar dos veces la misma foto.
 */
export async function hashImages(urls) {
  const todo = [...new Set(urls.filter((u) => /^(https?:\/\/|data:image\/)/i.test(u || '') && !cache.has(u)))];
  if (todo.length) {
    const dataUrls = await Promise.all(todo.map((u) => toDataUrl(u).catch(() => null)));
    const valid = [];
    todo.forEach((u, i) => {
      if (dataUrls[i]) valid.push([u, dataUrls[i]]);
      else cache.set(u, null);
    });
    if (valid.length) {
      const hashes = await withPage((page) => page.evaluate(async (items) => {
        // Corre dentro del navegador: decodifica, recorta bordes casi blancos y calcula el dHash.
        const out = [];
        for (const { src, crop } of items) {
          try {
            const img = new Image();
            img.src = src;
            await img.decode();
            // Zona de la foto a usar: toda, o el recorte elegido con el botón.
            const [cx, cy, cw, ch] = crop
              ? [crop[0] * img.width, crop[1] * img.height, crop[2] * img.width, crop[3] * img.height]
              : [0, 0, img.width, img.height];
            const S = 128;
            const c = document.createElement('canvas');
            c.width = S; c.height = S;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, S, S);
            const scale = Math.min(S / cw, S / ch);
            const w = cw * scale, h = ch * scale;
            ctx.drawImage(img, cx, cy, cw, ch, (S - w) / 2, (S - h) / 2, w, h);
            const px = ctx.getImageData(0, 0, S, S).data;
            // Recorte: caja del contenido que no es fondo blanco.
            let x0 = S, y0 = S, x1 = -1, y1 = -1;
            for (let y = 0; y < S; y++) {
              for (let x = 0; x < S; x++) {
                const i = (y * S + x) * 4;
                if (px[i] < 235 || px[i + 1] < 235 || px[i + 2] < 235) {
                  if (x < x0) x0 = x;
                  if (x > x1) x1 = x;
                  if (y < y0) y0 = y;
                  if (y > y1) y1 = y;
                }
              }
            }
            if (x1 < x0 || y1 < y0) { out.push(null); continue; }
            const d = document.createElement('canvas');
            d.width = 9; d.height = 8;
            const dctx = d.getContext('2d', { willReadFrequently: true });
            dctx.drawImage(c, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, 9, 8);
            const g = dctx.getImageData(0, 0, 9, 8).data;
            const lum = (x, y) => { const i = (y * 9 + x) * 4; return g[i] * 0.299 + g[i + 1] * 0.587 + g[i + 2] * 0.114; };
            let bits = '';
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += lum(x, y) > lum(x + 1, y) ? '1' : '0';
            let hex = '';
            for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
            out.push(hex);
          } catch {
            out.push(null);
          }
        }
        return out;
      }, valid.map(([u, d]) => ({ src: d, crop: parseCrop(u) }))));
      valid.forEach(([u], i) => cache.set(u, hashes[i]));
    }
  }
  return new Map(urls.map((u) => [u, cache.get(u) ?? null]));
}

/** Bits distintos entre dos huellas (0 = idénticas, 64 = opuestas). null si falta alguna. */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}
