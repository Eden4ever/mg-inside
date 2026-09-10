package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;

/** 只从运维控制的文件加载部署地址；服务发布请求不能上传任意 URL。 */
public final class ServiceDeploymentCatalog {
    private static final Set<String> ROOT_FIELDS = Set.of("schemaVersion", "environments");
    private static final Set<String> ENVIRONMENT_FIELDS = Set.of("id", "name", "deployments");
    private static final Set<String> DEPLOYMENT_FIELDS = Set.of("endpointRef", "name", "appId", "providerAppId", "environment", "baseUrl", "deploymentId", "artifactDigest", "resourceRef", "deployedAt", "services");
    private static final Set<String> SERVICE_FIELDS = Set.of("serviceId", "version", "manifestDigest", "contractDigest");
    private final Path filename;
    private final java.util.function.Supplier<Set<String>> appIds;
    private ObjectNode catalog;

    public ServiceDeploymentCatalog(String filename, Set<String> appIds) {
        this(filename, () -> Set.copyOf(appIds));
    }
    public ServiceDeploymentCatalog(String filename, java.util.function.Supplier<Set<String>> appIds) {
        this.filename = filename == null || filename.isBlank() ? null : Path.of(filename).toAbsolutePath().normalize();
        this.appIds = appIds;
    }

    public boolean enabled() { return filename != null; }

    public synchronized void refresh() {
        if (!enabled()) return;
        try {
            if (Files.size(filename) > 1024 * 1024) throw new ApiException(400, "部署登记超过大小限制");
            catalog = validate(Json.read(Files.readAllBytes(filename)));
        } catch (ApiException error) {
            throw error;
        } catch (Exception error) {
            throw new ApiException(503, "部署配置暂时不可用");
        }
    }

    public synchronized ArrayNode environments() {
        ensureLoaded();
        var result = Json.MAPPER.createArrayNode();
        catalog.withArray("environments").forEach(environment -> result.add(Json.object().put("id", environment.path("id").asText()).put("name", environment.path("name").asText())));
        return result;
    }

    public synchronized ArrayNode options(String environment, Set<String> allowed) {
        ensureLoaded();
        var result = Json.MAPPER.createArrayNode();
        JsonNode selected = findEnvironment(environment);
        if (selected == null) return result;
        for (JsonNode deployment : selected.path("deployments")) if (allowed.contains(deployment.path("appId").asText())) {
            ObjectNode item = (ObjectNode) deployment.deepCopy();
            item.put("digest", CanonicalJson.digest(deployment));
            result.add(item);
        }
        return result;
    }

    public synchronized ObjectNode binding(JsonNode publication, String environment, String endpointRef, String expectedDigest) {
        ensureLoaded();
        JsonNode deployment = findDeployment(environment, endpointRef);
        if (deployment == null || !deployment.path("appId").asText().equals(publication.path("manifest").path("appId").asText())) throw new ApiException(409, "目标环境没有此应用的受控部署");
        String actual = CanonicalJson.digest(deployment);
        if (!actual.equals(expectedDigest)) throw new ApiException(409, "部署记录已更新，请刷新后重新选择");
        boolean supports = false;
        for (JsonNode service : deployment.path("services")) {
            if (service.path("serviceId").asText().equals(publication.path("manifest").path("serviceId").asText())
                && service.path("version").asText().equals(publication.path("manifest").path("version").asText())
                && service.path("manifestDigest").asText().equals(publication.path("digest").asText())
                && service.path("contractDigest").asText().equals(publication.path("contractDigest").asText())) supports = true;
        }
        if (!publication.path("contractDigest").isTextual() || !supports) throw new ApiException(409, "目标部署未声明支持此版本及契约，不能切换");
        return Json.object().put("environment", environment).put("endpointRef", endpointRef).put("deploymentId", deployment.path("deploymentId").asText()).put("deploymentDigest", actual)
            .put("manifestDigest", publication.path("digest").asText()).put("contractDigest", publication.path("contractDigest").asText());
    }

    public synchronized ObjectNode resolve(JsonNode publication, JsonNode binding, String environment) {
        ensureLoaded();
        if (!binding.isObject() || !environment.equals(binding.path("environment").asText())) throw new ApiException(503, "当前环境尚未绑定服务部署");
        ObjectNode expected;
        try { expected = binding(publication, environment, binding.path("endpointRef").asText(), binding.path("deploymentDigest").asText()); }
        catch (ApiException error) { throw new ApiException(503, error.getMessage()); }
        if (!CanonicalJson.write(binding).equals(CanonicalJson.write(expected))) throw new ApiException(503, "服务绑定与版本或部署不一致，请重新发布");
        return (ObjectNode) Objects.requireNonNull(findDeployment(environment, binding.path("endpointRef").asText())).deepCopy();
    }

    ObjectNode validate(JsonNode input) {
        fields(input, ROOT_FIELDS, "部署环境配置无效");
        if (input.path("schemaVersion").asInt() != 1 || !input.path("environments").isArray() || input.path("environments").isEmpty() || input.path("environments").size() > 16) throw new ApiException(400, "部署环境配置无效");
        Set<String> environments = new HashSet<>();
        Set<String> knownApps = appIds.get();
        for (JsonNode environment : input.path("environments")) {
            fields(environment, ENVIRONMENT_FIELDS, "部署环境定义无效");
            String environmentId = environment.path("id").asText();
            if (!environmentId.matches("[a-z][a-z0-9-]{1,31}") || !environments.add(environmentId) || !environment.path("name").isTextual() || environment.path("name").asText().strip().isEmpty() || environment.path("name").asText().length() > 40 || !environment.path("deployments").isArray() || environment.path("deployments").size() > 256) throw new ApiException(400, "部署环境定义无效");
            Set<String> refs = new HashSet<>();
            for (JsonNode deployment : environment.path("deployments")) validateDeployment(deployment, environmentId, refs, knownApps);
        }
        return (ObjectNode) input.deepCopy();
    }

    private void validateDeployment(JsonNode item, String environment, Set<String> refs, Set<String> knownApps) {
        fields(item, DEPLOYMENT_FIELDS, "部署实例定义无效");
        String endpointRef = item.path("endpointRef").asText();
        if (!endpointRef.matches("[a-z][a-z0-9-]{1,63}") || !refs.add(endpointRef) || !environment.equals(item.path("environment").asText()) || !knownApps.contains(item.path("appId").asText()) || !knownApps.contains(item.path("providerAppId").asText())
            || !item.path("name").isTextual() || item.path("name").asText().strip().isEmpty() || item.path("name").asText().length() > 100
            || !item.path("deploymentId").asText().matches("[A-Za-z0-9@._:-]{1,180}") || !digest(item.path("artifactDigest"))
            || !item.path("resourceRef").isTextual() || item.path("resourceRef").asText().strip().isEmpty() || item.path("resourceRef").asText().length() > 200
            || !validInstant(item.path("deployedAt").asText())) throw new ApiException(400, "部署实例定义无效");
        validateBaseUrl(item.path("baseUrl").asText());
        if (!item.path("services").isArray() || item.path("services").isEmpty() || item.path("services").size() > 200) throw new ApiException(400, "缺少已部署的服务契约");
        Set<String> services = new HashSet<>();
        for (JsonNode service : item.path("services")) {
            fields(service, SERVICE_FIELDS, "已部署服务的归属、版本或摘要无效");
            String key = service.path("serviceId").asText() + "@" + service.path("version").asText();
            if (!service.path("serviceId").asText().startsWith(item.path("appId").asText() + ".") || !service.path("version").asText().matches("\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}") || !digest(service.path("manifestDigest")) || !digest(service.path("contractDigest")) || !services.add(key)) throw new ApiException(400, "已部署服务的归属、版本或摘要无效");
        }
    }

    private static void validateBaseUrl(String input) {
        try {
            URI uri = URI.create(input);
            String host = Objects.toString(uri.getHost(), "").toLowerCase(Locale.ROOT);
            boolean local = Set.of("127.0.0.1", "localhost", "::1", "[::1]").contains(host);
            if (uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()) && local)
                || uri.getRawPath().contains("%") || uri.getRawPath().contains("//") || input.endsWith("/") || !uri.toASCIIString().equals(input)) throw new IllegalArgumentException();
        } catch (RuntimeException error) {
            throw new ApiException(400, "受控服务地址必须为 HTTPS 或本机地址，不能带凭据或查询参数");
        }
    }

    private JsonNode findEnvironment(String id) {
        for (JsonNode item : catalog.path("environments")) if (id.equals(item.path("id").asText())) return item;
        return null;
    }

    private JsonNode findDeployment(String environment, String endpointRef) {
        JsonNode selected = findEnvironment(environment);
        if (selected != null) for (JsonNode item : selected.path("deployments")) if (endpointRef.equals(item.path("endpointRef").asText())) return item;
        return null;
    }

    private void ensureLoaded() { if (catalog == null) throw new ApiException(503, "部署配置尚未加载"); }
    private static boolean digest(JsonNode value) { return value.isTextual() && value.asText().matches("[a-f0-9]{64}"); }
    private static boolean validInstant(String value) { try { Instant.parse(value); return true; } catch (RuntimeException error) { return false; } }
    private static void fields(JsonNode value, Set<String> allowed, String message) {
        if (!value.isObject()) throw new ApiException(400, message);
        value.fieldNames().forEachRemaining(key -> { if (!allowed.contains(key)) throw new ApiException(400, message); });
    }
}
