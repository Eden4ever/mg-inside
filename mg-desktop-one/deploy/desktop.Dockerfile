FROM node:24.20.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=127.0.0.1 PORT=4300 DESKTOP_WEB_DIR=/app/web DESKTOP_CONFIG_FILE=/app/application-catalog.json DESKTOP_RUNTIME_DIR=/var/lib/mg-desktop
COPY desktop/main.mjs ./main.mjs
COPY desktop/web ./web
COPY application-catalog.json ./application-catalog.json
USER node
CMD ["node", "main.mjs"]
