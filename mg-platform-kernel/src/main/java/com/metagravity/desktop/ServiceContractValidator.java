package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.Schema;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SpecificationVersion;
import com.networknt.schema.dialect.Dialects;
import java.io.InputStream;
import java.util.*;
import java.util.regex.Pattern;

/** 校验平台接受的 OpenAPI 3.1 契约子集，不解析任何磁盘或网络引用。 */
public final class ServiceContractValidator {
    private static final int MAX_BYTES = 512 * 1024;
    private static final int MAX_DEPTH = 48;
    private static final int MAX_NODES = 30_000;
    private static final Set<String> METHODS = Set.of("get", "post", "put", "patch", "delete", "head", "options", "trace");
    private static final Set<String> FORBIDDEN = Set.of("__proto__", "prototype", "constructor", "$id", "$anchor", "$dynamicAnchor", "$dynamicRef", "$async");
    private static final Pattern REFERENCE = Pattern.compile("^#/components/(schemas|parameters|responses|requestBodies|headers)/[A-Za-z0-9._-]+$");
    private static final Pattern PATH_PARAMETER = Pattern.compile("\\{([A-Za-z][A-Za-z0-9]*)}");
    private final SchemaRegistry schemaRegistry;
    private final Schema documentSchema;
    private final Schema schemaMetaSchema;

    public ServiceContractValidator() {
        try (InputStream input = ServiceContractValidator.class.getResourceAsStream("/schemas/openapi-3.1.json")) {
            if (input == null) throw new IllegalStateException("缺少 OpenAPI 3.1 结构 Schema");
            JsonNode schema = Json.read(input.readAllBytes()).deepCopy();
            bindDynamicSchemaReferences(schema);
            schemaRegistry = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12);
            documentSchema = schemaRegistry.getSchema(schema);
            var metaRegistry = SchemaRegistry.withDialect(Dialects.getDraft202012());
            schemaMetaSchema = metaRegistry.getSchema(SchemaLocation.of(Dialects.getDraft202012().getId()));
        } catch (Exception error) {
            throw new IllegalStateException("OpenAPI 3.1 结构 Schema 初始化失败", error);
        }
    }

    public ObjectNode validate(JsonNode input, JsonNode manifest) {
        if (input == null || !input.isObject()) throw error("OpenAPI 契约必须是 JSON 对象");
        if (Json.bytes(input).length > MAX_BYTES) throw error("OpenAPI 契约不能超过 512 KiB");
        String providerBase = input.path("servers").path(0).path("url").asText("/");
        if (!providerBase.matches("/(?:[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/?)?")) throw error("契约服务器必须是安全的提供方相对路径");
        inspect(input, input, providerBase, 0, new int[]{0});

        var structureErrors = documentSchema.validate(input);
        if (!structureErrors.isEmpty()) {
            var first = structureErrors.getFirst();
            throw error("OpenAPI 结构无效：" + first.getInstanceLocation() + " " + first.getMessage());
        }

        if (!"3.1.1".equals(text(input, "openapi"))
            || !manifest.path("version").asText().equals(input.path("info").path("version").asText())
            || !manifest.path("serviceId").asText().equals(text(input, "x-service-id"))
            || !manifest.path("appId").asText().equals(text(input, "x-app-id"))) {
            throw error("契约须使用 OpenAPI 3.1.1，服务 ID、应用及版本须与清单一致");
        }
        if (input.has("webhooks")) throw error("当前服务出口不支持 webhook 契约");
        validateOperations(input, manifest);
        validateComponentReferences(input);
        compileDataSchemas(input);
        return (ObjectNode) Json.read(CanonicalJson.write(input));
    }

    private static void bindDynamicSchemaReferences(JsonNode value) {
        if (!value.isContainerNode()) return;
        if (value.isObject()) {
            ObjectNode object = (ObjectNode) value;
            if ("#meta".equals(object.path("$dynamicRef").asText())) {
                object.remove("$dynamicRef");
                object.put("$ref", "#/$defs/schema");
            }
            object.forEach(ServiceContractValidator::bindDynamicSchemaReferences);
        } else value.forEach(ServiceContractValidator::bindDynamicSchemaReferences);
    }

    private void inspect(JsonNode value, JsonNode document, String providerBase, int depth, int[] count) {
        if (++count[0] > MAX_NODES || depth > MAX_DEPTH) throw error("OpenAPI 契约结构过大或嵌套过深");
        if (!value.isContainerNode()) return;
        if (value.isObject()) {
            var fields = value.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                String key = field.getKey();
                JsonNode child = field.getValue();
                if (FORBIDDEN.contains(key)) throw error("契约暂不支持 " + key);
                if (key.equals("$ref")) {
                    if (!child.isTextual() || !REFERENCE.matcher(child.textValue()).matches()) throw error("契约仅支持文档内 components 引用，禁止网络和文件引用");
                    if (resolve(document, child.textValue()) == null) throw error("契约引用不存在：" + child.textValue());
                }
                if ((key.equals("$schema") || key.equals("jsonSchemaDialect")) && !"https://json-schema.org/draft/2020-12/schema".equals(child.asText())) {
                    throw error("契约 Schema 使用 JSON Schema 2020-12");
                }
                if (key.equals("servers")) validateServers(child, providerBase);
                inspect(child, document, providerBase, depth + 1, count);
            }
        } else value.forEach(child -> inspect(child, document, providerBase, depth + 1, count));
    }

    private void validateServers(JsonNode servers, String providerBase) {
        if (!servers.isArray()) throw error("契约服务器只能声明提供方相对路径 " + providerBase + "，实际调用由平台绑定");
        for (JsonNode server : servers) {
            if (!server.isObject() || !providerBase.equals(text(server, "url")) || server.has("variables")) {
                throw error("契约服务器只能声明提供方相对路径 " + providerBase + "，实际调用由平台绑定");
            }
        }
    }

    private void validateOperations(JsonNode document, JsonNode manifest) {
        JsonNode paths = document.path("paths");
        if (!paths.isObject()) throw error("OpenAPI 结构无效：缺少 paths");
        Set<String> actual = new HashSet<>();
        var entries = paths.fields();
        while (entries.hasNext()) {
            var entry = entries.next();
            String path = entry.getKey();
            JsonNode pathItem = entry.getValue();
            if (!path.startsWith("/") || !pathItem.isObject()) throw error("OpenAPI 结构无效：接口路径无效");
            if (pathItem.has("$ref")) throw error("接口路径须在 paths 中直接声明");
            var members = pathItem.fields();
            while (members.hasNext()) {
                var member = members.next();
                if (!METHODS.contains(member.getKey())) continue;
                JsonNode operation = member.getValue();
                if (!operation.isObject() || operation.has("callbacks")) throw error(operation.has("callbacks") ? "当前服务出口不支持 callback 契约" : "OpenAPI 操作格式无效");
                String operationId = text(operation, "operationId");
                boolean expected = false;
                for (JsonNode item : manifest.path("operations")) {
                    if (operationId.equals(text(item, "operationId")) && path.equals(text(item, "path")) && member.getKey().equals(text(item, "method").toLowerCase(Locale.ROOT))) {
                        expected = true;
                        break;
                    }
                }
                if (!expected || !actual.add(operationId)) throw error("契约接口与清单不一致：" + member.getKey().toUpperCase(Locale.ROOT) + " " + path);
                validatePathParameters(document, pathItem, operation, path);
                validateOperationObjects(document, operation);
            }
        }
        if (actual.size() != manifest.path("operations").size()) throw error("契约必须覆盖清单中的全部接口");
    }

    private void validatePathParameters(JsonNode document, JsonNode pathItem, JsonNode operation, String path) {
        List<JsonNode> parameters = new ArrayList<>();
        addReferences(document, parameters, pathItem.path("parameters"), "parameters");
        addReferences(document, parameters, operation.path("parameters"), "parameters");
        Set<String> names = new HashSet<>();
        var matcher = PATH_PARAMETER.matcher(path);
        while (matcher.find()) names.add(matcher.group(1));
        for (String name : names) {
            boolean present = parameters.stream().anyMatch(parameter -> "path".equals(text(parameter, "in")) && name.equals(text(parameter, "name")) && parameter.path("required").asBoolean(false));
            if (!present) throw error("路径参数声明不完整：" + path);
        }
        if (parameters.stream().anyMatch(parameter -> "path".equals(text(parameter, "in")) && !names.contains(text(parameter, "name")))) throw error("路径参数声明不完整：" + path);
    }

    private void validateOperationObjects(JsonNode document, JsonNode operation) {
        if (operation.has("requestBody")) dereference(document, operation.get("requestBody"), "requestBodies");
        JsonNode responses = operation.path("responses");
        if (!responses.isObject() || responses.isEmpty()) throw error("OpenAPI 操作必须声明响应");
        responses.forEach(response -> {
            JsonNode value = dereference(document, response, "responses");
            value.path("headers").forEach(header -> dereference(document, header, "headers"));
        });
    }

    private void validateComponentReferences(JsonNode document) {
        for (String category : List.of("parameters", "responses", "requestBodies", "headers")) {
            document.path("components").path(category).forEach(value -> dereference(document, value, category));
        }
        validateSchemaReferences(document.path("components").path("schemas"));
        inspectSchemaMembers(document.path("paths"));
    }

    private void compileDataSchemas(JsonNode document) {
        List<JsonNode> schemas = new ArrayList<>();
        document.path("components").path("schemas").forEach(schemas::add);
        collectSchemaMembers(document.path("paths"), schemas);
        for (JsonNode schema : schemas) {
            var metaErrors = schemaMetaSchema.validate(schema);
            if (!metaErrors.isEmpty()) throw error("参数或响应 Schema 无效：" + metaErrors.getFirst().getMessage());
            var wrapper = Json.object().put("$schema", "https://json-schema.org/draft/2020-12/schema");
            wrapper.set("$defs", document.path("components").path("schemas").deepCopy());
            wrapper.set("allOf", Json.MAPPER.createArrayNode().add(schema.deepCopy()));
            rewriteSchemaReferences(wrapper);
            try {
                schemaRegistry.getSchema(wrapper).validate(Json.object());
            } catch (RuntimeException error) {
                throw error("参数或响应 Schema 无效：" + error.getMessage());
            }
        }
    }

    private void rewriteSchemaReferences(JsonNode value) {
        if (!value.isContainerNode()) return;
        if (value.isObject()) {
            ObjectNode object = (ObjectNode) value;
            String reference = object.path("$ref").asText("");
            if (reference.startsWith("#/components/schemas/")) object.put("$ref", "#/$defs/" + reference.substring("#/components/schemas/".length()));
            object.forEach(this::rewriteSchemaReferences);
        } else value.forEach(this::rewriteSchemaReferences);
    }

    private void collectSchemaMembers(JsonNode value, List<JsonNode> schemas) {
        if (!value.isContainerNode()) return;
        if (value.isObject()) {
            var fields = value.fields();
            while (fields.hasNext()) {
                var entry = fields.next();
                if (entry.getKey().equals("schema")) schemas.add(entry.getValue());
                else collectSchemaMembers(entry.getValue(), schemas);
            }
        } else value.forEach(child -> collectSchemaMembers(child, schemas));
    }

    private void inspectSchemaMembers(JsonNode value) {
        if (!value.isContainerNode()) return;
        if (value.isObject()) {
            var fields = value.fields();
            while (fields.hasNext()) {
                var entry = fields.next();
                if (entry.getKey().equals("schema")) validateSchemaReferences(entry.getValue());
                else inspectSchemaMembers(entry.getValue());
            }
        } else value.forEach(this::inspectSchemaMembers);
    }

    private void validateSchemaReferences(JsonNode value) {
        if (!value.isContainerNode()) return;
        if (value.isObject()) {
            var fields = value.fields();
            while (fields.hasNext()) {
                var entry = fields.next();
                if (entry.getKey().equals("$ref") && (!entry.getValue().isTextual() || !entry.getValue().textValue().startsWith("#/components/schemas/"))) throw error("数据 Schema 只能引用 components.schemas");
                validateSchemaReferences(entry.getValue());
            }
        } else value.forEach(this::validateSchemaReferences);
    }

    private void addReferences(JsonNode document, List<JsonNode> target, JsonNode values, String category) {
        if (values.isMissingNode()) return;
        if (!values.isArray()) throw error("引用的 " + category + " 对象格式无效");
        values.forEach(value -> target.add(dereference(document, value, category)));
    }

    private JsonNode dereference(JsonNode document, JsonNode value, String category) {
        Set<String> seen = new HashSet<>();
        while (value != null && value.has("$ref")) {
            String reference = text(value, "$ref");
            if (!reference.startsWith("#/components/" + category + "/") || !seen.add(reference)) throw error("OpenAPI 对象引用类型不符或形成循环");
            value = resolve(document, reference);
        }
        if (value == null || !value.isObject()) throw error("引用的 " + category + " 对象格式无效");
        return value;
    }

    private JsonNode resolve(JsonNode document, String reference) {
        JsonNode value = document;
        for (String part : reference.substring(2).split("/")) {
            value = value.path(part);
            if (value.isMissingNode()) return null;
        }
        return value;
    }

    private static String text(JsonNode value, String key) {
        return value.path(key).isTextual() ? value.path(key).textValue() : "";
    }

    private static ApiException error(String message) {
        return new ApiException(400, message);
    }
}
