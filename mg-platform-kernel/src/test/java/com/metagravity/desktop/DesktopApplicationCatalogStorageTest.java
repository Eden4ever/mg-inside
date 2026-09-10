package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.*;

class DesktopApplicationCatalogStorageTest {
    @Test void policyUpgradePreservesOldBehaviorAndIsIdempotent() throws Exception {
        String base=System.getenv("TEST_POSTGRES_URL");
        Assumptions.assumeTrue(base!=null&&!base.isBlank(),"需要隔离 PostgreSQL 测试地址");
        String schema="policy_"+UUID.randomUUID().toString().replace("-","");
        try(var connection=DriverManager.getConnection(base);var sql=connection.createStatement()) {
            sql.execute("CREATE SCHEMA "+schema);
            String url=base+(base.contains("?")?"&":"?")+"currentSchema="+schema;
            try(var storage=new DesktopApplicationCatalogStorage(url);var local=DriverManager.getConnection(url);var query=local.createStatement()) {
                try(var input=getClass().getResourceAsStream("/db/migration/V2__desktop_applications.sql")) {
                    storage.applySchema(new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
                }
                query.execute("INSERT INTO desktop_applications(id,name,description,entry_url,upstream_url,default_path,allowed_paths,icon,kind,enabled,sort_order) VALUES('identity','旧名称','','https://id.example','https://id.example/api','/','[\"/\"]','identity','system',false,77),('token-one-docs','文档','','https://docs.example','https://docs.example/api','/','[\"/\"]','token','internal',true,88)");
                storage.applySchema(DesktopApplicationCatalogAdmin.schema());
                var rows=storage.readRegistered();
                var identity=rows.stream().filter(row->row.id().equals("identity")).findFirst().orElseThrow();
                assertEquals("/user/role",ApplicationPolicy.parse(identity.id(),identity.runtimePolicy()).rolePointer());
                assertEquals("compatibility",ApplicationPolicy.parse(identity.id(),identity.runtimePolicy()).apiMode());
                assertEquals(1,storage.read().size());
                var docs=ApplicationPolicy.parse("token-one-docs",rows.get(1).runtimePolicy());
                assertEquals("token-one",docs.versionOwnerAppId());assertEquals(List.of("GET","HEAD"),docs.allowedApiMethods());
                query.execute("UPDATE desktop_applications SET runtime_policy=jsonb_set(runtime_policy,'{apiMode}','\"registered\"') WHERE id='identity'");
                storage.applySchema(DesktopApplicationCatalogAdmin.schema());
                try(var result=query.executeQuery("SELECT name,enabled,sort_order,runtime_policy->>'apiMode' FROM desktop_applications WHERE id='identity'")) {
                    assertTrue(result.next());assertEquals("旧名称",result.getString(1));assertFalse(result.getBoolean(2));assertEquals(77,result.getInt(3));assertEquals("registered",result.getString(4));
                }
                try(var result=query.executeQuery("SELECT count(*) FROM desktop_application_audit")) {assertTrue(result.next());assertEquals(2,result.getInt(1));}
            } finally {sql.execute("DROP SCHEMA "+schema+" CASCADE");}
        }
    }

    @Test void databaseIsLiveAndExclusiveAndMigrationIsAtomic() throws Exception {
        String base = System.getenv("TEST_POSTGRES_URL");
        Assumptions.assumeTrue(base != null && !base.isBlank(), "需要隔离 PostgreSQL 测试地址");
        String schema = "applications_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = DriverManager.getConnection(base); var statement = connection.createStatement()) {
            statement.execute("CREATE SCHEMA " + schema);
            String url = base + (base.contains("?") ? "&" : "?") + "currentSchema=" + schema;
            try { verify(url); }
            finally { statement.execute("DROP SCHEMA " + schema + " CASCADE"); }
        }
    }

    private void verify(String url) throws Exception {
        Settings settings = new Settings(Map.of("SERVICE_DATABASE_URL", url));
        var presentation = Json.object().put("name", "测试桌面");
        try (var storage = new DesktopApplicationCatalogStorage(url);
             var fixture = ApplicationFixtures.catalog(new Settings(Map.of()));
             var connection = DriverManager.getConnection(url);
             var sql = connection.createStatement()) {
            assertEquals(503, assertThrows(ApiException.class, storage::read).status());
            storage.applySchema(DesktopApplicationCatalogAdmin.schema());
            assertThrows(IllegalStateException.class, () -> new AppCatalog(settings, presentation));
            assertEquals(12, storage.seed(fixture.all(), "integration-test"));
            assertEquals(0, storage.seed(fixture.all(), "integration-test"));
            try (var catalog = new AppCatalog(settings, presentation)) {
                assertEquals(12, catalog.all().size());
                assertTrue(catalog.find("low-alt-cockpit").orElseThrow().publicData().path("defaultMaximized").asBoolean());
                assertFalse(catalog.find("low-alt-cockpit").orElseThrow().allowsApi("/health"));
                sql.executeUpdate("UPDATE desktop_applications SET name='数据库名称',icon='resource-manager',sort_order=-1,entry_url='https://new.example.org',upstream_url='https://new.example.org/api' WHERE id='files'");
                assertEquals("files", catalog.all().getFirst().id());
                assertEquals("数据库名称", catalog.find("files").orElseThrow().publicData().path("name").asText());
                assertEquals("resource-manager", catalog.find("files").orElseThrow().publicData().path("icon").asText());
                assertTrue(catalog.allowedOrigins().contains("https://new.example.org"));
                assertEquals("https://new.example.org/api", catalog.find("files").orElseThrow().upstream());
                sql.executeUpdate("UPDATE desktop_applications SET enabled=false WHERE id='files'");
                assertTrue(catalog.find("files").isEmpty());
                assertTrue(catalog.registeredIds().contains("files"));
                assertFalse(catalog.allowedOrigins().contains("https://new.example.org"));
                var external = new UserState(settings, catalog);
                assertThrows(ApiException.class, () -> external.externalApplication(Json.object().put("name", "冒充").put("url", "https://new.example.org")));

                var extra = fixture.all().getFirst().publicData().deepCopy().put("id", "new-application");
                var candidate = new AppCatalog.App(extra, "https://example.org/api", null, null, null, ApplicationPolicy.parse("new-application", null));
                var conflicting = new ArrayList<AppCatalog.App>(); conflicting.add(candidate); conflicting.addAll(fixture.all());
                assertThrows(IllegalStateException.class, () -> storage.seed(conflicting, "integration-test"));
                assertFalse(catalog.registeredIds().contains("new-application"));
                try (var audit = sql.executeQuery("SELECT count(*) FROM desktop_application_audit")) { assertTrue(audit.next()); assertEquals(12, audit.getInt(1)); }

                sql.executeUpdate("UPDATE desktop_applications SET allowed_paths='[\"//outside\"]'::jsonb WHERE id='low-alt-cockpit'");
                assertThrows(IllegalStateException.class, catalog::all);
                sql.executeUpdate("UPDATE desktop_applications SET enabled=false");
                assertTrue(catalog.all().isEmpty());
                sql.execute("ALTER TABLE desktop_applications RENAME TO unavailable_applications");
                assertEquals(503, assertThrows(ApiException.class, catalog::all).status());
                assertEquals(503, assertThrows(ApiException.class, () -> new AppCatalog(settings, presentation)).status());
            }
        }
    }
}
