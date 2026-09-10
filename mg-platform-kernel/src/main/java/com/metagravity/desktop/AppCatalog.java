package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.springframework.stereotype.Component;
import jakarta.annotation.PreDestroy;

@Component
public class AppCatalog implements AutoCloseable {
    public record App(ObjectNode publicData, String upstream, String authorizationAppId, List<String> allowedApiPaths, String requiredRole, ApplicationPolicy policy) {
        public String id() { return publicData.path("id").asText(); }
        public String entryUrl() { return publicData.path("entryUrl").asText(); }
        public String audience() { return authorizationAppId == null ? id() : authorizationAppId; }
        public boolean isDefault() { return "default".equals(publicData.path("kind").asText()); }
        public boolean allowsPage(String path) {
            String pathname = Urls.safeAppPath(path, "/").split("\\?", 2)[0];
            for (var prefix : publicData.path("allowedPaths")) if (pathname.equals(prefix.asText()) || !prefix.asText().equals("/") && pathname.startsWith(prefix.asText() + "/")) return true;
            return false;
        }
        public boolean allowsApi(String path) {
            if (allowedApiPaths == null) return true;
            try {
                String normalized = Urls.decode(URI.create("https://application.invalid" + path).normalize().getRawPath());
                return normalized.matches("/[A-Za-z0-9/_-]*") && allowedApiPaths.stream().anyMatch(prefix -> normalized.equals(prefix) || normalized.startsWith(prefix + "/"));
            } catch (RuntimeException e) { return false; }
        }
    }
    private final Settings settings;
    private final java.util.function.Supplier<List<DesktopApplicationCatalogStorage.Row>> source;
    private final String desktopName;
    private DesktopApplicationCatalogStorage databaseStorage;
    @org.springframework.beans.factory.annotation.Autowired
    public AppCatalog(Settings settings) throws IOException {
        this(settings, Json.read(Files.readAllBytes(Path.of(settings.get("DESKTOP_CONFIG_FILE", "../mg-platform/packages/frontend/config/application-catalog.json")))));
    }
    public AppCatalog(Settings settings, JsonNode presentation) {
        this.settings = settings;
        desktopName = Json.string(presentation, "name").strip();
        if (desktopName.isEmpty() || desktopName.length() > 80) throw new IllegalStateException("桌面名称配置无效");
        String database = settings.get("SERVICE_DATABASE_URL", "");
        if (database.isBlank()) throw new IllegalStateException("应用注册数据库未配置");
        databaseStorage = new DesktopApplicationCatalogStorage(database);
        source = databaseStorage::read;
        try { if (registered().isEmpty()) throw new IllegalStateException("应用注册数据库为空，请先执行显式迁移"); }
        catch (RuntimeException error) { close(); throw error; }
    }
    AppCatalog(Settings settings, JsonNode presentation, List<DesktopApplicationCatalogStorage.Row> rows) {
        this.settings = settings;
        desktopName = Json.string(presentation, "name");
        List<DesktopApplicationCatalogStorage.Row> copy = List.copyOf(rows);
        source = () -> copy;
    }

    static App databaseApp(Settings settings, DesktopApplicationCatalogStorage.Row row) {
        if (row.id() == null || !row.id().matches("[a-z][a-z0-9-]{1,63}")) throw new IllegalStateException("应用标识无效");
        if (row.name() == null || row.name().isBlank() || row.name().length() > 80 || row.description() == null || row.description().length() > 200) throw new IllegalStateException("应用展示配置无效：" + row.id());
        if (row.minWidth() < 320 || row.minWidth() > 4_000 || row.minHeight() < 240 || row.minHeight() > 4_000) throw new IllegalStateException("应用窗口尺寸无效：" + row.id());
        String entry = settings.validateAddress("应用入口", row.entryUrl(), false);
        String upstream = settings.validateAddress("应用上游", row.upstream(), true);
        if (!path(row.defaultPath())) throw new IllegalStateException("应用默认路径无效：" + row.id());
        if (row.allowedPaths() == null || row.allowedPaths().isEmpty()) throw new IllegalStateException("应用允许路径不能为空：" + row.id());
        for (String path : row.allowedPaths()) if (!path(path)) throw new IllegalStateException("应用允许路径无效：" + row.id());
        if (row.icon() == null || !row.icon().matches("[a-z][a-z0-9-]{0,63}") || row.kind() == null || !Set.of("default","system","internal").contains(row.kind())) throw new IllegalStateException("应用类型配置无效：" + row.id());
        if (row.authorizationAppId()!=null && !row.authorizationAppId().matches("[a-z][a-z0-9-]{1,63}")) throw new IllegalStateException("应用授权标识无效：" + row.id());
        if (row.requiredRole()!=null && !row.requiredRole().matches("[a-z][a-z0-9_-]{0,63}")) throw new IllegalStateException("应用角色配置无效：" + row.id());
        if (row.allowedApiPaths()!=null) for (String path : row.allowedApiPaths()) if (!path(path)) throw new IllegalStateException("应用 API 路径无效：" + row.id());
        var data = Json.object().put("id", row.id()).put("name", row.name()).put("description", row.description()).put("icon", row.icon())
            .put("entryUrl", entry).put("defaultPath", row.defaultPath()).put("minWidth", row.minWidth()).put("minHeight", row.minHeight());
        data.set("allowedPaths", Json.MAPPER.valueToTree(row.allowedPaths()));
        if (row.defaultMaximized()) data.put("defaultMaximized", true);
        data.put("kind", row.kind());
        var app = new App(data, upstream, row.authorizationAppId(), row.allowedApiPaths(), row.requiredRole(), ApplicationPolicy.parse(row.id(), row.runtimePolicy()));
        if (!app.allowsPage(row.defaultPath())) throw new IllegalStateException("应用默认路径不在允许范围：" + row.id());
        return app;
    }

    private static boolean path(String value) { return value != null && value.matches("/[A-Za-z0-9/_-]*"); }

    @PreDestroy public void close() { if (databaseStorage != null) databaseStorage.close(); }
    public List<App> all() {
        return validate(source.get());
    }
    private List<App> validate(List<DesktopApplicationCatalogStorage.Row> rows) {
        var result = new ArrayList<App>();
        var ids = new HashSet<String>();
        for (var row : rows) {
            App app = databaseApp(settings, row);
            if (!ids.add(app.id())) throw new IllegalStateException("应用目录包含重复标识");
            result.add(app);
        }
        return List.copyOf(result);
    }
    // 停用只阻断运行入口；服务历史与外链主机保护仍需识别已登记的应用。
    public List<App> registered() { return databaseStorage == null ? all() : validate(databaseStorage.readRegistered()); }
    public Set<String> registeredIds() {
        var ids = new HashSet<String>(); registered().forEach(app -> ids.add(app.id())); return Set.copyOf(ids);
    }
    public Optional<App> find(String id) { return all().stream().filter(app -> app.id().equals(id)).findFirst(); }
    public Set<String> allowedOrigins() {
        var origins = new HashSet<String>(); origins.add(settings.desktopOrigin());
        all().forEach(app -> origins.add(Settings.origin(URI.create(app.entryUrl()))));
        return Set.copyOf(origins);
    }
    public Map<String,String> presentation() { return Map.of("name",desktopName); }
    public ObjectNode metadata(String id) { return databaseStorage == null ? Json.object() : databaseStorage.metadata(id); }
    public com.fasterxml.jackson.databind.node.ArrayNode directory() {
        if(databaseStorage==null)throw new ApiException(503,"应用注册数据库未配置");
        return databaseStorage.directory();
    }
    public ObjectNode directoryItem(String id) {
        for(var item:directory())if(id.equals(item.path("id").asText()))return (ObjectNode)item;
        throw new ApiException(404,"应用不存在");
    }
    public void register(JsonNode input,String actor) {
        if(databaseStorage==null)throw new ApiException(503,"应用注册数据库未配置");
        databaseStorage.register(input,actor);
    }
    public void configureRuntime(String id,JsonNode input,String actor) {
        var current=directoryItem(id);
        if(input==null || !input.isObject() || !Json.safeInteger(input.path("expectedRevision")))throw new ApiException(400,"应用入口配置或修订号无效");
        var candidate=(ObjectNode)input.deepCopy();candidate.remove("expectedRevision");
        if(candidate.has("id") || candidate.has("name") || candidate.has("description"))throw new ApiException(400,"入口配置不可修改应用标识或展示信息");
        candidate.put("id",id).put("name",current.path("name").asText()).put("description",current.path("description").asText());
        var document=Json.object().put("schemaVersion",1);document.putArray("applications").add(candidate);
        App app;
        try{app=DesktopApplicationCatalogAdmin.parse(document,settings).getFirst();}catch(RuntimeException error){throw new ApiException(400,"应用入口地址、路径或策略配置无效");}
        databaseStorage.configureRuntime(app,input.path("expectedRevision").longValue(),actor);
    }
    public void updateMetadata(String id, JsonNode input, String actor) {
        if (databaseStorage == null) throw new ApiException(503, "应用注册数据库未配置");
        databaseStorage.updateMetadata(id, input, actor);
    }
}
