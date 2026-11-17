# Price Seeker

Comparador de precios que corre **en tu propio computador**. Creado por **Carlos David Aguirre Angulo**.

- **Busca** un producto (por modelo o descripción) en Amazon y AliExpress y te muestra los **exactos** y los **similares**.
- **Sigue** el precio de un link y **te avisa por correo cuando baja** o cuando aparece el mismo producto más barato en otra tienda.
- Funciona con Temu y Shein mediante un botón en tu navegador.

> **Licencia no comercial.** Puedes usarlo, estudiarlo y modificarlo para uso personal, educativo o sin fines de lucro. **No puedes usarlo para ganar dinero** (venderlo, ofrecerlo como servicio, integrarlo en un negocio) sin permiso escrito del autor. Ver [Licencia y autoría](#licencia-y-autoría).

## Usarla en tu computador

Requisitos: **Node.js 22.13 o superior** (incluye SQLite, no hay que compilar nada) y unos 800 MB libres para Chromium.

```bash
git clone https://github.com/KrlosEng/price-seeker.git
cd price-seeker
npm install
npm run setup        # descarga Chromium para Playwright, una sola vez
cp .env.example .env # opcional: llena SMTP_* para recibir correos
npm start            # abre http://localhost:3000
```

`npm test` corre las pruebas automáticas.

### Seguridad

- La app **solo acepta conexiones de tu propio computador** (`HOST=127.0.0.1`). Nadie de tu red Wi-Fi ni de internet puede abrirla.
- Tus productos, precios y la configuración se guardan solo en tu equipo: en `data/` y en `.env`. Ninguno de los dos se sube a git.
- Si de verdad quieres abrirla a otros equipos, pon `HOST=0.0.0.0` y una clave en `APP_TOKEN`, bajo tu responsabilidad.

## Barra de búsqueda

Escribe un producto ("rtx 5060 8gb") o descríbelo ("audífonos inalámbricos con cancelación de ruido"). La app busca en Amazon y AliExpress (y Mercado Libre si la API está conectada) y muestra:

- **Exactos:** el mismo modelo y variante, del más barato al más caro. Se destaca el más barato con buenas reseñas.
- **Similares:** otras variantes y modelos cercanos, con el motivo ("otra variante (ti)", "otro modelo (rtx3060)").

Distingue variantes como Ti, Pro, Max, Plus, Ultra, Super o Mini, y descarta accesorios salvo que los busques. Desde la página del botón de Temu y Shein, **Buscar sin seguir** lleva el producto (y tu foto) a la búsqueda. Cada búsqueda queda guardada 10 minutos y hay un límite de 6 por minuto por persona, porque abre Chromium en cada tienda.

## Ejecutarla en un servidor (opcional, avanzado)

El proyecto está pensado para tu computador. Si aun así quieres ponerlo en un servidor propio, el repositorio trae un `Dockerfile` (Node 24 + Chromium; usa `HOST=0.0.0.0` dentro del contenedor) y un `railway.json`. Hazlo **solo para uso personal** (lo exige la licencia), monta un volumen en `/data` para la base de datos y define `APP_TOKEN`, o cualquiera con el link podrá usar tu app. En la nube las tiendas suelen pedir captcha más seguido que en una conexión de casa.

## Temu y Shein: botón "Enviar a Price Seeker"

Temu (pide iniciar sesión) y Shein (reto anti-bot) bloquean la lectura automática, así que la app no entra a esas tiendas. En su lugar:

1. En la app, abre **"Temu y Shein: usa el botón…"** y arrastra **⇪ Enviar a Price Seeker** a tu barra de marcadores (Ctrl+Shift+B para mostrarla).
2. Abre un producto en Temu o Shein, en tu navegador y con tu sesión, como siempre, y haz clic en el marcador.
3. La página se oscurece como con Win+Shift+S: **arrastra el mouse sobre la foto del producto**. Enter usa la foto principal sin recortar; Esc cancela. No aparece ningún diálogo: se recorta la foto de la página que queda bajo tu selección.
4. Se abre una pestaña con nombre, precio y foto. Revísalos (corrige el precio o pega otra captura con Win+Shift+S y Ctrl+V) y pulsa **Guardar y comparar**.

**Productos sin marca ni modelo:** la app compara la foto con las de los resultados de Amazon y AliExpress. Si es la misma foto (los productos genéricos suelen compartir la foto del proveedor) y el título es del mismo tipo de producto, lo acepta como el mismo. Si cada tienda usa fotos propias, no habrá coincidencia.

Si cambias de versión de la app, **vuelve a arrastrar el botón** a la barra de marcadores: el marcador guarda una copia del código.

La app busca el mismo producto en Amazon y AliExpress (y Mercado Libre cuando la conectes) cada 6 horas. El precio de Temu o Shein **no se actualiza solo**: vuelve a pulsar el marcador en ese producto para actualizarlo. El marcador también funciona en cualquier otra tienda.

## Conectar Mercado Libre (API oficial, gratis)

Mercado Libre no deja buscar a un navegador automatizado (pide iniciar sesión), así que se usa su API.

1. Entra a https://developers.mercadolibre.com.co → **Mis aplicaciones** → **Crear aplicación** (con tu cuenta normal).
2. **URI de redirect:** Mercado Libre exige `https`. Registra `https://localhost:3000/api/ml/callback`.
3. **Permisos/scopes:** con lectura basta. No necesitas permisos de ventas ni de publicaciones.
4. Copia el *Client ID* y el *Client Secret* en tu `.env`:
   ```
   ML_CLIENT_ID=...
   ML_CLIENT_SECRET=...
   ML_REDIRECT_URI=https://localhost:3000/api/ml/callback
   ```
5. Reinicia la app y pulsa **Conectar Mercado Libre**. Autoriza con tu cuenta.
6. El navegador intentará abrir `https://localhost:3000/...` y mostrará un error, porque la app corre en `http`. Es normal. Copia la URL completa de la barra de direcciones (trae `?code=...`) y pégala en el campo de la app.

Listo. El token se renueva solo y queda guardado únicamente en `data/priceseeker.db` de tu equipo. Si la API falla o la desconectas, la app vuelve a intentar leyendo la página.

## Cómo decide

- **¿Es el mismo producto?** (`src/rules.js` → `matchProduct`). Descarta si:
  - el resultado tiene palabras de accesorio que tu producto no tiene (funda, case, cable, "compatible"…);
  - choca una especificación con unidad (128GB vs 256GB, 10000mAh vs 20000mAh);
  - el código o número de modelo es otro (XM5 vs XM4, iPhone 15 vs 14);
  - se parece poco (`MIN_SIMILARITY`);
  - cuesta menos del 40% de tu link (`MIN_PRICE_RATIO`): casi seguro es otra cosa.

  Entre los que pasan, elige **el más parecido**. Solo si dos están empatados elige el más barato.
- **Mejor opción** (`pickBest`): el mismo producto en otra tienda, con rating ≥ `MIN_RATING` y reseñas ≥ `MIN_REVIEWS`, y más barato que tu link. Si no existe, la mejor opción es tu link.
- **Alertas** (`decideAlert`):
  - Con precio objetivo: avisa cuando la mejor opción llega al objetivo. No repite el aviso salvo que baje otro `REALERT_PCT`%.
  - Sin objetivo: avisa cuando baja `DROP_PCT`% frente a la referencia, que es el último precio avisado o, si nunca se avisó, el primero medido. Las bajadas lentas se acumulan.
  - Al editar objetivo o correo, la referencia se reinicia al precio actual.
- **Moneda**: se usa la que muestra la página. Si no la muestra, la de la tienda. Si una tienda "en USD" muestra un número ≥ 20.000, se asume que te la mostró en pesos.

## Si una tienda deja de leerse

Pon `HEADLESS=false` en `.env` y reinicia para ver el navegador. Los selectores están en `src/stores/<tienda>.js`.

Errores típicos:
- "No pude leer el precio": cambió un selector.
- "mostró un captcha": la tienda te bloqueó. Espera, baja la frecuencia o resuélvelo a mano.

## Limitaciones

- Probado con links reales en Amazon y AliExpress (noviembre 2026). Los selectores pueden cambiar con el tiempo.
- Temu y Shein solo funcionan con el botón: la app no los busca ni actualiza su precio sola.
- Sin código de modelo, "mismo producto" se decide por la marca en MAYÚSCULAS (ej.: HUEFORM). Sin marca ni modelo (mucha ropa de Temu), solo se acepta un título casi idéntico, así que normalmente no habrá coincidencias.
- La integración con la API de Mercado Libre no se ha probado con credenciales reales. Si la búsqueda de publicaciones responde 403, la app intenta con la búsqueda de catálogo.
- No incluye envío ni impuestos de importación. La tasa USD→COP es fija.
- Para Temu y AliExpress, "reseñas" puede ser en realidad el número de vendidos.
- Solo corre mientras el servidor esté encendido.
- Scrapear va contra los términos de varias tiendas: úsalo para uso personal y con pocos productos.

## Licencia y autoría

**Price Seeker © 2026 Carlos David Aguirre Angulo** — https://github.com/KrlosEng/price-seeker

Este proyecto usa la licencia **[PolyForm Noncommercial 1.0.0](LICENSE)**. En resumen (el texto que vale es el de `LICENSE`):

- ✅ Puedes usarlo, copiarlo y modificarlo para **uso personal**, estudio, investigación o en organizaciones sin fines de lucro.
- ❌ **No puedes usarlo con fines comerciales**: venderlo, cobrar por ofrecerlo como servicio, ni usarlo dentro de un negocio, sin permiso escrito del autor.
- 📌 Cualquier copia o versión modificada **debe conservar** la línea `Required Notice` de `LICENSE` y los avisos de autoría del código.

Si quieres usarlo comercialmente, contacta al autor a través de GitHub.

Cada archivo lleva un aviso de autor y la huella del proyecto, que también aparece en las cabeceras del servidor y en `/api/about`. Sirve para identificar copias del proyecto.
