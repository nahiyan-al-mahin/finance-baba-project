# Finance Baba — production image
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
# Set DATABASE_URL (Neon) and APP_SECRET. Without DATABASE_URL a local database is kept in /data,
# so mount a persistent volume there.
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
