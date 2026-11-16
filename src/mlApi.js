// Cliente de la API oficial de Mercado Libre (OAuth 2.0, gratis).
// Flujo: el usuario autoriza la app una vez -> guardamos access_token (6 h) y
// refresh_token -> lo renovamos solos antes de que venza.
import crypto from 'node:crypto';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

const API = 'https://api.mercadolibre.com';
const TOKEN_KEY = 'ml_token';

// Dominio de autorización según el país del sitio (MCO -> .com.co).
const AUTH_DOMAINS = {
  MCO: 'auth.mercadolibre.com.co', MLA: 'auth.mercadolibre.com.ar', MLM: 'auth.mercadolibre.com.mx',
  MLC: 'auth.mercadolibre.cl', MPE: 'auth.mercadolibre.com.pe', MLU: 'auth.mercadolibre.com.uy',
  MLB: 'auth.mercadolivre.com.br',
};

const pendingStates = new Map(); // state -> expira (ms)

export const isConfigured = () => !!(config.mlClientId && config.mlClientSecret && config.mlRedirectUri);
export const isConnected = () => !!getSetting(TOKEN_KEY)?.refresh_token;

export function status() {
  const t = getSetting(TOKEN_KEY);
  return {
    configured: isConfigured(),
    connected: !!t?.refresh_token,
    last_error: getSetting('ml_last_error'),
  };
}

export function authUrl() {
  if (!isConfigured()) throw new Error('Faltan ML_CLIENT_ID, ML_CLIENT_SECRET o ML_REDIRECT_URI en .env');
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 15 * 60_000);
  const domain = AUTH_DOMAINS[config.mlSite] || AUTH_DOMAINS.MCO;
  const u = new URL(`https://${domain}/authorization`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', config.mlClientId);
  u.searchParams.set('redirect_uri', config.mlRedirectUri);
  u.searchParams.set('state', state);
  return u.href;
}

/** Acepta el código solo, o la URL completa a la que Mercado Libre redirigió. */
export function parseCodeInput(input) {
  const s = String(input || '').trim();
  if (!s) return { code: null, state: null };
  try {
    const u = new URL(s);
    return { code: u.searchParams.get('code'), state: u.searchParams.get('state') };
  } catch {
    return { code: s, state: null };
  }
}

async function tokenRequest(params) {
  const res = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: config.mlClientId, client_secret: config.mlClientSecret, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mercado Libre rechazó el token: ${data.message || data.error || res.status}`);
  const t = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 21600) * 1000,
  };
  setSetting(TOKEN_KEY, t);
  setSetting('ml_last_error', null);
  return t;
}

/** Cambia el código de autorización por tokens. state es opcional (cuando se pega a mano). */
export async function exchangeCode(code, state = null) {
  if (!isConfigured()) throw new Error('Mercado Libre no está configurado en .env');
  if (!code) throw new Error('Falta el código de autorización');
  if (state) {
    const exp = pendingStates.get(state);
    pendingStates.delete(state);
    if (!exp || exp < Date.now()) throw new Error('La autorización expiró. Vuelve a conectar Mercado Libre.');
  }
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.mlRedirectUri });
}

let refreshing = null;
async function accessToken() {
  const t = getSetting(TOKEN_KEY);
  if (!t?.refresh_token) return null;
  if (t.expires_at - Date.now() > 5 * 60_000) return t.access_token;
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })
    .catch((e) => {
      setSetting('ml_last_error', e.message);
      throw e;
    })
    .finally(() => { refreshing = null; });
  return (await refreshing).access_token;
}

/** GET autenticado. Lanza un error con el motivo si Mercado Libre responde mal. */
export async function apiGet(path) {
  const token = await accessToken();
  if (!token) throw new Error('Mercado Libre no está conectado');
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `API de Mercado Libre ${res.status}: ${data.message || data.error || 'error'}`;
    if (res.status === 401 || res.status === 403) setSetting('ml_last_error', msg);
    throw new Error(msg);
  }
  return data;
}

export function disconnect() {
  setSetting(TOKEN_KEY, null);
  setSetting('ml_last_error', null);
}

/** Extrae ids de una URL de Mercado Libre: item (MCO123..., MCO-123...) o producto de catálogo (/p/MCO...). */
export function idsFromUrl(url) {
  const site = config.mlSite;
  let params;
  try { params = new URL(url).searchParams; } catch { params = new URLSearchParams(); }
  const catalog = url.match(new RegExp(`/p/(${site}\\d+)`, 'i'));
  const item = url.match(new RegExp(`(${site})-?(\\d{6,})`, 'i'));
  const qItem = params.get('item_id') || params.get('wid'); // los links /p/ suelen traer el item aquí
  return {
    itemId: qItem
      ? qItem.toUpperCase().replace('-', '')
      : !catalog && item ? `${item[1].toUpperCase()}${item[2]}` : null,
    productId: catalog ? catalog[1].toUpperCase() : null,
  };
}
