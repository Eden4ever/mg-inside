package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.*;

/** API 台账只管理元数据；执行权限和启用状态仍由版本登记与部署绑定决定。 */
public final class ServiceApiInventory {
    private ServiceApiInventory() {}
    public static ObjectNode empty() {
        var document=Json.object().put("schemaVersion",1);
        for(String key:List.of("categories","boundaries","entries","gaps"))document.set(key,Json.MAPPER.createArrayNode());
        var result=Json.object().put("revision",0);result.set("document",document);return result;
    }
    static ObjectNode validate(JsonNode input) {
        only(input,Set.of("schemaVersion","categories","boundaries","entries","gaps"));
        if(!input.path("schemaVersion").isIntegralNumber()||input.path("schemaVersion").asInt()!=1)throw bad();
        Set<String> categories=terms(input.path("categories")),boundaries=terms(input.path("boundaries"));
        JsonNode entries=input.path("entries"),gaps=input.path("gaps");
        if(!entries.isArray()||entries.size()>5000||!gaps.isArray()||gaps.size()>100)throw bad();
        Set<String> keys=new HashSet<>(),ids=new HashSet<>();
        for(JsonNode entry:entries) {
            only(entry,Set.of("id","provider","appIds","category","domain","boundary","auth","summary","method","path","source","note"));
            for(String key:List.of("id","provider","category","boundary"))if(!string(entry,key,100).matches("[a-z0-9][a-z0-9.-]*"))throw bad();
            for(String key:List.of("domain","auth","summary"))string(entry,key,300);
            string(entry,"note",1500);
            if(!categories.contains(entry.path("category").asText())||!boundaries.contains(entry.path("boundary").asText()))throw bad();
            String method=string(entry,"method",10),path=string(entry,"path",500);
            if(!Set.of("GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS","ANY","WS").contains(method)||!path.matches("/[A-Za-z0-9/_.{}*~-]*")||path.contains("//")||path.contains(".."))throw bad();
            if(!entry.path("appIds").isArray()||entry.path("appIds").isEmpty()||entry.path("appIds").size()>20)throw bad();
            Set<String> apps=new HashSet<>();for(JsonNode app:entry.path("appIds"))if(!app.isTextual()||!app.textValue().matches("[a-z][a-z0-9-]{0,99}")||!apps.add(app.textValue()))throw bad();
            String key=entry.path("provider").asText()+" "+method+" "+path.replaceAll("\\{[^}]+}","{}");
            if(!keys.add(key)||!ids.add(entry.path("id").asText()))throw new ApiException(400,"API 台账存在重复接口");
            JsonNode source=entry.path("source");only(source,Set.of("file","line"));
            String file=string(source,"file",500);
            if(file.contains(":")||file.startsWith("/")||file.contains("\\")||file.contains(".."))throw bad();
            if(!source.path("line").isIntegralNumber()||source.path("line").asInt()<1)throw bad();
        }
        for(JsonNode gap:gaps){only(gap,Set.of("provider","description"));string(gap,"provider",100);string(gap,"description",1500);}
        return (ObjectNode)input.deepCopy();
    }
    static ObjectNode update(ObjectNode saved,JsonNode input,String actor) {
        only(input,Set.of("expectedRevision","document"));
        if(!Json.safeInteger(input.path("expectedRevision"))||input.path("expectedRevision").asLong()!=saved.path("revision").asLong())throw new ApiException(409,"API 台账已更新，请刷新后重试");
        var document=validate(input.path("document"));String digest=CanonicalJson.digest(document);
        if(digest.equals(saved.path("digest").asText()))return saved.deepCopy().put("duplicate",true);
        saved.put("revision",saved.path("revision").asLong()+1).put("digest",digest).put("updatedAt",Instant.now().toString()).put("updatedBy",actor);
        saved.set("document",document);return saved.deepCopy().put("duplicate",false);
    }
    static ObjectNode visible(ObjectNode saved,JsonNode publications) {
        var result=saved.deepCopy();
        for(JsonNode row:result.path("document").path("entries")) {
            var entry=(ObjectNode)row;var registrations=Json.MAPPER.createArrayNode();
            for(JsonNode publication:publications){
                JsonNode manifest=publication.path("manifest");boolean appMatch=false;
                for(JsonNode app:entry.path("appIds"))appMatch|=app.asText().equals(manifest.path("appId").asText());
                if(!appMatch)continue;
                String base=ServiceRules.catalogOnly(manifest)?"":publication.at("/contract/servers/0/url").asText("/api").replaceAll("/$","");
                for(JsonNode operation:manifest.path("operations")){
                    String path=base+operation.path("path").asText();
                    if(!entry.path("method").asText().equals(operation.path("method").asText())||!shape(entry.path("path").asText()).equals(shape(path)))continue;
                    registrations.add(Json.object().put("serviceId",manifest.path("serviceId").asText()).put("version",manifest.path("version").asText()).put("operationId",operation.path("operationId").asText()).put("active",publication.path("active").asBoolean()).put("hasContract",publication.path("contract").isObject()));
                }
            }
            entry.set("registrations",registrations);
        }
        return result;
    }
    private static String shape(String value){return value.replaceAll("\\{[^}]+}","{}");}
    private static Set<String> terms(JsonNode terms){
        if(!terms.isArray()||terms.isEmpty()||terms.size()>50)throw bad();Set<String> ids=new HashSet<>();
        for(JsonNode term:terms){only(term,Set.of("id","name"));String id=string(term,"id",60);string(term,"name",80);if(!id.matches("[a-z][a-z0-9-]*")||!ids.add(id))throw bad();}return ids;
    }
    private static String string(JsonNode value,String key,int limit){JsonNode node=value.path(key);if(!node.isTextual()||node.asText().isBlank()||node.asText().length()>limit||node.asText().chars().anyMatch(c->c<32))throw bad();return node.asText();}
    private static void only(JsonNode value,Set<String> keys){if(!value.isObject())throw bad();value.fieldNames().forEachRemaining(key->{if(!keys.contains(key))throw bad();});}
    private static ApiException bad(){return new ApiException(400,"API 台账字段、分类或来源无效");}
}
