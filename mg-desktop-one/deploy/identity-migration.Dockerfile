FROM mg-identity-service:20260908T124713Z
USER root
COPY identity/dist /app/dist
COPY identity/prisma /app/prisma
COPY identity/scripts /app/scripts
RUN node node_modules/prisma/build/index.js generate
USER node
