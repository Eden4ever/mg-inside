package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ServiceStorageTest {
    @TempDir Path temporary;

    @Test void deploymentCatalogAllowsOnlyControlledMatchingArtifacts() throws Exception {
        Set<String> apps = Set.of("files", "resource-manager");
        var catalog = new ServiceDeploymentCatalog(null, apps);
        ObjectNode manifest = Json.object().put("serviceId", "files.api").put("version", "1.1.0").put("appId", "files");
        ObjectNode publication = Json.object().set("manifest", manifest);
        publication.put("digest", "a".repeat(64)).put("contractDigest", "b".repeat(64));
        ObjectNode deployment = Json.object().put("endpointRef", "files-blue").put("name", "文件部署").put("appId", "files").put("providerAppId", "files")
            .put("environment", "production").put("baseUrl", "http://127.0.0.1:14350/api").put("deploymentId", "files-release-1")
            .put("artifactDigest", "c".repeat(64)).put("resourceRef", "server-1").put("deployedAt", "2026-09-09T00:00:00Z");
        deployment.set("services", Json.MAPPER.createArrayNode().add(Json.object().put("serviceId", "files.api").put("version", "1.1.0").put("manifestDigest", "a".repeat(64)).put("contractDigest", "b".repeat(64))));
        ObjectNode input = Json.object().put("schemaVersion", 1);
        input.set("environments", Json.MAPPER.createArrayNode().add(Json.object().put("id", "production").put("name", "生产").set("deployments", Json.MAPPER.createArrayNode().add(deployment))));
        ObjectNode validated = catalog.validate(input);
        String digest = CanonicalJson.digest(validated.at("/environments/0/deployments/0"));

        Path file = temporary.resolve("deployments.json");
        Files.write(file, Json.bytes(input));
        var loaded = new ServiceDeploymentCatalog(file.toString(), apps);
        loaded.refresh();
        ObjectNode binding = loaded.binding(publication, "production", "files-blue", digest);
        assertEquals("files-release-1", binding.path("deploymentId").asText());
        assertEquals("http://127.0.0.1:14350/api", loaded.resolve(publication, binding, "production").path("baseUrl").asText());
        assertEquals(409, assertThrows(ApiException.class, () -> loaded.binding(publication, "production", "files-blue", "d".repeat(64))).status());

        for (var mutation : List.<java.util.function.Consumer<ObjectNode>>of(
            value -> ((ObjectNode) value.at("/environments/0/deployments/0")).put("baseUrl", "http://169.254.169.254/latest"),
            value -> ((ObjectNode) value.at("/environments/0/deployments/0")).put("baseUrl", "https://user:secret@example.com/api"),
            value -> ((ObjectNode) value.at("/environments/0/deployments/0/services/0")).put("contractDigest", "bad"),
            value -> ((ObjectNode) value.at("/environments/0/deployments/0")).put("appId", "unknown")
        )) {
            ObjectNode changed = input.deepCopy();
            mutation.accept(changed);
            assertEquals(400, assertThrows(ApiException.class, () -> catalog.validate(changed)).status());
        }
    }

    @Test void snapshotSupportsReadOnlyFailoverAndRejectsTampering() throws Exception {
        ObjectNode state = JsonServiceRegistryStorage.emptyState();
        state.with("active").put("files.api", "1.1.0");
        var healthy = new MemoryStorage(state, false);
        var first = new SnapshotServiceRegistryStorage(healthy, temporary, "production");
        assertEquals("1.1.0", first.read(false).at("/active/files.api").asText());
        assertTrue(Files.exists(temporary.resolve("postgres-snapshot-production.json")));

        var failed = new SnapshotServiceRegistryStorage(new MemoryStorage(state, true), temporary, "production");
        assertEquals("1.1.0", failed.read(true).at("/active/files.api").asText());
        assertTrue(failed.status().path("stale").asBoolean());
        assertEquals(503, assertThrows(ApiException.class, () -> failed.transaction((saved, context) -> null)).status());

        ObjectNode envelope = (ObjectNode) Json.read(Files.readAllBytes(temporary.resolve("postgres-snapshot-production.json")));
        ((ObjectNode) envelope.path("state").path("active")).put("files.api", "tampered");
        Files.write(temporary.resolve("postgres-snapshot-production.json"), Json.bytes(envelope));
        var tampered = new SnapshotServiceRegistryStorage(new MemoryStorage(state, true), temporary, "production");
        assertEquals(503, assertThrows(ApiException.class, () -> tampered.read(true)).status());
    }

    @Test void environmentValidationMatchesDatabaseConstraint() {
        assertEquals("production-cn", PostgresServiceRegistryStorage.validateEnvironment("production-cn"));
        for (String value : List.of("P", "a", "-bad", "bad_name", "a".repeat(33))) assertThrows(IllegalStateException.class, () -> PostgresServiceRegistryStorage.validateEnvironment(value));
        assertEquals(741029L, PostgresServiceRegistryStorage.ADVISORY_LOCK);
    }

    private static final class MemoryStorage implements ServiceRegistryStorage {
        private ObjectNode state;
        private final boolean fail;
        MemoryStorage(ObjectNode state, boolean fail) { this.state = state.deepCopy(); this.fail = fail; }
        @Override public ObjectNode read(boolean allowCache) { if (fail) throw new ApiException(503, "unavailable"); return state.deepCopy(); }
        @Override public <T> T transaction(Change<T> change) { if (fail) throw new ApiException(503, "unavailable"); ObjectNode next = state.deepCopy(); T value = change.apply(next, new Context("production", Json.MAPPER.createArrayNode())); state = next; return value; }
        @Override public ObjectNode status() { return Json.object().put("backend", "memory").put("environment", "production"); }
    }
}
