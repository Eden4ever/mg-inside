package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ServiceRegistryTest {
    @TempDir Path temporary;

    private Settings settings() {
        return new Settings(Map.of("DESKTOP_RUNTIME_DIR", temporary.toString(), "DESKTOP_FLOW_KEY", "12".repeat(32)));
    }

    private AppCatalog catalog() {
        var presentation = Json.object().put("name", "测试桌面");
        var apps = Json.object();
        for (String id : List.of("service-manager", "resource-manager", "low-alt-cockpit", "office-one", "files", "personal-center", "app-manager", "expert-database", "token-one", "token-one-console", "token-one-docs", "identity")) {
            apps.set(id, Json.object().put("name", id).put("description", "测试应用"));
        }
        presentation.set("applications", apps);
        return new AppCatalog(settings(), presentation, ApplicationFixtures.rows());
    }

    private ServiceRegistry registry() throws Exception {
        var registry = new ServiceRegistry(settings(), catalog());
        registry.initialize();
        return registry;
    }

    @Test void installsDefaultContractsAndResolvesOnlyDeclaredOperations() throws Exception {
        var registry = registry();
        var items = registry.list(Set.of("resource-manager", "files", "office-one", "expert-database", "token-one", "identity"));
        assertEquals(6, items.size());
        assertTrue(items.findValues("contract").size() >= 6);
        var target = registry.resolve("files", "GET", "/entries");
        assertEquals("files.api", target.manifest().path("serviceId").asText());
        assertEquals("list", target.operation().path("operationId").asText());
        assertEquals(404, assertThrows(ApiException.class, () -> registry.resolve("files", "GET", "/entries/a/content/extra")).status());
        assertEquals(404, assertThrows(ApiException.class, () -> registry.resolve("files", "GET", "/entries%2Fa/content")).status());
    }

    @Test void protocolRegistrationCannotBecomeGatewayOrReserveCompatibilityRoutes() throws Exception {
        var registry=registry();var manifest=Json.object().put("schemaVersion",1).put("serviceId","files.protocol").put("appId","files").put("name","文件机器协议").put("version","1.0.0").put("description","目录管理").put("exposure","catalog");
        manifest.set("operations",Json.MAPPER.createArrayNode().add(Json.object().put("operationId","probe").put("method","GET").put("path","/health").put("summary","探针").put("effect","read")).add(Json.object().put("operationId","command").put("method","POST").put("path","/coauthoring/CommandService.ashx").put("summary","命令").put("effect","write")));
        registry.publish(manifest,null,"admin");assertTrue(registry.publish(manifest,null,"admin").path("duplicate").asBoolean());
        assertEquals(409,assertThrows(ApiException.class,()->registry.activate("files.protocol","1.0.0","admin",0,false,false)).status());
        assertNull(registry.resolveApplication("files","GET","/health",true));
        assertEquals(404,assertThrows(ApiException.class,()->registry.invoke("files.protocol","probe","GET",Map.of())).status());
        var state=registry.validateSnapshot(new JsonServiceRegistryStorage(temporary.resolve("services"),"local").read(false));state.with("active").put("files.protocol","1.0.0");assertThrows(IllegalStateException.class,()->registry.validateSnapshot(state));
    }

    @Test void publishingIsImmutableAndActivationUsesOptimisticRevision() throws Exception {
        var registry = registry();
        ObjectNode current = (ObjectNode) registry.list(Set.of("resource-manager")).get(0).path("manifest");
        ObjectNode next = current.deepCopy().put("version", "2.0.0");
        var published = registry.publish(next, null, "owner");
        assertEquals("draft", registry.list(Set.of("resource-manager")).get(1).path("lifecycle").path("status").asText());
        assertTrue(registry.publish(next, null, "owner").path("duplicate").asBoolean());
        assertEquals(409, assertThrows(ApiException.class, () -> registry.publish(next.deepCopy().put("name", "篡改"), null, "owner")).status());
        registry.activate("resource-manager.api", "2.0.0", "owner", 0, false, true);
        assertEquals("2.0.0", registry.resolve("resource-manager", "GET", "/overview").manifest().path("version").asText());
        assertEquals(409, assertThrows(ApiException.class, () -> registry.activate("resource-manager.api", null, "owner", 0, false, true)).status());
        registry.activate("resource-manager.api", null, "owner", 1, false, true);
        assertEquals(404, assertThrows(ApiException.class, () -> registry.resolve("resource-manager", "GET", "/overview")).status());
        var reopened = new ServiceRegistry(settings(), catalog());
        reopened.initialize();
        assertEquals(404, assertThrows(ApiException.class, () -> reopened.resolve("resource-manager", "GET", "/overview")).status());
    }

    @Test void applicationCompatibilityNeverBypassesRegisteredPaths() throws Exception {
        var registry=registry();
        assertNotNull(registry.resolveApplication("files","GET","/entries",true));
        assertNull(registry.resolveApplication("files","GET","/legacy",true));
        assertThrows(ApiException.class,()->registry.resolveApplication("files","GET","/legacy",false));
        assertThrows(ApiException.class,()->registry.resolveApplication("files","POST","/entries",true));
        registry.activate("files.api",null,"owner",0,false,true);
        assertThrows(ApiException.class,()->registry.resolveApplication("files","GET","/entries",true));
    }

    @Test void contractServerBaseComesFromTheContractNotApplicationIdentity() throws Exception {
        var registry=registry();
        ObjectNode item=(ObjectNode)registry.list(Set.of("files")).get(0);
        ObjectNode contract=(ObjectNode)item.path("contract").deepCopy();
        contract.set("servers",Json.MAPPER.createArrayNode().add(Json.object().put("url","/provider/v2")));
        assertDoesNotThrow(()->new ServiceContractValidator().validate(contract,item.path("manifest")));
        for(String invalid:List.of("//evil.example","/api/../secret","/api?url=evil")) {
            contract.set("servers",Json.MAPPER.createArrayNode().add(Json.object().put("url",invalid)));
            assertThrows(ApiException.class,()->new ServiceContractValidator().validate(contract,item.path("manifest")));
        }
    }

    @Test void contractTamperingAndRemoteReferencesAreRejected() throws Exception {
        var registry = registry();
        Path file = temporary.resolve("services/registry.json");
        ObjectNode saved = (ObjectNode) Json.read(Files.readAllBytes(file));
        saved.withArray("publications").get(0).path("contract").path("info").deepCopy();
        ((ObjectNode) saved.withArray("publications").get(0).path("contract").path("info")).put("description", "已篡改");
        Files.write(file, Json.bytes(saved));
        var reopened = new ServiceRegistry(settings(), catalog());
        assertThrows(IllegalStateException.class, reopened::initialize);

        ObjectNode manifest = (ObjectNode) registry.list(Set.of("files")).get(0).path("manifest");
        ObjectNode contract = (ObjectNode) registry.list(Set.of("files")).get(0).path("contract").deepCopy();
        contract.with("components").with("schemas").set("Remote", Json.object().put("$ref", "https://evil.invalid/schema.json"));
        assertEquals(400, assertThrows(ApiException.class, () -> new ServiceContractValidator().validate(contract, manifest)).status());
    }

    @Test void openApiValidationRejectsIdentityOperationParameterSchemaAndSizeDrift() throws Exception {
        var registry = registry();
        ObjectNode item = (ObjectNode) registry.list(Set.of("resource-manager")).get(0);
        ObjectNode manifest = (ObjectNode) item.path("manifest");
        ObjectNode original = (ObjectNode) item.path("contract");
        var validator = new ServiceContractValidator();
        List<java.util.function.Consumer<ObjectNode>> mutations = List.of(
            value -> ((ObjectNode) value.path("info")).put("version", "7.0.0"),
            value -> value.put("x-app-id", "files"),
            value -> ((ObjectNode) value.at("/paths/~1overview/get")).put("operationId", "unknown"),
            value -> ((ObjectNode) value.at("/paths/~1overview/get")).set("responses", Json.object().set("200", Json.object())),
            value -> ((ObjectNode) value.at("/paths/~1resources~1{id}~1refresh/post")).remove("parameters"),
            value -> ((ObjectNode) value.at("/components/schemas")).set("Bad", Json.object().put("type", "invalid-type")),
            value -> value.set("servers", Json.MAPPER.createArrayNode().add(Json.object().put("url", "http://127.0.0.1:22"))),
            value -> ((ObjectNode) value.path("info")).put("description", "x".repeat(513 * 1024))
        );
        for (int index = 0; index < mutations.size(); index++) {
            ObjectNode changed = original.deepCopy();
            mutations.get(index).accept(changed);
            int caseIndex = index;
            assertEquals(400, assertThrows(ApiException.class, () -> validator.validate(changed, manifest), "变异用例 " + caseIndex).status());
        }
    }
}
