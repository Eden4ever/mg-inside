package com.metagravity.desktop;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.charset.StandardCharsets;

public final class Json {
    public static final ObjectMapper MAPPER = new ObjectMapper();
    private Json() {}
    public static JsonNode read(byte[] bytes) {
        try { return MAPPER.readTree(bytes); }
        catch (java.io.IOException e) { throw new ApiException(400, "请求 JSON 格式无效"); }
    }
    public static JsonNode read(String value) { return read(value.getBytes(StandardCharsets.UTF_8)); }
    public static byte[] bytes(Object value) {
        try { return MAPPER.writeValueAsBytes(value); }
        catch (JsonProcessingException e) { throw new IllegalStateException("JSON 编码失败", e); }
    }
    public static String text(Object value) { return new String(bytes(value), StandardCharsets.UTF_8); }
    public static ObjectNode object() { return MAPPER.createObjectNode(); }
    public static String string(JsonNode node, String key) { return node.path(key).isTextual() ? node.path(key).textValue() : ""; }
    public static boolean safeInteger(JsonNode value) { return value.isIntegralNumber() && value.canConvertToLong() && Math.abs((double)value.longValue()) <= 9007199254740991d; }
}
