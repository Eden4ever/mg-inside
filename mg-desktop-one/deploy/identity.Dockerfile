# 身份中心仍在现有 /opt/mg-identity Compose 中发布；此文件只解决共享前端的构建上下文。
FROM node:24.20.0-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY identity/package.json identity/package-lock.json ./
RUN npm ci
COPY identity/prisma ./prisma
RUN node node_modules/prisma/build/index.js generate
COPY identity/dist ./dist
COPY identity/scripts ./scripts
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4200
USER node
CMD ["node", "dist/main.js"]
