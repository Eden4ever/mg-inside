package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/** 服务目录管理 API。所有写操作要求 service-manager 权限、管理员角色及 CSRF。 */
@RestController
public class ServiceRegistryController {
    private final ServiceRegistry registry;
    private final ServiceRegistryContexts contexts;
    private final AppCatalog catalog;
    private final AuthService auth;
    private final ServiceTelemetry telemetry;

    public ServiceRegistryController(ServiceRegistry registry, ServiceRegistryContexts contexts, AppCatalog catalog, AuthService auth,ServiceTelemetry telemetry) {
        this.registry = registry;
        this.contexts = contexts;
        this.catalog = catalog;
        this.auth = auth;
        this.telemetry=telemetry;
    }

    @RequestMapping("/api/service-registry/**")
    public Mono<ResponseEntity<byte[]>> handle(ServerWebExchange exchange, @RequestBody(required = false) byte[] body) {
        return Mono.fromCallable(() -> dispatch(exchange, body)).subscribeOn(Schedulers.boundedElastic());
    }

    private ResponseEntity<byte[]> dispatch(ServerWebExchange exchange, byte[] bytes) {
        String path = exchange.getRequest().getPath().value();
        String method = exchange.getRequest().getMethod().name();
        var headers = exchange.getRequest().getHeaders();
        var session = auth.session(headers);
        auth.authorize(catalog.find("service-manager").orElseThrow(() -> new ApiException(403, "服务管理应用未启用")), session.token());
        boolean canManage = "system_admin".equals(Json.string(session.profile(), "role"));
        Set<String> allowed = new HashSet<>();
        auth.granted(session.token()).forEach(app -> allowed.add(app.id()));

        var query = Urls.query(exchange.getRequest().getURI().getRawQuery());
        String runningEnvironment = registry.environment();
        String environment = query.getOrDefault("environment", runningEnvironment);
        if (!environment.equals(runningEnvironment) && !canManage) throw new ApiException(403, "只有管理员可管理其他环境");
        ServiceRegistry selected = contexts.select(environment);

        if(method.equals("GET")&&path.equals("/api/service-registry/api-inventory")) {
            if(!canManage)throw new ApiException(403,"只有管理员可以查看全量 API 台账");
            selected.refresh(false);return PlatformController.json(200,selected.apiInventory());
        }

        if(method.equals("GET") && path.equals("/api/service-registry/workspace")) {selected.refresh(false);return PlatformController.json(200,selected.workspace(allowed));}
        if(method.equals("GET") && path.equals("/api/service-registry/insights")) {selected.refresh(false);var result=selected.insights(ServiceMetrics.Query.parse(query),allowed);if(environment.equals(runningEnvironment))result.set("collector",telemetry.status());return PlatformController.json(200,result);}

        if (method.equals("GET") && path.equals("/api/service-registry")) {
            selected.refresh(false);
            var result = Json.object();
            result.set("items", selected.list(allowed));
            result.set("activity", selected.activity(allowed));
            result.set("audit", canManage ? selected.audit() : Json.MAPPER.createArrayNode());
            result.put("canManage", canManage);
            result.set("storage", selected.storageStatus());
            result.put("runningEnvironment", runningEnvironment).put("bindingRequired", selected.bindingRequired());
            result.set("environments", registry.environments());
            result.set("deployments", selected.deploymentOptions(allowed));
            result.set("providers",Json.MAPPER.valueToTree(catalog.all().stream().filter(app->allowed.contains(app.id())).map(app->Map.of("id",app.id(),"name",app.publicData().path("name").asText())).toList()));
            return PlatformController.json(200, result);
        }

        if (!canManage) throw new ApiException(403, "只有已授权的平台管理员可以维护服务");
        auth.csrf(headers, Json.string(session.profile(), "csrfToken"));
        JsonNode input = parse(bytes, path.equals("/api/service-registry/api-inventory") ? 4*1024*1024 : path.equals("/api/service-registry/publications") ? 600 * 1024 : 65_536);

        if(method.equals("POST")&&path.equals("/api/service-registry/api-inventory"))return PlatformController.json(200,selected.updateApiInventory(input,Json.string(session.profile(),"sub")));

        if(method.equals("POST") && path.equals("/api/service-registry/workspace")) {selected.refresh(false);return PlatformController.json(200,selected.updateWorkspace(input,allowed,Json.string(session.profile(),"sub")));}

        if (method.equals("POST") && path.equals("/api/service-registry/publications")) {
            JsonNode manifest = input.has("manifest") ? input.path("manifest") : input;
            JsonNode contract = input.has("manifest") ? input.get("contract") : null;
            if (input.has("manifest")) only(input, Set.of("manifest", "contract"), "登记请求包含无效字段");
            if (!manifest.isObject()) throw new ApiException(400, "缺少服务清单");
            String appId = Json.string(manifest, "appId");
            if (!allowed.contains(appId)) throw new ApiException(403, "没有提供应用的访问权限");
            var app = catalog.find(appId).orElseThrow(() -> new ApiException(403, "接口超出应用允许范围"));
            for (JsonNode operation : manifest.path("operations")) {
                String sample = Json.string(operation, "path").replaceAll("\\{[^}]+}", "test");
                if (!ServiceRules.catalogOnly(manifest)&&!app.allowsApi(sample)) throw new ApiException(403, "接口超出应用允许范围");
            }
            return PlatformController.json(201, selected.publish(manifest, contract, Json.string(session.profile(), "sub")));
        }

        if (method.equals("POST") && path.equals("/api/service-registry/activation")) {
            only(input, Set.of("serviceId", "version", "expectedRevision", "allowBreaking", "allowContractChange", "endpointRef", "expectedDeploymentDigest"), "发布请求包含不支持的字段，地址只能来自受控部署");
            String serviceId = Json.string(input, "serviceId");
            if (!hasService(selected.list(allowed), serviceId)) throw new ApiException(404, "服务不存在或无权维护");
            if (!input.has("version") || !(input.path("version").isNull() || input.path("version").isTextual())) throw new ApiException(400, "版本无效");
            if (!Json.safeInteger(input.path("expectedRevision"))) throw new ApiException(409, "服务状态已更新，请刷新目录后重试");
            String version = input.path("version").isNull() ? null : input.path("version").textValue();
            String endpointRef = input.path("endpointRef").isTextual() ? input.path("endpointRef").textValue() : null;
            String deploymentDigest = input.path("expectedDeploymentDigest").isTextual() ? input.path("expectedDeploymentDigest").textValue() : null;
            return PlatformController.json(200, selected.activate(serviceId, version, Json.string(session.profile(), "sub"), input.path("expectedRevision").longValue(), input.path("allowBreaking").asBoolean(false), input.path("allowContractChange").asBoolean(false), endpointRef, deploymentDigest));
        }

        if (method.equals("POST") && path.equals("/api/service-registry/lifecycle")) {
            only(input, Set.of("serviceId", "version", "status", "reason", "retireAfter", "expectedRevision"), "生命周期请求包含无效字段");
            String serviceId = Json.string(input, "serviceId"), version = Json.string(input, "version");
            if (!hasVersion(selected.list(allowed), serviceId, version)) throw new ApiException(404, "服务版本不存在或无权维护");
            if (!Json.safeInteger(input.path("expectedRevision"))) throw new ApiException(409, "生命周期已更新，请刷新后重试");
            String retireAfter = input.path("retireAfter").isTextual() ? input.path("retireAfter").textValue() : null;
            return PlatformController.json(200, selected.setLifecycle(serviceId, version, Json.string(input, "status"), Json.string(input, "reason"), retireAfter, input.path("expectedRevision").longValue(), Json.string(session.profile(), "sub")));
        }
        throw new ApiException(404, "接口不存在");
    }

    private static JsonNode parse(byte[] bytes, int limit) {
        if (bytes == null || bytes.length == 0) return Json.object();
        if (bytes.length > limit) throw new ApiException(413, "请求过大");
        JsonNode input = Json.read(bytes);
        if (!input.isObject()) throw new ApiException(400, "登记请求必须是 JSON 对象");
        return input;
    }

    private static void only(JsonNode input, Set<String> allowed, String message) {
        input.fieldNames().forEachRemaining(key -> { if (!allowed.contains(key)) throw new ApiException(400, message); });
    }

    private static boolean hasService(JsonNode items, String serviceId) {
        for (JsonNode item : items) if (serviceId.equals(item.path("manifest").path("serviceId").asText())) return true;
        return false;
    }

    private static boolean hasVersion(JsonNode items, String serviceId, String version) {
        for (JsonNode item : items) if (serviceId.equals(item.path("manifest").path("serviceId").asText()) && version.equals(item.path("manifest").path("version").asText())) return true;
        return false;
    }
}
