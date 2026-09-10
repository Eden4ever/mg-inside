package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import org.springframework.stereotype.Component;

/** 服务版本、启用状态与调用记录的本地事务实现。数据库实现接入前保持 Node 存储格式兼容。 */
@Component
public class ServiceRegistry {
    public record Target(ObjectNode manifest, ObjectNode lifecycle, ObjectNode operation, String path) {}
    private final AppCatalog appCatalog;
    private final ServiceContractValidator contracts = new ServiceContractValidator();
    private final ServiceRegistryStorage storage;
    private final ServiceDeploymentCatalog deployments;
    private final boolean bootstrapDefaults;
    private ObjectNode state;

    @org.springframework.beans.factory.annotation.Autowired
    public ServiceRegistry(Settings settings, AppCatalog catalog) {
        this(settings, catalog, createStorage(settings));
    }

    ServiceRegistry(Settings settings, AppCatalog catalog, ServiceRegistryStorage storage) {
        this(settings, catalog, storage, true);
    }

    ServiceRegistry(Settings settings, AppCatalog catalog, ServiceRegistryStorage storage, boolean loadDeployments) {
        appCatalog = catalog;
        this.storage = storage;
        bootstrapDefaults = "json".equals(storage.status().path("backend").asText());
        deployments = new ServiceDeploymentCatalog(loadDeployments ? settings.get("SERVICE_DEPLOYMENTS_FILE", "") : "", catalog::registeredIds);
        if (deployments.enabled()) {
            if (settings.get("SERVICE_DATABASE_URL", "").isEmpty()) throw new IllegalStateException("环境部署绑定需要独立数据库");
            deployments.refresh();
            boolean present = false;
            for (JsonNode item : deployments.environments()) if (storage.status().path("environment").asText().equals(item.path("id").asText())) present = true;
            if (!present) throw new IllegalStateException("运行环境未在受控部署配置中登记");
        }
    }

    @PostConstruct
    public synchronized void initialize() throws IOException {
        state = requireState(storage.read(true));
        if (!bootstrapDefaults) return;
        JsonNode defaults = resource("/services/catalog.json");
        JsonNode defaultContracts = resource("/services/openapi-catalog.json");
        Set<String> appIds = appCatalog.registeredIds();
        change((ignored, context) -> {
            for (JsonNode input : defaults) {
                if (!appIds.contains(input.path("appId").asText())) continue;
                ObjectNode manifest = ServiceRules.manifest(input, appIds);
                if (publication(text(manifest, "serviceId"), text(manifest, "version")) != null) continue;
                JsonNode contractInput = defaultContracts.path(text(manifest, "serviceId"));
                ObjectNode contract = contractInput.isMissingNode() ? null : contracts.validate(contractInput, manifest);
                state.withArray("publications").add(publication(manifest, contract, "release"));
                state.with("active").put(text(manifest, "serviceId"), text(manifest, "version"));
            }
            return null;
        });
    }

    public synchronized void refresh(boolean allowCache) { state = requireState(storage.read(allowCache)); }
    public synchronized ObjectNode validateSnapshot(JsonNode value) { return requireState(value).deepCopy(); }
    public ObjectNode storageStatus() { return storage.status(); }
    public String environment() { return storage.status().path("environment").asText("local"); }
    public boolean bindingRequired() { return deployments.enabled(); }
    public ArrayNode environments() { return deployments.enabled() ? deployments.environments() : Json.MAPPER.createArrayNode().add(Json.object().put("id", environment()).put("name", environment())); }
    public ArrayNode deploymentOptions(Set<String> allowed) { return deployments.enabled() ? deployments.options(environment(), allowed) : Json.MAPPER.createArrayNode(); }
    public void close() { storage.close(); }
    public ObjectNode apiInventory(){return ServiceApiInventory.visible(storage.apiInventory(),list(appCatalog.registeredIds()));}
    public ObjectNode updateApiInventory(JsonNode input,String actor){return storage.apiInventoryTransaction((saved,context)->ServiceApiInventory.update(saved,input,actor));}
    public ObjectNode workspace(Set<String> allowed) { return ServiceWorkspace.visible(storage.workspace(),list(allowed)); }
    public ObjectNode updateWorkspace(JsonNode input,Set<String> allowed,String actor) {
        return storage.workspaceTransaction((saved,context)->ServiceWorkspace.update(saved,input,list(allowed),actor));
    }
    public ObjectNode insights(ServiceMetrics.Query query,Set<String> allowed) { return storage.insights(query,ServiceWorkspace.serviceIds(list(allowed))); }
    public void recordObservation(ObjectNode event) { storage.appendActivity(event); }
    public void recordGatewayAudit(ObjectNode event) { storage.appendAudit(event); }

    public synchronized ArrayNode list(Set<String> allowed) {
        var result = Json.MAPPER.createArrayNode();
        for (JsonNode item : state.withArray("publications")) {
            if (!allowed.contains(item.path("manifest").path("appId").asText())) continue;
            var output = (ObjectNode) item.deepCopy();
            String serviceId = item.path("manifest").path("serviceId").asText();
            String version = item.path("manifest").path("version").asText();
            output.set("lifecycle", lifecycle((ObjectNode) item));
            JsonNode active = state.with("active").get(serviceId);
            output.put("active", active != null && active.isTextual() && version.equals(active.textValue()));
            output.put("activeRevision", revision(serviceId));
            output.set("activeVersion", active == null ? Json.MAPPER.nullNode() : active.deepCopy());
            JsonNode binding = state.with("bindings").get(serviceId);
            if (binding != null) output.set("binding", binding.deepCopy());
            result.add(output);
        }
        return result;
    }

    public synchronized ArrayNode activity(Set<String> allowed) {
        Set<String> serviceIds = new HashSet<>();
        state.withArray("publications").forEach(item -> {
            if (allowed.contains(item.path("manifest").path("appId").asText())) serviceIds.add(item.path("manifest").path("serviceId").asText());
        });
        var result = Json.MAPPER.createArrayNode();
        for (int index = state.withArray("activity").size() - 1; index >= 0; index--) {
            JsonNode item = state.withArray("activity").get(index);
            if (serviceIds.contains(item.path("serviceId").asText())) result.add(item.deepCopy());
        }
        return result;
    }

    public synchronized ArrayNode audit() {
        var result = Json.MAPPER.createArrayNode();
        for (int index = state.withArray("audit").size() - 1; index >= 0; index--) result.add(state.withArray("audit").get(index).deepCopy());
        return result;
    }

    public synchronized ObjectNode publish(JsonNode manifestInput, JsonNode contractInput, String actor) {
        ObjectNode manifest = ServiceRules.manifest(manifestInput, appCatalog.registeredIds());
        ObjectNode contract = contractInput == null || contractInput.isNull() ? null : contracts.validate(contractInput, manifest);
        ObjectNode created = publication(manifest, contract, actor);
        return change((ignored, context) -> {
            ObjectNode previous = publication(text(manifest, "serviceId"), text(manifest, "version"));
            if (previous != null) {
                if (!text(previous, "digest").equals(text(created, "digest")) || !Objects.equals(nullableText(previous, "contractDigest"), nullableText(created, "contractDigest"))) {
                    throw new ApiException(409, "此版本已存在且内容不同，请增加版本号");
                }
                var duplicate = (ObjectNode) previous.deepCopy();
                duplicate.put("duplicate", true);
                return duplicate;
            }
            rejectPublishedRouteCollision(manifest);
            state.withArray("publications").add(created);
            state.with("lifecycles").set(lifecycleKey(manifest), lifecycle("draft", 0, "等待首次环境发布", actor, null));
            append(state.withArray("audit"), audit("publish", text(manifest, "serviceId"), text(manifest, "version"), actor), 500);
            return created.deepCopy();
        });
    }

    public synchronized ObjectNode activate(String serviceId, String version, String actor, long expectedRevision, boolean allowBreaking, boolean allowContractChange) {
        return activate(serviceId, version, actor, expectedRevision, allowBreaking, allowContractChange, null, null);
    }

    public synchronized ObjectNode activate(String serviceId, String version, String actor, long expectedRevision, boolean allowBreaking, boolean allowContractChange, String endpointRef, String expectedDeploymentDigest) {
        return change((ignored, context) -> {
            ObjectNode candidate = version == null ? null : publication(serviceId, version);
            if (version != null && candidate == null) throw new ApiException(404, "服务版本不存在");
            if (expectedRevision != revision(serviceId)) throw new ApiException(409, "服务状态已更新，请刷新目录后重试");
            ObjectNode current = activePublication(serviceId);
            JsonNode previousBinding = state.with("bindings").get(serviceId);
            ObjectNode binding = null;
            if (candidate != null) {
                if(ServiceRules.catalogOnly(candidate.path("manifest")))throw new ApiException(409,"协议或平台接口已登记，仅目录管理，不使用业务代理启用");
                ObjectNode lifecycle = lifecycle(candidate);
                if ("retired".equals(text(lifecycle, "status"))) throw new ApiException(409, "此版本已退役，不能再次发布");
                if (deployments.enabled()) {
                    deployments.refresh();
                    binding = deployments.binding(candidate, context.environment(), Objects.toString(endpointRef, ""), Objects.toString(expectedDeploymentDigest, ""));
                }
                if (breaking(current, candidate) && !allowBreaking) throw new ApiException(409, "此版本包含接口移除或调用方式变化，请审阅差异并明确确认");
                if (contractChanged(current, candidate) && !allowContractChange) throw new ApiException(409, "参数或响应契约发生变化，请审阅契约差异并明确确认");
                rejectActiveRouteCollision(serviceId, candidate.path("manifest"));
                JsonNode active = state.with("active").get(serviceId);
                if (active != null && active.isTextual() && version.equals(active.textValue()) && CanonicalJson.write(previousBinding).equals(CanonicalJson.write(binding))) return Json.object().put("ok", true).put("revision", revision(serviceId)).put("duplicate", true);
                if ("deprecated".equals(text(lifecycle, "status"))) throw new ApiException(409, "此版本已弃用，不能新增或更换环境绑定；请先恢复维护状态");
                if ("draft".equals(text(lifecycle, "status"))) {
                    ObjectNode next = lifecycle("published", lifecycle.path("revision").longValue() + 1, "首次环境发布", actor, null);
                    state.with("lifecycles").set(lifecycleKey(candidate.path("manifest")), next);
                    append(state.withArray("audit"), lifecycleAudit(candidate, lifecycle, next, actor, context.environment()), 500);
                }
            } else if (state.with("active").path(serviceId).isNull()) {
                return Json.object().put("ok", true).put("revision", revision(serviceId)).put("duplicate", true);
            }
            state.with("revisions").put(serviceId, revision(serviceId) + 1);
            if (binding != null) state.with("bindings").set(serviceId, binding); else state.with("bindings").remove(serviceId);
            if (version == null) state.with("active").putNull(serviceId); else state.with("active").put(serviceId, version);
            var event = audit(version == null ? "disable" : "activate", serviceId, Objects.toString(version, ""), actor);
            if (binding != null) event.set("binding", binding.deepCopy());
            if (previousBinding != null && previousBinding.isObject()) event.set("previousBinding", previousBinding.deepCopy());
            append(state.withArray("audit"), event, 500);
            return Json.object().put("ok", true);
        });
    }

    public synchronized ObjectNode deployment(String serviceId) {
        if (!deployments.enabled()) return null;
        deployments.refresh();
        ObjectNode publication = activePublication(serviceId);
        if (publication == null) throw new ApiException(404, "服务未启用");
        return deployments.resolve(publication, state.with("bindings").path(serviceId), environment());
    }

    public synchronized ObjectNode setLifecycle(String serviceId, String version, String status, String reason, String retireAfter, long expectedRevision, String actor) {
        return change((ignored, context) -> {
            ObjectNode item = publication(serviceId, version);
            if (item == null) throw new ApiException(404, "服务版本不存在");
            ObjectNode before = lifecycle(item);
            if (expectedRevision != before.path("revision").longValue()) throw new ApiException(409, "生命周期已更新，请刷新后重试");
            String cleanReason = Objects.toString(reason, "").strip();
            if (!Set.of("published", "deprecated", "retired").contains(status) || cleanReason.isEmpty() || cleanReason.length() > 2000 || retireAfter != null && !ServiceRules.validDate(retireAfter)) throw new ApiException(400, "生命周期状态、说明或退役日期无效");
            if (retireAfter != null && !status.equals("deprecated")) throw new ApiException(400, "仅弃用状态可设置计划退役日期");
            if (status.equals(text(before, "status")) && cleanReason.equals(text(before, "reason")) && Objects.equals(retireAfter, nullableText(before, "retireAfter"))) return Json.object().put("ok", true).put("duplicate", true).set("lifecycle", before);
            if ("retired".equals(text(before, "status"))) throw new ApiException(409, "已退役版本不能修改或恢复，请登记新版本");
            if (status.equals("published") && !"deprecated".equals(text(before, "status"))) throw new ApiException(409, "草稿必须通过环境发布转为已发布");
            if (status.equals("deprecated") && !Set.of("published", "deprecated").contains(text(before, "status"))) throw new ApiException(409, "只有已发布版本可以弃用");
            if (status.equals("retired")) {
                if (!Set.of("draft", "deprecated").contains(text(before, "status"))) throw new ApiException(409, "已发布版本必须先弃用再退役");
                if (nullableText(before, "retireAfter") != null && LocalDate.now(ZoneOffset.UTC).isBefore(LocalDate.parse(text(before, "retireAfter")))) throw new ApiException(409, "尚未到计划退役日期，请先调整弃用计划并通知调用方");
                var users = new LinkedHashSet<String>();
                for (JsonNode binding : context.activeBindings()) if (serviceId.equals(binding.path("serviceId").asText()) && version.equals(binding.path("version").asText())) users.add(binding.path("environment").asText());
                if (context.activeBindings().isEmpty() && version.equals(state.with("active").path(serviceId).asText(null))) users.add(context.environment());
                if (!users.isEmpty()) throw new ApiException(409, "仍有环境使用此版本：" + String.join("、", users) + "；请先切换或停用");
            }
            ObjectNode next = lifecycle(status, before.path("revision").longValue() + 1, cleanReason, actor, retireAfter);
            state.with("lifecycles").set(lifecycleKey(item.path("manifest")), next);
            append(state.withArray("audit"), lifecycleAudit(item, before, next, actor, context.environment()), 500);
            return Json.object().put("ok", true).set("lifecycle", next.deepCopy());
        });
    }

    public synchronized Target resolveApplication(String appId, String method, String path, boolean allowUnregistered) {
        // 历史版本的路径也属于服务中心，停用或移除后不能退回应用直连。
        boolean claimed = false;
        for (JsonNode publication : state.withArray("publications")) {
            if(ServiceRules.catalogOnly(publication.path("manifest")))continue;
            if (!appId.equals(publication.path("manifest").path("appId").asText())) continue;
            for (JsonNode operation : publication.path("manifest").path("operations"))
                if (ServiceRules.matches(operation, operation.path("method").asText(), path)) claimed = true;
        }
        if (claimed || !allowUnregistered) return resolve(appId, method, path);
        return null;
    }

    public synchronized Target resolve(String appId, String method, String path) {
        List<Target> matches = new ArrayList<>();
        for (JsonNode item : activePublications()) {
            if (!appId.equals(item.path("manifest").path("appId").asText())) continue;
            for (JsonNode operation : item.path("manifest").path("operations")) if (ServiceRules.matches(operation, method, path)) {
                matches.add(new Target((ObjectNode) item.path("manifest").deepCopy(), lifecycle((ObjectNode) item), (ObjectNode) operation.deepCopy(), path));
            }
        }
        if (matches.size() != 1) throw new ApiException(matches.isEmpty() ? 404 : 409, matches.isEmpty() ? "接口未登记或服务未启用" : "接口匹配冲突");
        return matches.getFirst();
    }

    public synchronized Target invoke(String serviceId, String operationId, String method, Map<String, String> parameters) {
        ObjectNode item = activePublication(serviceId);
        if (item == null) throw new ApiException(404, "服务或操作未启用");
        for (JsonNode operation : item.path("manifest").path("operations")) {
            if (!operationId.equals(text(operation, "operationId"))) continue;
            if (!method.equals(text(operation, "method"))) throw new ApiException(405, "调用方法不匹配");
            return new Target((ObjectNode) item.path("manifest").deepCopy(), lifecycle(item), (ObjectNode) operation.deepCopy(), ServiceRules.path(operation, parameters));
        }
        throw new ApiException(404, "服务或操作未启用");
    }

    public synchronized void record(String serviceId, String operationId, String actor, int status, long durationMs) {
        change((ignored, context) -> {
            var activity = Json.object().put("id", UUID.randomUUID().toString()).put("at", Instant.now().toString()).put("serviceId", serviceId).put("operationId", operationId).put("actor", actor).put("status", status).put("durationMs", durationMs);
            append(state.withArray("activity"), activity, 300);
            return null;
        });
    }

    public synchronized int revision(String serviceId) { return state.with("revisions").path(serviceId).asInt(0); }

    private ObjectNode requireState(JsonNode value) {
        if (!value.isObject() || value.path("schemaVersion").asInt() != 1 || !value.path("publications").isArray() || !value.path("active").isObject() || !value.path("audit").isArray() || !value.path("activity").isArray()) throw new IllegalStateException("服务目录存储格式无效");
        ObjectNode loaded = (ObjectNode) value;
        loaded.with("revisions"); loaded.with("lifecycles"); loaded.with("bindings");
        Set<String> keys = new HashSet<>();
        Set<String> appIds = appCatalog.registeredIds();
        for (JsonNode item : loaded.withArray("publications")) {
            ObjectNode manifest = ServiceRules.manifest(item.path("manifest"), appIds);
            String key = lifecycleKey(manifest);
            if (!keys.add(key)) throw new IllegalStateException("服务版本重复");
            if (!CanonicalJson.manifestDigest(manifest).equals(text(item, "digest"))) throw new IllegalStateException("服务清单校验失败");
            if (item.has("contract")) {
                ObjectNode contract = contracts.validate(item.path("contract"), manifest);
                if (!CanonicalJson.digest(contract).equals(text(item, "contractDigest"))) throw new IllegalStateException("OpenAPI 契约摘要校验失败");
            } else if (item.has("contractDigest")) throw new IllegalStateException("OpenAPI 契约缺失");
        }
        var active = loaded.with("active").fields();
        while (active.hasNext()) {
            var entry = active.next();
            if (!(entry.getValue().isNull() || entry.getValue().isTextual())) throw new IllegalStateException("服务启用版本无效");
            boolean found = false;
            for (JsonNode item : loaded.withArray("publications")) if (entry.getKey().equals(text(item.path("manifest"), "serviceId"))
                && (entry.getValue().isNull() || entry.getValue().asText().equals(text(item.path("manifest"), "version")))) found = true;
            if (!found) throw new IllegalStateException("服务启用版本不存在");
            for(JsonNode item:loaded.withArray("publications"))if(entry.getValue().isTextual()&&entry.getKey().equals(text(item.path("manifest"),"serviceId"))&&entry.getValue().asText().equals(text(item.path("manifest"),"version"))&&ServiceRules.catalogOnly(item.path("manifest")))throw new IllegalStateException("目录管理接口不能绑定业务代理");
        }
        loaded.with("revisions").fields().forEachRemaining(entry -> {
            JsonNode revision = entry.getValue();
            if (!revision.isIntegralNumber() || !revision.canConvertToLong() || revision.longValue() < 0 || revision.longValue() > 9_007_199_254_740_991L) throw new IllegalStateException("服务修订号无效");
        });
        loaded.with("lifecycles").fields().forEachRemaining(entry -> {
            if (!keys.contains(entry.getKey())) throw new IllegalStateException("生命周期对应的版本不存在");
            validateStoredLifecycle(entry.getValue());
        });
        loaded.with("active").fields().forEachRemaining(entry -> {
            if (!entry.getValue().isTextual()) return;
            String status = loaded.with("lifecycles").path(entry.getKey() + "@" + entry.getValue().asText()).path("status").asText();
            if (Set.of("draft", "retired").contains(status)) throw new IllegalStateException("启用版本的生命周期无效");
        });
        loaded.with("bindings").fields().forEachRemaining(entry -> validateStoredBinding(entry.getValue()));
        return loaded;
    }

    private static void validateStoredLifecycle(JsonNode value) {
        String status = text(value, "status"), at = text(value, "at");
        JsonNode revision = value.path("revision");
        boolean instant;
        try { Instant.parse(at); instant = true; } catch (RuntimeException error) { instant = false; }
        if (!value.isObject() || !Set.of("draft", "published", "deprecated", "retired").contains(status)
            || !revision.isIntegralNumber() || !revision.canConvertToLong() || revision.longValue() < 0 || revision.longValue() > 9_007_199_254_740_991L
            || !value.path("reason").isTextual() || value.path("reason").asText().length() > 2000 || !value.path("actor").isTextual() || !instant
            || value.has("retireAfter") && (!value.path("retireAfter").isTextual() || !ServiceRules.validDate(value.path("retireAfter").asText()))) throw new IllegalStateException("服务版本生命周期格式无效");
    }

    private static void validateStoredBinding(JsonNode value) {
        Set<String> fields = Set.of("environment", "endpointRef", "deploymentId", "deploymentDigest", "manifestDigest", "contractDigest");
        if (!value.isObject()) throw new IllegalStateException("服务部署绑定无效");
        var names = value.fieldNames(); while (names.hasNext()) if (!fields.contains(names.next())) throw new IllegalStateException("服务部署绑定无效");
        if (!value.path("environment").isTextual() || !value.path("endpointRef").isTextual() || !value.path("deploymentId").isTextual()
            || !storedDigest(value.path("deploymentDigest")) || !storedDigest(value.path("manifestDigest")) || !storedDigest(value.path("contractDigest"))) throw new IllegalStateException("服务部署绑定无效");
    }

    private static boolean storedDigest(JsonNode value) { return value.isTextual() && value.asText().matches("[a-f0-9]{64}"); }

    private ObjectNode publication(ObjectNode manifest, ObjectNode contract, String actor) {
        var value = Json.object(); value.set("manifest", manifest); value.put("digest", CanonicalJson.manifestDigest(manifest)).put("at", Instant.now().toString()).put("actor", actor);
        if (contract != null) { value.set("contract", contract); value.put("contractDigest", CanonicalJson.digest(contract)); }
        return value;
    }

    private ObjectNode publication(String serviceId, String version) {
        for (JsonNode item : state.withArray("publications")) if (serviceId.equals(item.path("manifest").path("serviceId").asText()) && version.equals(item.path("manifest").path("version").asText())) return (ObjectNode) item;
        return null;
    }

    private ObjectNode activePublication(String serviceId) {
        JsonNode version = state.with("active").get(serviceId);
        return version != null && version.isTextual() ? publication(serviceId, version.textValue()) : null;
    }

    private List<ObjectNode> activePublications() {
        var result = new ArrayList<ObjectNode>();
        state.with("active").fields().forEachRemaining(entry -> { if (entry.getValue().isTextual()) { var item = publication(entry.getKey(), entry.getValue().textValue()); if (item != null) result.add(item); } });
        return result;
    }

    private ObjectNode lifecycle(ObjectNode publication) {
        JsonNode value = state.with("lifecycles").get(lifecycleKey(publication.path("manifest")));
        return value != null && value.isObject() ? (ObjectNode) value.deepCopy() : lifecycle("published", 0, "历史登记版本", text(publication, "actor"), null).put("at", text(publication, "at"));
    }

    private static ObjectNode lifecycle(String status, long revision, String reason, String actor, String retireAfter) {
        var value = Json.object().put("status", status).put("revision", revision).put("reason", reason).put("at", Instant.now().toString()).put("actor", actor);
        if (retireAfter != null) value.put("retireAfter", retireAfter);
        return value;
    }

    private void rejectPublishedRouteCollision(JsonNode manifest) {
        if(ServiceRules.catalogOnly(manifest))return;
        for (ObjectNode active : activePublications()) {
            if (!text(active.path("manifest"), "appId").equals(text(manifest, "appId")) || text(active.path("manifest"), "serviceId").equals(text(manifest, "serviceId"))) continue;
            for (JsonNode left : active.path("manifest").path("operations")) for (JsonNode right : manifest.path("operations")) if (sameNormalizedRoute(left, right)) throw new ApiException(409, "接口已由同一应用的其他服务登记");
        }
    }

    private void rejectActiveRouteCollision(String serviceId, JsonNode manifest) {
        for (ObjectNode active : activePublications()) {
            if (serviceId.equals(text(active.path("manifest"), "serviceId")) || !text(active.path("manifest"), "appId").equals(text(manifest, "appId"))) continue;
            for (JsonNode left : active.path("manifest").path("operations")) for (JsonNode right : manifest.path("operations")) if (ServiceRules.overlap(left, right)) throw new ApiException(409, "此版本与同一应用的已启用服务存在路由冲突");
        }
    }

    private static boolean breaking(ObjectNode current, ObjectNode candidate) {
        if (current == null) return false;
        for (JsonNode before : current.path("manifest").path("operations")) {
            JsonNode after = null;
            for (JsonNode operation : candidate.path("manifest").path("operations")) if (text(before, "operationId").equals(text(operation, "operationId"))) { after = operation; break; }
            if (after == null || !text(before, "method").equals(text(after, "method")) || !text(before, "path").equals(text(after, "path"))) return true;
        }
        return false;
    }

    private static boolean contractChanged(ObjectNode current, ObjectNode candidate) {
        if (current == null) return false;
        return !Objects.equals(nullableText(current, "contractDigest"), nullableText(candidate, "contractDigest"));
    }

    private static boolean sameNormalizedRoute(JsonNode left, JsonNode right) {
        return text(left, "method").equals(text(right, "method")) && text(left, "path").replaceAll("\\{[^}]+}", "{}").equals(text(right, "path").replaceAll("\\{[^}]+}", "{}"));
    }

    private static String lifecycleKey(JsonNode manifest) { return text(manifest, "serviceId") + "@" + text(manifest, "version"); }
    private static String text(JsonNode value, String key) { return value.path(key).isTextual() ? value.path(key).textValue() : ""; }
    private static String nullableText(JsonNode value, String key) { return value.has(key) && value.path(key).isTextual() ? value.path(key).textValue() : null; }

    private static ObjectNode audit(String action, String serviceId, String version, String actor) {
        return Json.object().put("id", UUID.randomUUID().toString()).put("at", Instant.now().toString()).put("actor", actor).put("action", action).put("serviceId", serviceId).put("version", version);
    }

    private static ObjectNode lifecycleAudit(ObjectNode item, ObjectNode before, ObjectNode after, String actor, String environment) {
        var value = audit("lifecycle", text(item.path("manifest"), "serviceId"), text(item.path("manifest"), "version"), actor);
        value.set("lifecycle", after.deepCopy()); value.set("previousLifecycle", before.deepCopy()); value.put("environment", environment); return value;
    }

    private static void append(ArrayNode array, JsonNode item, int limit) {
        array.add(item);
        while (array.size() > limit) array.remove(0);
    }

    private JsonNode resource(String path) throws IOException {
        try (InputStream input = ServiceRegistry.class.getResourceAsStream(path)) {
            if (input == null) throw new IOException("缺少内置服务目录：" + path);
            return Json.read(input.readAllBytes());
        }
    }

    private <T> T change(ServiceRegistryStorage.Change<T> operation) {
        ObjectNode previous = state;
        try {
            return storage.transaction((saved, context) -> {
                state = requireState(saved);
                return operation.apply(state, context);
            });
        } catch (RuntimeException error) {
            state = previous;
            throw error;
        }
    }

    private static ServiceRegistryStorage createStorage(Settings settings) {
        Path directory = settings.runtime().resolve("services");
        String database = settings.get("SERVICE_DATABASE_URL", "");
        String configuredEnvironment = settings.get("SERVICE_ENVIRONMENT", "");
        if (!database.isEmpty() && configuredEnvironment.isEmpty()) throw new IllegalStateException("数据库模式必须配置 SERVICE_ENVIRONMENT");
        String environment = configuredEnvironment.isEmpty() ? "local" : PostgresServiceRegistryStorage.validateEnvironment(configuredEnvironment);
        if (database.isEmpty()) return new JsonServiceRegistryStorage(directory, environment);
        return new SnapshotServiceRegistryStorage(new PostgresServiceRegistryStorage(database, environment), directory, environment);
    }
}
