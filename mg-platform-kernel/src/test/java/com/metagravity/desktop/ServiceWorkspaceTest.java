package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import com.fasterxml.jackson.databind.node.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;

class ServiceWorkspaceTest {
    private ArrayNode publications(String... ids){var rows=Json.MAPPER.createArrayNode();for(String id:ids){var manifest=Json.object().put("serviceId",id);manifest.set("operations",Json.MAPPER.createArrayNode().add(Json.object().put("operationId","list")));rows.add(Json.object().set("manifest",manifest));}return rows;}
    @Test void revisionsAndVisibilityProtectCrossServiceReferences(){
        var state=ServiceWorkspace.empty();var all=publications("files.api","private.api");
        var input=Json.object().put("kind","tag").put("id","").put("name","查询").put("color","success").put("enabled",true).put("expectedRevision",0);
        input.set("references",Json.MAPPER.createArrayNode().add(Json.object().put("serviceId","files.api").put("operationId","list")).add(Json.object().put("serviceId","private.api").put("operationId","list")));
        ServiceWorkspace.update(state,input,all,"admin");
        var visible=ServiceWorkspace.visible(state,publications("files.api"));
        assertEquals(1,visible.at("/tags/0/references").size());assertEquals(1,visible.at("/events/0/after/references").size());
        input.put("id",state.at("/tags/0/id").asText()).put("expectedRevision",1).put("name","读取").put("enabled",false);input.set("references",Json.MAPPER.createArrayNode());
        ServiceWorkspace.update(state,input,publications("files.api"),"limited-admin");
        assertEquals("private.api",state.at("/tags/0/references/0/serviceId").asText());
        assertEquals(0,ServiceWorkspace.visible(state,publications("files.api")).at("/tags/0/references").size());
        assertEquals(409,assertThrows(ApiException.class,()->ServiceWorkspace.update(state,input,all,"admin")).status());
        var metadata=Json.object().put("kind","service").put("serviceId","private.api").put("category","system").put("owner","维护人").put("expectedRevision",2);
        assertEquals(404,assertThrows(ApiException.class,()->ServiceWorkspace.update(state,metadata,publications("files.api"),"admin")).status());
        ServiceWorkspace.update(state,metadata,all,"admin");assertFalse(ServiceWorkspace.visible(state,publications("files.api")).path("services").has("private.api"));
        assertEquals(2,ServiceWorkspace.visible(state,publications("files.api")).path("events").size());
    }
    @Test void aggregatesBeyondRecentWindowAndDoesNotInventHistoricalOutcomes(){
        var query=ServiceMetrics.Query.parse(Map.of("from","2026-09-09T00:00:00Z","to","2026-09-09T01:00:00Z","page","7"));
        var accumulator=new ServiceMetrics.Accumulator(query,Set.of("files.api"));
        for(int i=0;i<350;i++)accumulator.add(Json.object().put("id","e"+i).put("serviceId","files.api").put("operationId","list").put("at","2026-09-09T00:01:00Z").put("outcome","success").put("durationMs",20).put("responseBytes",8).put("actor","private"));
        accumulator.add(Json.object().put("serviceId","files.api").put("operationId","list").put("at","2026-09-09T00:02:00Z").put("status",200));
        accumulator.add(Json.object().put("serviceId","private.api").put("at","2026-09-09T00:02:00Z"));
        accumulator.add(Json.object().put("serviceId","files.api").put("at","2026-09-09T01:00:00Z"));
        var result=accumulator.finish("persisted");assertEquals(351,result.path("total").asInt());assertEquals(50,result.path("logs").size());assertFalse(result.path("logs").get(0).has("actor"));
        assertEquals(1,result.at("/summary/unknown").asInt());assertEquals(100,result.at("/summary/successRate").asDouble());assertEquals(2800,result.at("/summary/responseBytes").asInt());assertEquals(12,result.path("series").size());assertEquals(0,result.at("/series/1/count").asInt());
        assertThrows(ApiException.class,()->ServiceMetrics.Query.parse(Map.of("from","2026-01-01T00:00:00Z","to","2026-09-09T01:00:00Z")));
    }
}
