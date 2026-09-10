package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.junit.jupiter.api.Test;

class AppCatalogTest {
    @Test void runtimeRequiresDatabaseEvenWithCompletePresentationAndLegacyEnvironment() {
        for (String mode : List.of("test", "production")) {
            var settings = new Settings(Map.of("NODE_ENV", mode, "FILES_WEB_URL", "https://ignored.invalid"));
            var presentation = Json.object().put("name", "桌面");
            presentation.set("applications", ApplicationFixtures.manifest().path("applications"));
            assertEquals("应用注册数据库未配置", assertThrows(IllegalStateException.class, () -> new AppCatalog(settings, presentation)).getMessage());
        }
    }

    @Test void metadataAndAccessRulesComeFromRows() {
        var settings = new Settings(Map.of("FILES_WEB_URL", "https://ignored.invalid"));
        var presentation = Json.object().put("name", "桌面");
        presentation.set("applications", Json.object().set("files", Json.object().put("name", "错误覆盖")));
        try (var catalog = new AppCatalog(settings, presentation, ApplicationFixtures.rows())) {
            var files = catalog.find("files").orElseThrow();
            assertEquals("文件", files.publicData().path("name").asText());
            assertEquals("http://127.0.0.1:14351", files.entryUrl());
            assertEquals("files", files.publicData().path("icon").asText());
        }
    }

    @Test void explicitImportRejectsUnknownFieldsCoercionDuplicateIdsAndUnsafeRules() {
        var settings = new Settings(Map.of());
        assertEquals(12, DesktopApplicationCatalogAdmin.parse(ApplicationFixtures.manifest(), settings).size());
        for (String field : List.of("minWidth", "defaultMaximized", "allowedPaths", "id", "unexpected")) {
            var input = (ObjectNode) ApplicationFixtures.manifest();
            ((ObjectNode) input.path("applications").get(0)).put(field, "!invalid");
            assertThrows(IllegalStateException.class, () -> DesktopApplicationCatalogAdmin.parse(input, settings));
        }
        var duplicate = (ObjectNode) ApplicationFixtures.manifest();
        duplicate.withArray("applications").add(duplicate.path("applications").get(0).deepCopy());
        assertThrows(IllegalStateException.class, () -> DesktopApplicationCatalogAdmin.parse(duplicate, settings));
        for (String path : List.of("//outside", "/../admin", "/%2e%2e/admin")) {
            var input = (ObjectNode) ApplicationFixtures.manifest();
            ((ObjectNode) input.path("applications").get(0)).put("defaultPath", path);
            assertThrows(IllegalStateException.class, () -> DesktopApplicationCatalogAdmin.parse(input, settings));
        }
    }
}
