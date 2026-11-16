// Temu bloquea la lectura automática (pide iniciar sesión y redirige a login).
// Por eso es una tienda "manual": el producto y su precio llegan con el botón
// "Enviar a Price Seeker", que lee la página que TÚ estás viendo en tu navegador.
// La app no entra a Temu por su cuenta.
export default {
  id: 'temu',
  name: 'Temu',
  currency: 'COP',
  manualOnly: true,
  matches: (url) => /(^|\.)temu\.com$/i.test(new URL(url).hostname),
  // Los links de Temu traen muchos parámetros de rastreo: solo importa la ruta (…-g-<id>.html).
  canonical: (url) => {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  },
};
