// Price Seeker — © 2026 Carlos David Aguirre Angulo — https://github.com/KrlosEng/price-seeker
// Licencia PolyForm Noncommercial 1.0.0 (ver LICENSE): uso no comercial; conserva este aviso. Huella PS-CDAA-2026-42dcad1c
import amazon from './amazon.js';
import mercadolibre from './mercadolibre.js';
import aliexpress from './aliexpress.js';
import temu from './temu.js';
import shein from './shein.js';

// Para agregar una tienda: crea su archivo con el mismo contrato e inclúyela aquí.
// Las tiendas con manualOnly no se leen ni se buscan solas: sus productos llegan con el botón.
export const STORES = [amazon, mercadolibre, aliexpress, temu, shein];

export function storeFor(url) {
  try {
    return STORES.find((s) => s.matches(url)) || null;
  } catch {
    return null; // URL inválida
  }
}

export const storeById = (id) => STORES.find((s) => s.id === id) || null;

/** URL sin parámetros de rastreo, para no seguir el mismo producto dos veces. */
export function canonicalUrl(url) {
  const store = storeFor(url);
  try {
    return store?.canonical ? store.canonical(url) : url;
  } catch {
    return url;
  }
}
