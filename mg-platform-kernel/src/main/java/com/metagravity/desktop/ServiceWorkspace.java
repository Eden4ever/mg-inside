package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.Instant;
import java.util.*;

/** 目录分类和 API 标签独立于不可变的发布契约。 */
final class ServiceWorkspace {
    static final Set<String> CATEGORIES = Set.of("system", "application", "data", "component", "engine", "uncategorized");
    static ObjectNode empty() {
        var result = Json.object().put("revision", 0);
        result.set("services", Json.object()); result.set("tags", Json.MAPPER.createArrayNode());
        return result;
    }
    static ObjectNode visible(ObjectNode state, ArrayNode publications) {
        Set<String> ids = serviceIds(publications);
        var result = state.deepCopy(); var services = Json.object();
        state.path("services").fields().forEachRemaining(entry -> { if (ids.contains(entry.getKey())) services.set(entry.getKey(), entry.getValue()); });
        result.set("services", services);
        for (JsonNode tag : result.withArray("tags")) {
            var references = Json.MAPPER.createArrayNode();
            tag.path("references").forEach(ref -> { if (ids.contains(ref.path("serviceId").asText())) references.add(ref); });
            ((ObjectNode)tag).set("references", references);
        }
        var events=Json.MAPPER.createArrayNode();
        state.path("events").forEach(event->{
            if(event.has("serviceId")&&!ids.contains(event.path("serviceId").asText()))return;
            var copy=(ObjectNode)event.deepCopy();
            for(String key:List.of("before","after"))if(copy.path(key).has("references")){
                var references=Json.MAPPER.createArrayNode();copy.path(key).path("references").forEach(ref->{if(ids.contains(ref.path("serviceId").asText()))references.add(ref);});
                ((ObjectNode)copy.path(key)).set("references",references);
            }
            events.add(copy);
        });
        result.set("events",events);
        return result;
    }
    static Set<String> serviceIds(ArrayNode publications) {
        var ids = new HashSet<String>(); publications.forEach(p -> ids.add(p.path("manifest").path("serviceId").asText())); return ids;
    }
    static ObjectNode update(ObjectNode state, JsonNode input, ArrayNode publications, String actor) {
        if (!Json.safeInteger(input.path("expectedRevision")) || input.path("expectedRevision").asLong() != state.path("revision").asLong()) throw new ApiException(409, "目录信息已更新，请刷新后重试");
        String kind = input.path("kind").asText();
        var event=Json.object().put("id",UUID.randomUUID().toString()).put("kind",kind).put("at",Instant.now().toString()).put("actor",actor);
        Set<String> fields = kind.equals("service") ? Set.of("kind","expectedRevision","serviceId","category","owner") : Set.of("kind","expectedRevision","id","name","color","enabled","references");
        input.fieldNames().forEachRemaining(key -> { if (!fields.contains(key)) throw new ApiException(400, "目录请求包含不支持的字段"); });
        if (kind.equals("service")) {
            String id = input.path("serviceId").asText();
            if (!serviceIds(publications).contains(id)) throw new ApiException(404, "服务不存在或无权维护");
            String category = string(input, "category", 32), owner = string(input, "owner", 80);
            if (!CATEGORIES.contains(category)) throw new ApiException(400, "服务分类无效");
            event.put("serviceId",id);event.set("before",state.path("services").path(id).deepCopy());
            state.with("services").set(id, Json.object().put("category", category).put("owner", owner));
            event.set("after",state.path("services").path(id).deepCopy());
        } else if (kind.equals("tag")) {
            String id = string(input, "id", 64), name = string(input, "name", 40), color = string(input, "color", 16);
            if (name.isBlank() || !Set.of("primary","success","warning","danger","info").contains(color) || !input.path("enabled").isBoolean()) throw new ApiException(400, "标签名称、颜色或状态无效");
            ObjectNode existing = null;
            for (JsonNode tag : state.withArray("tags")) {
                if (tag.path("id").asText().equals(id)) existing = (ObjectNode)tag;
                else if (tag.path("name").asText().equalsIgnoreCase(name)) throw new ApiException(409, "标签名称已存在");
            }
            if (!id.isEmpty() && existing == null) throw new ApiException(404, "标签不存在");
            if(existing!=null)event.set("before",existing.deepCopy());
            if (existing == null) {
                if (state.withArray("tags").size() >= 200) throw new ApiException(400, "最多维护 200 个标签");
                existing = Json.object().put("id", UUID.randomUUID().toString()); existing.set("references", Json.MAPPER.createArrayNode()); state.withArray("tags").add(existing);
            }
            if (input.has("references")) {
                if (!input.path("references").isArray() || input.path("references").size() > 5000) throw new ApiException(400, "API 关联数量无效");
                Set<String> ids = serviceIds(publications), operations = new HashSet<>(), seen = new HashSet<>();
                publications.forEach(p -> p.path("manifest").path("operations").forEach(op -> operations.add(p.path("manifest").path("serviceId").asText()+"/"+op.path("operationId").asText())));
                var references = Json.MAPPER.createArrayNode();
                existing.path("references").forEach(ref -> { if (!ids.contains(ref.path("serviceId").asText())) references.add(ref); });
                for (JsonNode ref : input.path("references")) {
                    String service = string(ref, "serviceId", 100), operation = string(ref, "operationId", 100), key = service+"/"+operation;
                    if (!operations.contains(key)) throw new ApiException(400, "关联的 API 不存在或无权访问");
                    if (seen.add(key)) references.add(Json.object().put("serviceId", service).put("operationId", operation));
                }
                existing.set("references", references);
            }
            existing.put("name", name).put("color", color).put("enabled", input.path("enabled").asBoolean());
            event.put("tagId",existing.path("id").asText());event.set("after",existing.deepCopy());
        } else throw new ApiException(400, "目录操作无效");
        state.put("revision", state.path("revision").asLong()+1).put("updatedAt", Instant.now().toString()).put("updatedBy", actor);
        var events=state.withArray("events");events.insert(0,event);while(events.size()>300)events.remove(events.size()-1);
        return visible(state, publications);
    }
    private static String string(JsonNode input, String field, int maximum) {
        if (!input.path(field).isTextual() || input.path(field).textValue().length()>maximum) throw new ApiException(400, "字段无效："+field);
        return input.path(field).textValue().strip();
    }
}
