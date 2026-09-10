FROM eclipse-temurin:25.0.4_7-jre-noble
WORKDIR /app
ENV NODE_ENV=production HOST=127.0.0.1 PORT=4300 DESKTOP_WEB_DIR=/app/web DESKTOP_CONFIG_FILE=/app/application-catalog.json DESKTOP_RUNTIME_DIR=/var/lib/mg-desktop
COPY kernel/app.jar ./app.jar
COPY desktop/web ./web
COPY application-catalog.json ./application-catalog.json
USER 1000:1000
ENTRYPOINT ["java", "-Xms64m", "-Xmx512m", "-XX:+ExitOnOutOfMemoryError", "-jar", "/app/app.jar"]
