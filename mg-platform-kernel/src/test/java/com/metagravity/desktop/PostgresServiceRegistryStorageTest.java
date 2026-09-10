package com.metagravity.desktop;

import com.fasterxml.jackson.databind.node.ObjectNode;
import static org.junit.jupiter.api.Assertions.*;
import java.io.InputStream;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class PostgresServiceRegistryStorageTest {
    @TempDir Path temporary;
    @Test void transactionsSerializeConcurrentWritersAndRollbackFailures() throws Exception {
        String url = System.getenv("TEST_POSTGRES_URL");
        Assumptions.assumeTrue(url != null && !url.isBlank(), "需要隔离 PostgreSQL 测试地址");
        try (Connection connection = DriverManager.getConnection(url)) {
            try (InputStream input = getClass().getResourceAsStream("/db/migration/V1__service_registry.sql")) {
                assertNotNull(input);
                try (Statement statement = connection.createStatement()) { statement.execute(new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)); }
            }
        }

        var storage = new PostgresServiceRegistryStorage(url, "integration");
        try {
            ObjectNode empty = JsonServiceRegistryStorage.emptyState();
            String emptyDigest = CanonicalJson.digest(empty);
            assertFalse(storage.importState(empty, emptyDigest));
            assertTrue(storage.importState(empty, emptyDigest));
            assertThrows(IllegalStateException.class, () -> storage.importState(empty, "f".repeat(64)));
            storage.transaction((state, context) -> {
                var manifest = Json.object().put("schemaVersion", 1).put("serviceId", "files.api").put("appId", "files").put("name", "文件").put("version", "1.0.0").put("description", "测试");
                manifest.set("operations", Json.MAPPER.createArrayNode().add(Json.object().put("operationId", "list").put("method", "GET").put("path", "/entries").put("summary", "查询").put("effect", "read")));
                var publication = Json.object().put("digest", CanonicalJson.manifestDigest(manifest)).put("at", "2026-09-09T00:00:00Z").put("actor", "test");
                publication.set("manifest", manifest);
                state.withArray("publications").add(publication);
                state.with("active").put("files.api", "1.0.0");
                return null;
            });
            assertEquals("1.0.0", storage.read(false).at("/active/files.api").asText());

            try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                var first = executor.submit(() -> increment(storage));
                var second = executor.submit(() -> increment(storage));
                first.get(10, TimeUnit.SECONDS);
                second.get(10, TimeUnit.SECONDS);
            }
            assertEquals(2, storage.read(false).at("/revisions/files.api").asInt());

            assertThrows(ApiException.class, () -> storage.transaction((state, context) -> {
                state.with("revisions").put("files.api", 99);
                throw new ApiException(409, "业务拒绝");
            }));
            assertEquals(2, storage.read(false).at("/revisions/files.api").asInt());

            ObjectNode oldSnapshot = storage.read(false).deepCopy();
            oldSnapshot.remove("lifecycles");
            storage.transaction((state, context) -> {
                state.with("lifecycles").set("files.api@1.0.0", Json.object().put("status", "retired").put("revision", 1).put("reason", "测试退役").put("at", "2026-09-09T00:00:00Z").put("actor", "test"));
                return null;
            });
            try (var recovery = new PostgresServiceRegistryStorage(url, "recovery-old")) {
                assertThrows(IllegalStateException.class, () -> recovery.importState(oldSnapshot, CanonicalJson.digest(oldSnapshot)));
            }

            ObjectNode shared = storage.read(false).deepCopy();
            shared.with("active").putNull("files.api");
            shared.with("bindings").remove("files.api");
            String sharedDigest = CanonicalJson.digest(shared);
            try (var production = new PostgresServiceRegistryStorage(url, "production"); var testing = new PostgresServiceRegistryStorage(url, "testing")) {
                assertFalse(production.importState(shared, sharedDigest));
                assertFalse(testing.importState(shared, sharedDigest));
            }
            Path deployments = temporary.resolve("deployments.json");
            Files.write(deployments, Json.bytes(Json.object().put("schemaVersion", 1).set("environments", Json.MAPPER.createArrayNode()
                .add(Json.object().put("id", "production").put("name", "生产").set("deployments", Json.MAPPER.createArrayNode()))
                .add(Json.object().put("id", "testing").put("name", "测试").set("deployments", Json.MAPPER.createArrayNode())))));
            var settings = new Settings(Map.of("SERVICE_DATABASE_URL", url, "SERVICE_ENVIRONMENT", "production", "SERVICE_DEPLOYMENTS_FILE", deployments.toString(), "DESKTOP_RUNTIME_DIR", temporary.toString()));
            var catalog = catalog(settings);
            var runningStorage = new SnapshotServiceRegistryStorage(new PostgresServiceRegistryStorage(url, "production"), temporary.resolve("services"), "production");
            var running = new ServiceRegistry(settings, catalog, runningStorage);
            running.initialize();
            var contexts = new ServiceRegistryContexts(settings, catalog, running);
            try {
                assertEquals("testing", contexts.select("testing").environment());
                assertEquals(404, assertThrows(ApiException.class, () -> contexts.select("unknown")).status());
                assertEquals(404, assertThrows(ApiException.class, () -> contexts.select("x")).status());
            } finally {
                contexts.close(); running.close();
            }
        } finally {
            storage.close();
        }
    }

    private static Void increment(PostgresServiceRegistryStorage storage) {
        return storage.transaction((state, context) -> {
            int revision = state.with("revisions").path("files.api").asInt(0);
            try { Thread.sleep(75); } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new RuntimeException(error); }
            state.with("revisions").put("files.api", revision + 1);
            return null;
        });
    }

    private static AppCatalog catalog(Settings settings) {
        var presentation = Json.object().put("name", "测试桌面");
        var apps = Json.object();
        for (String id : List.of("service-manager", "resource-manager", "low-alt-cockpit", "office-one", "files", "personal-center", "app-manager", "expert-database", "token-one", "token-one-console", "token-one-docs", "identity")) apps.set(id, Json.object().put("name", id).put("description", "测试应用"));
        presentation.set("applications", apps);
        return new AppCatalog(settings, presentation, ApplicationFixtures.rows());
    }
}
