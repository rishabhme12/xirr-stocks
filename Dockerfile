# Node HTTP server (static + /api). Railway sets PORT; listen on 0.0.0.0 via NODE_ENV=production or HOST.
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

USER node

EXPOSE 3000

CMD ["node", "server.mjs"]
