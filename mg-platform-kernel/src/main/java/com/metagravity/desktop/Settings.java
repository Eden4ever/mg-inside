package com.metagravity.desktop;

import java.net.URI;
import java.nio.file.Path;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class Settings {
    private final Map<String, String> env;
    public Settings() { this(System.getenv()); }
    public Settings(Map<String, String> env) { this.env = Map.copyOf(env); }
    public String get(String name, String fallback) { var value = env.get(name); return value == null || value.isEmpty() ? fallback : value; }
    public boolean production() { return get("NODE_ENV", "").equals("production"); }
    public Path runtime() { return Path.of(get("DESKTOP_RUNTIME_DIR", ".runtime")).toAbsolutePath().normalize(); }
    public Path staticRoot() { return Path.of(get("DESKTOP_WEB_DIR", "../mg-desktop-one/dist/web")).toAbsolutePath().normalize(); }
    public String desktopOrigin() { return origin(URI.create(address("DESKTOP_ORIGIN", "http://127.0.0.1:4301", false))); }
    public String identityOrigin() { return origin(URI.create(address("IDENTITY_ISSUER", "http://127.0.0.1:14200", false))); }
    public String address(String name, String fallback, boolean internalLoopback) {
        return validateAddress(name, get(name, fallback), internalLoopback);
    }
    public String validateAddress(String name, String value, boolean internalLoopback) {
        try {
            var uri = URI.create(value);
            var host = uri.getHost();
            boolean loopback = "127.0.0.1".equals(host) || "[::1]".equals(host);
            boolean local = !production() && ("127.0.0.1".equals(host) || "localhost".equals(host));
            if (host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()) && (local || internalLoopback && loopback))) throw new IllegalArgumentException();
            return uri.toASCIIString().replaceAll("/$", "");
        } catch (IllegalArgumentException e) { throw new IllegalStateException(name + " 配置无效"); }
    }
    public static String origin(URI uri) {
        int port = uri.getPort();
        boolean standard = port == -1 || port == 443 && "https".equals(uri.getScheme()) || port == 80 && "http".equals(uri.getScheme());
        return uri.getScheme() + "://" + uri.getHost().toLowerCase(java.util.Locale.ROOT) + (standard ? "" : ":" + port);
    }
}
