# Price Seeker para Railway (o cualquier servicio que corra contenedores).
# Node 24 trae SQLite incluido (node:sqlite); Playwright instala Chromium y sus dependencias del sistema.
FROM node:24-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CHROMIUM_NO_SANDBOX=1 \
    DB_PATH=/data/priceseeker.db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

COPY . .

# Railway define PORT; la app la lee de ahí (por defecto 3000).
EXPOSE 3000
CMD ["node", "server.js"]
