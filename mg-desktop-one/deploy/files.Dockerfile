FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production FILES_HOST=127.0.0.1 FILES_PORT=14350 FILES_STORAGE_DIR=/var/lib/mg-files
COPY files/server ./server
COPY files/package.json ./package.json
USER node
CMD ["node", "--experimental-transform-types", "server/main.ts"]
