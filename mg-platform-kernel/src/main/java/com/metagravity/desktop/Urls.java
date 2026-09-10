package com.metagravity.desktop;

import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class Urls {
    private Urls() {}
    public static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    public static String decode(String value) { return URLDecoder.decode(value.replace("+","%2B"), StandardCharsets.UTF_8); }
    public static Map<String,String> query(String raw) {
        var values = new LinkedHashMap<String,String>();
        if (raw != null) for (String pair : raw.split("&")) {
            String[] parts = pair.split("=",2);
            values.putIfAbsent(URLDecoder.decode(parts[0],StandardCharsets.UTF_8),parts.length==2?URLDecoder.decode(parts[1],StandardCharsets.UTF_8):"");
        }
        return values;
    }
    public static String form(Map<String,String> values) { return String.join("&", values.entrySet().stream().map(e -> encode(e.getKey())+"="+encode(e.getValue())).toList()); }
    public static String safeAppPath(String input, String fallback) {
        if (input == null || input.length()>2000 || !input.startsWith("/") || input.startsWith("//") || input.matches("(?s).*[\\\\\\r\\n].*")) return fallback;
        try {
            String rawPath = input.split("[?#]",2)[0];
            if (Arrays.asList(decode(rawPath).split("/",-1)).contains("..")) return fallback;
            URI uri = URI.create("https://desktop.invalid"+input.replace(" ","%20")).normalize();
            if (!Settings.origin(uri).equals("https://desktop.invalid")) return fallback;
            var source = query(uri.getRawQuery()); var allowed = new LinkedHashMap<String,String>();
            for (String key : List.of("tab","module","view")) if(source.getOrDefault(key,"").matches("[A-Za-z0-9_-]{1,80}")) allowed.put(key,source.get(key));
            if(source.getOrDefault("open","").matches("(?i)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")) allowed.put("open",source.get("open"));
            if(Set.of("new-folder","upload","rename","move").contains(source.getOrDefault("intent",""))) allowed.put("intent",source.get("intent"));
            return uri.getRawPath()+(allowed.isEmpty()?"":"?"+form(allowed));
        } catch (RuntimeException e) { return fallback; }
    }
}
