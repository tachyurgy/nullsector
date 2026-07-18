# NULLSECTOR — tiny Node server (uses built-in node:sqlite, zero npm deps).
FROM node:24-slim
WORKDIR /app
COPY . .
ENV PORT=8787 DB_PATH=/data/ladder.db NODE_ENV=production
RUN mkdir -p /data
EXPOSE 8787
CMD ["node", "server/server.mjs"]
