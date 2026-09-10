package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import org.junit.jupiter.api.*;

class ServiceApiInventoryTest {
    private ObjectNode document(){
        var value=Json.object().put("schemaVersion",1);
        value.set("categories",Json.MAPPER.createArrayNode().add(Json.object().put("id","component").put("name","组件服务")));
        value.set("boundaries",Json.MAPPER.createArrayNode().add(Json.object().put("id","business").put("name","业务接口")));
        var row=Json.object().put("id","api-office-list").put("provider","files").put("category","component").put("domain","Office 文档").put("boundary","business").put("auth","本人会话").put("summary","文档列表").put("method","GET").put("path","/api/office/documents").put("note","真实来源");
        row.set("appIds",Json.MAPPER.createArrayNode().add("office-one"));row.set("source",Json.object().put("file","mg-files-one/server/http.ts").put("line",26));
        value.set("entries",Json.MAPPER.createArrayNode().add(row));value.set("gaps",Json.MAPPER.createArrayNode());return value;
    }
    private ObjectNode input(long revision,ObjectNode document){var value=Json.object().put("expectedRevision",revision);value.set("document",document);return value;}
    @Test void validatesClassificationAndPreventsDuplicatePathsAndExecutableFields(){
        var doc=document();assertEquals(doc,ServiceApiInventory.validate(doc));
        var infrastructure=document();infrastructure.withArray("boundaries").add(Json.object().put("id","identity").put("name","身份协议"));
        ((ObjectNode)infrastructure.at("/entries/0")).put("boundary","identity").set("appIds",Json.MAPPER.createArrayNode());
        assertEquals(infrastructure,ServiceApiInventory.validate(infrastructure));
        var unownedBusiness=document();((ObjectNode)unownedBusiness.at("/entries/0")).set("appIds",Json.MAPPER.createArrayNode());
        assertThrows(ApiException.class,()->ServiceApiInventory.validate(unownedBusiness));
        ((ObjectNode)doc.at("/entries/0")).put("category","unknown");assertThrows(ApiException.class,()->ServiceApiInventory.validate(doc));
        var duplicate=document();duplicate.withArray("entries").add(duplicate.at("/entries/0").deepCopy());assertThrows(ApiException.class,()->ServiceApiInventory.validate(duplicate));
        var unsafe=document();((ObjectNode)unsafe.at("/entries/0")).put("upstream","http://127.0.0.1/private");assertThrows(ApiException.class,()->ServiceApiInventory.validate(unsafe));
        var secret=document();((ObjectNode)secret.at("/entries/0/source")).put("file","../private.env");assertThrows(ApiException.class,()->ServiceApiInventory.validate(secret));
    }
    @Test void revisionAndDigestPreventLostUpdatesAndDuplicateImports(){
        var state=ServiceApiInventory.empty();var result=ServiceApiInventory.update(state,input(0,document()),"admin");assertEquals(1,result.path("revision").asInt());
        assertTrue(ServiceApiInventory.update(state,input(1,document()),"admin").path("duplicate").asBoolean());assertEquals(1,state.path("revision").asInt());
        assertEquals(409,assertThrows(ApiException.class,()->ServiceApiInventory.update(state,input(0,document()),"admin")).status());
    }
    @Test void joinsActualPublicationWithItsServerPrefixAndDoesNotGrantInvocations(){
        var state=ServiceApiInventory.empty();ServiceApiInventory.update(state,input(0,document()),"admin");
        var manifest=Json.object().put("appId","office-one").put("serviceId","office-one.api").put("version","1.1.0");
        manifest.set("operations",Json.MAPPER.createArrayNode().add(Json.object().put("operationId","list").put("method","GET").put("path","/documents")));
        var contract=Json.object();contract.set("servers",Json.MAPPER.createArrayNode().add(Json.object().put("url","/api/office")));
        var publication=Json.object().put("active",false);publication.set("manifest",manifest);publication.set("contract",contract);
        var visible=ServiceApiInventory.visible(state,Json.MAPPER.createArrayNode().add(publication));
        assertEquals("office-one.api",visible.at("/document/entries/0/registrations/0/serviceId").asText());assertFalse(visible.at("/document/entries/0/registrations/0/active").asBoolean());
        assertFalse(state.at("/document/entries/0").has("registrations"));assertFalse(state.has("active"));
        manifest.put("appId","files");assertTrue(ServiceApiInventory.visible(state,Json.MAPPER.createArrayNode().add(publication)).at("/document/entries/0/registrations").isEmpty());
    }
    @Test void postgresPersistsRevisionHistoryAndRollsBackFailures() throws Exception {
        String url=System.getenv("TEST_POSTGRES_URL");Assumptions.assumeTrue(url!=null&&!url.isBlank());
        try(var storage=new PostgresServiceRegistryStorage(url,"inventory-test")){
            storage.applySchema(ServiceStorageAdmin.apiInventorySchema());
            long before=storage.apiInventory().path("revision").asLong();
            storage.apiInventoryTransaction((saved,context)->ServiceApiInventory.update(saved,input(before,document()),"test"));
            long revision=storage.apiInventory().path("revision").asLong();assertEquals(before+1,revision);
            assertThrows(ApiException.class,()->storage.apiInventoryTransaction((saved,context)->{saved.put("revision",revision+1);throw new ApiException(409,"回滚");}));
            try(var another=new SnapshotServiceRegistryStorage(new PostgresServiceRegistryStorage(url,"inventory-other"),java.nio.file.Path.of(System.getProperty("java.io.tmpdir")),"inventory-other")){
                assertEquals(revision,another.apiInventory().path("revision").asLong());
            }
            try(var connection=java.sql.DriverManager.getConnection(url);var statement=connection.prepareStatement("SELECT value FROM service_api_inventory_history WHERE revision=?")){
                statement.setLong(1,revision);try(var rows=statement.executeQuery()){assertTrue(rows.next());assertEquals("test",Json.read(rows.getString(1)).path("updatedBy").asText());}
            }
        }
    }
}
