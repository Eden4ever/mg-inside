package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.UUID;

/** PostgreSQL 只读降级快照。数据库不可用时允许路由读取，禁止以快照接受写入。 */
public final class SnapshotServiceRegistryStorage implements ServiceRegistryStorage {
    private final ServiceRegistryStorage delegate;
    private final Path directory;
    private final Path filename;
    private final String environment;
    private ObjectNode current;
    private long lastAttempt;
    private String checkedAt;
    private String persistedAt;
    private String lastDigest = "";
    private boolean stale;

    public SnapshotServiceRegistryStorage(ServiceRegistryStorage delegate, Path directory, String environment) {
        this.delegate = delegate;
        this.directory = directory;
        this.environment = PostgresServiceRegistryStorage.validateEnvironment(environment);
        this.filename = directory.resolve("postgres-snapshot-" + environment + ".json");
    }

    @Override public synchronized ObjectNode read(boolean allowCache) {
        long now = System.currentTimeMillis();
        if (allowCache && current != null && now - lastAttempt < 1_000) return current.deepCopy();
        lastAttempt = now;
        try {
            ObjectNode value = delegate.read(false);
            remember(value);
            return value.deepCopy();
        } catch (ApiException error) {
            stale = true;
            if (!allowCache) throw error;
            if (current != null) return current.deepCopy();
            ObjectNode disk = loadDisk();
            if (disk != null) return disk;
            throw error;
        }
    }

    @Override public synchronized <T> T transaction(Change<T> change) {
        final ObjectNode[] committed = new ObjectNode[1];
        try {
            T result = delegate.transaction((state, context) -> {
                T value = change.apply(state, context);
                committed[0] = state.deepCopy();
                return value;
            });
            if (committed[0] != null) remember(committed[0]);
            return result;
        } catch (ApiException error) {
            if (error.status() == 503) { stale = true; lastAttempt = System.currentTimeMillis(); }
            throw error;
        }
    }

    @Override public synchronized ObjectNode status() {
        var value = Json.object().put("backend", "postgresql").put("environment", environment).put("stale", stale);
        if (checkedAt == null) value.putNull("checkedAt"); else value.put("checkedAt", checkedAt);
        if (persistedAt == null) value.putNull("snapshotPersistedAt"); else value.put("snapshotPersistedAt", persistedAt);
        return value;
    }

    @Override public void close() { delegate.close(); }
    @Override public ObjectNode apiInventory(){return delegate.apiInventory();}
    @Override public <T>T apiInventoryTransaction(Change<T> change){return delegate.apiInventoryTransaction(change);}
    @Override public ObjectNode workspace() { return delegate.workspace(); }
    @Override public <T>T workspaceTransaction(Change<T> change) { return delegate.workspaceTransaction(change); }
    @Override public void appendActivity(ObjectNode event) { delegate.appendActivity(event); }
    @Override public void appendAudit(ObjectNode event) { delegate.appendAudit(event); }
    @Override public ObjectNode insights(ServiceMetrics.Query query,java.util.Set<String> allowed) { return delegate.insights(query,allowed); }

    private void remember(ObjectNode value) {
        current = value.deepCopy();
        stale = false;
        checkedAt = Instant.now().toString();
        lastAttempt = System.currentTimeMillis();
        String digest = CanonicalJson.digest(value);
        if (digest.equals(lastDigest)) return;
        var envelope = Json.object().put("schemaVersion", 1).put("environment", environment).put("digest", digest).put("at", checkedAt);
        envelope.set("state", value.deepCopy());
        Path temporary = filename.resolveSibling(filename.getFileName() + "." + UUID.randomUUID() + ".tmp");
        try {
            Files.createDirectories(directory);
            Files.write(temporary, Json.bytes(envelope), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            try { Files.move(temporary, filename, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
            catch (AtomicMoveNotSupportedException ignored) { Files.move(temporary, filename, StandardCopyOption.REPLACE_EXISTING); }
            persistedAt = checkedAt;
            lastDigest = digest;
        } catch (IOException error) {
            try { Files.deleteIfExists(temporary); } catch (IOException ignored) {}
        }
    }

    private ObjectNode loadDisk() {
        try {
            JsonNode saved = Json.read(Files.readAllBytes(filename));
            if (saved.path("schemaVersion").asInt() != 1 || !environment.equals(saved.path("environment").asText()) || !saved.path("state").isObject()) return null;
            ObjectNode state = (ObjectNode) saved.path("state");
            if (!CanonicalJson.digest(state).equals(saved.path("digest").asText())) return null;
            current = state.deepCopy();
            checkedAt = saved.path("at").asText(null);
            persistedAt = checkedAt;
            lastDigest = saved.path("digest").asText();
            return current.deepCopy();
        } catch (IOException | RuntimeException error) {
            return null;
        }
    }
}
