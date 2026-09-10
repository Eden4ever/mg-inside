package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AuthServiceTest {
    @TempDir Path temporary;

    @Test void allApplicationVisibilityUsesIdentityAuthorizationIncludingDefaults() {
        Settings settings = new Settings(Map.of(
            "DESKTOP_RUNTIME_DIR", temporary.toString(),
            "DESKTOP_FLOW_KEY", "12".repeat(32)
        ));
        AppCatalog.App defaultApp = app("database-default", "default");
        AppCatalog.App internalApp = app("database-internal", "internal");
        AppCatalog catalog = new AppCatalog(settings, presentation(), List.of()) {
            @Override public List<App> all() { return List.of(defaultApp, internalApp); }
        };
        var granted=new HashSet<String>();
        IdentityClient identity = new IdentityClient(settings) {
            @Override public Set<String> applications(String token) { return granted; }
            @Override public JsonNode introspect(String token, String app) { throw new ApiException(401, "未授权"); }
            @Override public boolean hasRequiredRole(AppCatalog.App app, String token) { return true; }
        };

        assertEquals(List.of(), new AuthService(identity, catalog).granted("test-token"));
        granted.add(defaultApp.id());
        assertEquals(List.of(defaultApp), new AuthService(identity, catalog).granted("test-token"));
        catalog.close();
    }

    private static AppCatalog.App app(String id, String kind) {
        var data = Json.object().put("id", id).put("name", id).put("description", "测试应用")
            .put("icon", "knowledge").put("kind", kind).put("entryUrl", "https://example.invalid")
            .put("defaultPath", "/").put("minWidth", 640).put("minHeight", 480);
        data.set("allowedPaths", Json.MAPPER.valueToTree(List.of("/")));
        return new AppCatalog.App(data, "https://example.invalid/api", null, null, null, ApplicationPolicy.parse(id, null));
    }

    private static com.fasterxml.jackson.databind.node.ObjectNode presentation() {
        var presentation = Json.object().put("name", "测试桌面");
        var applications = Json.object();
        for (String id : List.of("service-manager", "resource-manager", "low-alt-cockpit", "office-one", "files", "personal-center", "app-manager", "expert-database", "token-one", "token-one-console", "token-one-docs", "identity")) {
            applications.set(id, Json.object().put("name", id).put("description", "测试应用"));
        }
        presentation.set("applications", applications);
        return presentation;
    }
}
