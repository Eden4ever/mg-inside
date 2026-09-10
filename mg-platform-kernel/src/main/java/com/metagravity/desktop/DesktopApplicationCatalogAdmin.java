package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/** 桌面应用目录离线迁移入口。数据库连接只从环境读取，输出不包含连接信息。 */
public final class DesktopApplicationCatalogAdmin {
    private DesktopApplicationCatalogAdmin() {}

    public static boolean requested(String[] args) { return args.length > 0 && "desktop-applications".equals(args[0]); }

    public static int run(String[] args) {
        try {
            System.out.println(Json.text(execute(args, new Settings())));
            return 0;
        } catch (RuntimeException | IOException error) {
            System.err.println("桌面应用目录迁移失败；请核对数据库状态、迁移账号权限和应用配置，未输出连接信息。");
            return 1;
        }
    }

    static JsonNode execute(String[] args, Settings settings) throws IOException {
        boolean schemaOnly = args.length == 2 && "schema".equals(args[1]);
        if (!schemaOnly && (args.length != 3 || !"migrate".equals(args[1]))) throw new IllegalArgumentException("使用 desktop-applications schema 升级结构，或 migrate <注册清单.json> 显式导入");
        String database = settings.get("SERVICE_DATABASE_URL", "");
        if (database.isBlank()) throw new IllegalStateException("需要服务数据库连接配置");
        if (schemaOnly) {
            try (var storage = new DesktopApplicationCatalogStorage(database)) { storage.applySchema(schema()); }
            return Json.object().put("migrated", true).put("schemaOnly", true);
        }
        Path file = Path.of(args[2]);
        if (Files.size(file) > 1024 * 1024) throw new IllegalStateException("应用注册清单超过大小限制");
        List<AppCatalog.App> applications = parse(Json.read(Files.readAllBytes(file)), settings);
        try (var storage = new DesktopApplicationCatalogStorage(database)) {
            storage.applySchema(schema());
            int inserted = storage.seed(applications, settings.get("DESKTOP_CATALOG_ACTOR", "migration"));
            return Json.object().put("migrated", true).put("inserted", inserted).put("applications", applications.size());
        }
    }

    static List<AppCatalog.App> parse(JsonNode input, Settings settings) {
        if (!input.isObject() || input.size() != 2 || !input.path("schemaVersion").isIntegralNumber()
            || !input.path("schemaVersion").canConvertToInt() || input.path("schemaVersion").intValue() != 1 || !input.path("applications").isArray()
            || input.path("applications").isEmpty() || input.path("applications").size() > 1000)
            throw new IllegalStateException("应用注册清单格式无效");
        var applications = new ArrayList<AppCatalog.App>();
        var ids = new HashSet<String>();
        for (JsonNode item : input.path("applications")) {
            try {
                if (!item.isObject()) throw new IllegalArgumentException();
                Set<String> allowed = Set.of("id","name","description","entryUrl","upstream","defaultPath","allowedPaths","allowedApiPaths","icon","kind","authorizationAppId","requiredRole","minWidth","minHeight","defaultMaximized","runtimePolicy");
                item.fieldNames().forEachRemaining(field -> { if (!allowed.contains(field)) throw new IllegalArgumentException(); });
                for (String field : List.of("minWidth", "minHeight"))
                    if (!item.path(field).isIntegralNumber() || !item.path(field).canConvertToInt()) throw new IllegalArgumentException();
                if (!item.path("defaultMaximized").isBoolean()) throw new IllegalArgumentException();
                for (String field : List.of("id", "name", "description", "entryUrl", "upstream", "defaultPath", "icon", "kind"))
                    if (!item.path(field).isTextual()) throw new IllegalArgumentException();
                for (String field : List.of("authorizationAppId", "requiredRole"))
                    if (item.hasNonNull(field) && !item.path(field).isTextual()) throw new IllegalArgumentException();
                for (String field : List.of("allowedPaths", "allowedApiPaths")) {
                    if (field.equals("allowedApiPaths") && !item.hasNonNull(field)) continue;
                    if (!item.path(field).isArray()) throw new IllegalArgumentException();
                    for (JsonNode path : item.path(field)) if (!path.isTextual()) throw new IllegalArgumentException();
                }
                var row = Json.MAPPER.treeToValue(item, DesktopApplicationCatalogStorage.Row.class);
                AppCatalog.App app = AppCatalog.databaseApp(settings, row);
                if (!ids.add(app.id())) throw new IllegalArgumentException();
                applications.add(app);
            } catch (Exception error) { throw new IllegalStateException("应用注册项无效或标识重复"); }
        }
        return List.copyOf(applications);
    }

    static String schema() throws IOException {
        var sql = new StringBuilder();
        for (String file : List.of("V2__desktop_applications.sql", "V3__desktop_application_icon_keys.sql", "V5__desktop_application_policy.sql", "V7__desktop_application_metadata.sql", "V8__desktop_application_version.sql", "V9__kernel_application_registry.sql")) {
            try (InputStream input = DesktopApplicationCatalogAdmin.class.getResourceAsStream("/db/migration/" + file)) {
                if (input == null) throw new IOException("缺少桌面应用目录结构");
                sql.append(new String(input.readAllBytes(), StandardCharsets.UTF_8)).append('\n');
            }
        }
        return sql.toString();
    }

}
