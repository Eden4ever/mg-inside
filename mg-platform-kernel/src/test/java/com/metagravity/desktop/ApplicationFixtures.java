package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** 测试目录只位于 test resources，不打包进运行产物。 */
final class ApplicationFixtures {
    static List<DesktopApplicationCatalogStorage.Row> rows() {
        try (var input = ApplicationFixtures.class.getResourceAsStream("/application-fixture.json")) {
            return List.of(Json.MAPPER.readValue(input, DesktopApplicationCatalogStorage.Row[].class));
        } catch (Exception error) { throw new AssertionError(error); }
    }
    static AppCatalog catalog(Settings settings) { return new AppCatalog(settings, Json.object().put("name", "测试桌面"), rows()); }
    static JsonNode manifest() {
        var result = Json.object().put("schemaVersion", 1);
        result.set("applications", Json.MAPPER.valueToTree(rows())); return result;
    }
}
