import nodemailer from 'nodemailer';
import { config } from './config.js';

let transporter = null;
function getTransporter() {
  if (!config.smtp.host || !config.smtp.user) return null;
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

const cop = (n) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-CO') + ' COP');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * alert: { product, best, fromSource, reason, reference, storeName }
 */
export async function sendPriceAlert(alert) {
  const { product, best, fromSource, reason, reference, storeName } = alert;
  const to = product.email || config.alertEmailTo;

  const headline = fromSource
    ? `Bajó de precio: ${cop(best.priceCop)}`
    : `Lo encontré más barato en ${storeName}: ${cop(best.priceCop)}`;
  const why = reason === 'target'
    ? `Llegó a tu precio objetivo de ${cop(product.target_price)}.`
    : `Bajó desde ${cop(reference)} (${Math.round((1 - best.priceCop / reference) * 100)}% menos).`;

  const subject = `Price Seeker · ${headline} · ${String(product.title || '').slice(0, 60)}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <h2 style="margin:0 0 8px">${esc(headline)}</h2>
      <p style="margin:0 0 12px;color:#444">${esc(why)}</p>
      ${product.image ? `<img src="${esc(product.image)}" alt="" style="max-width:160px;border-radius:8px">` : ''}
      <p><strong>${esc(product.title)}</strong></p>
      ${fromSource ? '' : `<p>Precio en tu link original: ${cop(product.source_price)}</p>`}
      <p><a href="${esc(best.url || product.url)}" style="background:#111;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Ver oferta</a></p>
      ${fromSource ? '' : `<p style="color:#888;font-size:12px">Revisa modelo, capacidad y color antes de comprar: la coincidencia es automática.</p>`}
    </div>`;

  const t = getTransporter();
  if (!t || !to) {
    console.log(`[alerta] (sin SMTP o sin correo, solo consola) ${subject}`);
    return { sent: false };
  }
  await t.sendMail({ from: config.smtp.from, to, subject, html });
  console.log(`[alerta] enviada a ${to}: ${subject}`);
  return { sent: true };
}
