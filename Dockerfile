# Finance Baba — production image
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# The database and secret key live here: mount a persistent volume at /data
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
