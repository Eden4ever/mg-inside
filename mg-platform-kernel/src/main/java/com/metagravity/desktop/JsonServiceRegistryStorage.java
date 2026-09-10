package com.metagravity.desktop;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;

/** 单实例开发与回退模式使用的原子 JSON 存储。 */
public final class JsonServiceRegistryStorage implements ServiceRegistryStorage {
    private final Path directory;
    private final String environment;

    public JsonServiceRegistryStorage(Path directory, String environment) {
        this.directory = directory;
        this.environment = environment;
    }

    @Override public synchronized ObjectNode read(boolean allowCache) {
        try {
            Files.createDirectories(directory);
            Path file = directory.resolve("registry.json");
            return Files.exists(file) ? (ObjectNode) Json.read(Files.readAllBytes(file)) : emptyState();
        } catch (IOException error) {
            throw new IllegalStateException("服务目录读取失败", error);
        }
    }

    @Override public synchronized <T> T transaction(Change<T> change) {
        ObjectNode state = read(false);
        T value = change.apply(state, new Context(environment, Json.MAPPER.createArrayNode()));
        write(state);
        return value;
    }

    @Override public ObjectNode status() {
        return Json.object().put("backend", "json").put("environment", environment);
    }

    private void write(ObjectNode state) {
        Path temporary = directory.resolve("registry-" + UUID.randomUUID() + ".tmp");
        try {
            Files.write(temporary, Json.bytes(state), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            try {
                Files.move(temporary, directory.resolve("registry.json"), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, directory.resolve("registry.json"), StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException error) {
            try { Files.deleteIfExists(temporary); } catch (IOException ignored) {}
            throw new IllegalStateException("服务目录写入失败", error);
        }
    }

    static ObjectNode emptyState() {
        var value = Json.object().put("schemaVersion", 1);
        value.set("publications", Json.MAPPER.createArrayNode());
        value.set("active", Json.object());
        value.set("audit", Json.MAPPER.createArrayNode());
        value.set("activity", Json.MAPPER.createArrayNode());
        value.set("revisions", Json.object());
        value.set("lifecycles", Json.object());
        value.set("bindings", Json.object());
        return value;
    }
}
