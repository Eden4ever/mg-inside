package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** 与前端 services/openapi.ts 的 canonicalJson 保持对象键排序、数组顺序保留。 */
public final class CanonicalJson {
    private CanonicalJson() {}
    public static String write(JsonNode value) {
        if(value==null || value.isNull()) return "null";
        if(value.isArray()) {
            var parts=new ArrayList<String>();value.forEach(item->parts.add(write(item)));return "["+String.join(",",parts)+"]";
        }
        if(value.isObject()) {
            var names=new ArrayList<String>();value.fieldNames().forEachRemaining(names::add);Collections.sort(names);
            var parts=new ArrayList<String>();for(String name:names)parts.add(Json.text(name)+":"+write(value.get(name)));return "{"+String.join(",",parts)+"}";
        }
        return value.toString();
    }
    public static String digest(JsonNode value) {
        return sha256(write(value));
    }
    /** 旧 Node 清单使用 JSON.stringify；规范化后的字段插入顺序属于已发布存储协议。 */
    public static String manifestDigest(JsonNode value) {
        return sha256(Json.text(value));
    }
    private static String sha256(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(Exception e) { throw new IllegalStateException(e); }
    }
}
