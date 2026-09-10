package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** 应用专属行为由注册数据声明，运行内核不按应用 ID 分支。 */
public record ApplicationPolicy(String apiMode, String versionOwnerAppId, String rolePath, String rolePointer, List<String> allowedApiMethods, List<String> websocketPaths, String launchMode) {
    private static final Set<String> METHODS = Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
    static ApplicationPolicy parse(String appId, JsonNode input) {
        JsonNode value = input == null || input.isNull() ? Json.object() : input;
        if (!value.isObject()) throw new IllegalStateException("应用运行策略必须是对象");
        value.fieldNames().forEachRemaining(key -> {
            if (!Set.of("apiMode", "versionOwnerAppId", "rolePath", "rolePointer", "allowedApiMethods", "websocketPaths", "launchMode").contains(key)) throw new IllegalStateException("应用运行策略包含未知字段");
        });
        String mode = string(value, "apiMode", "registered"), owner = string(value, "versionOwnerAppId", appId);
        String path = string(value, "rolePath", "/auth/me"), pointer = string(value, "rolePointer", "/role");
        if (!Set.of("registered", "compatibility").contains(mode) || !owner.matches("[a-z][a-z0-9-]{1,63}")
            || !path.matches("/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+") || !pointer.matches("(?:/[A-Za-z0-9_-]+)+"))
            throw new IllegalStateException("应用运行策略无效");
        var methods = new ArrayList<String>();
        if (!value.has("allowedApiMethods")) methods.addAll(List.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        else {
            if (!value.path("allowedApiMethods").isArray()) throw new IllegalStateException("应用请求方法必须是数组");
            for (JsonNode method : value.path("allowedApiMethods")) {
                if (!method.isTextual() || !METHODS.contains(method.asText()) || methods.contains(method.asText())) throw new IllegalStateException("应用请求方法无效");
                methods.add(method.asText());
            }
        }
        var sockets = new ArrayList<String>();
        if (value.has("websocketPaths")) {
            if (!value.path("websocketPaths").isArray()) throw new IllegalStateException("WebSocket 路径必须是数组");
            for (JsonNode socket : value.path("websocketPaths")) {
                if (!socket.isTextual() || !socket.asText().matches("/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]+") || sockets.contains(socket.asText())) throw new IllegalStateException("WebSocket 路径无效");
                sockets.add(socket.asText());
            }
            if (!sockets.isEmpty() && !"registered".equals(mode)) throw new IllegalStateException("WebSocket 必须登记服务契约");
        }
        String launch=string(value,"launchMode","embedded");
        if(!Set.of("embedded","tab").contains(launch))throw new IllegalStateException("应用打开方式无效");
        return new ApplicationPolicy(mode, owner, path, pointer, List.copyOf(methods), List.copyOf(sockets),launch);
    }
    private static String string(JsonNode value, String key, String fallback) {
        if (!value.has(key)) return fallback;
        if (!value.path(key).isTextual()) throw new IllegalStateException("应用运行策略字段类型无效");
        return value.path(key).asText();
    }
}
