// Shein bloquea la lectura automática con un reto anti-bot.
// Igual que Temu, es una tienda "manual": el producto y su precio llegan con el botón
// "Enviar a Price Seeker", que lee la página que TÚ estás viendo en tu navegador.
export default {
  id: 'shein',
  name: 'Shein',
  currency: 'COP',
  manualOnly: true,
  matches: (url) => /(^|\.)shein\.(com|com\.[a-z]{2}|co)$/i.test(new URL(url).hostname),
  // …-p-516526855.html es lo que identifica el producto; el resto son parámetros de rastreo.
  canonical: (url) => {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  },
};
