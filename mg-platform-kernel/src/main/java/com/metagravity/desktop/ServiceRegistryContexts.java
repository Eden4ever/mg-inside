package com.metagravity.desktop;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/** 为管理 API 提供受控的跨环境目录上下文；业务代理始终只使用本进程运行环境。 */
@Component
public final class ServiceRegistryContexts {
    private final Settings settings;
    private final AppCatalog catalog;
    private final ServiceRegistry running;
    private final Map<String, ServiceRegistry> additional = new ConcurrentHashMap<>();

    public ServiceRegistryContexts(Settings settings, AppCatalog catalog, ServiceRegistry running) {
        this.settings = settings;
        this.catalog = catalog;
        this.running = running;
    }

    public ServiceRegistry select(String environment) {
        try { PostgresServiceRegistryStorage.validateEnvironment(environment); }
        catch (IllegalStateException error) { throw new ApiException(404, "目标环境不存在"); }
        if (running.environment().equals(environment)) return running;
        boolean declared = false;
        for (var item : running.environments()) if (environment.equals(item.path("id").asText())) declared = true;
        if (!declared) throw new ApiException(404, "目标环境不存在");
        if (settings.get("SERVICE_DATABASE_URL", "").isEmpty()) throw new ApiException(409, "目标环境尚未配置");
        try {
            return additional.computeIfAbsent(environment, this::open);
        } catch (ContextFailure failure) {
            if (failure.getCause() instanceof ApiException api) throw api;
            throw new ApiException(503, "目标环境服务目录暂不可用");
        }
    }

    private ServiceRegistry open(String environment) {
        var database = new PostgresServiceRegistryStorage(settings.get("SERVICE_DATABASE_URL", ""), environment);
        var storage = new SnapshotServiceRegistryStorage(database, settings.runtime().resolve("services"), environment);
        var registry = new ServiceRegistry(settings, catalog, storage);
        try {
            registry.initialize();
            return registry;
        } catch (IOException | RuntimeException error) {
            registry.close();
            throw new ContextFailure(error);
        }
    }

    @PreDestroy
    public void close() { additional.values().forEach(ServiceRegistry::close); }

    private static final class ContextFailure extends RuntimeException {
        ContextFailure(Throwable cause) { super(cause); }
    }
}
