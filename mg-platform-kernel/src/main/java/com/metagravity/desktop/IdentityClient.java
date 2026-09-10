package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.*;
import org.springframework.stereotype.Component;

/** 与身份中心 clients/unified-client.ts 保持协议一致，不签发另一套用户令牌。 */
@Component
public class IdentityClient {
    private final Settings settings;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8)).followRedirects(HttpClient.Redirect.NEVER).build();
    private String machineToken;
    private long expires;
    public record Session(String token, JsonNode profile) {}
    public IdentityClient(Settings settings) { this.settings = settings; }
    public String clientId() { return settings.get("IDENTITY_CLIENT_ID", ""); }
    private String issuer() {
        String raw = settings.get("IDENTITY_ISSUER", "https://identity.meta-gravity.com");
        try {
            URI uri = URI.create(raw);
            boolean local = !settings.production() && "http".equals(uri.getScheme()) && Set.of("127.0.0.1","localhost").contains(Objects.toString(uri.getHost(),""));
            if(uri.getHost()==null || uri.getRawUserInfo()!=null || uri.getRawQuery()!=null || uri.getRawFragment()!=null || !Set.of("","/").contains(uri.getRawPath()) || !("https".equals(uri.getScheme()) || local)) throw new IllegalArgumentException();
            return Settings.origin(uri);
        } catch(RuntimeException e) { throw new ApiException(503,"统一认证来源配置无效"); }
    }
    private HttpResponse<byte[]> send(HttpRequest request) {
        try { return http.send(request, HttpResponse.BodyHandlers.ofByteArray()); }
        catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiException(503,"统一认证服务暂时不可用"); }
        catch(java.io.IOException e) { throw new ApiException(503,"统一认证服务暂时不可用"); }
    }
    private JsonNode response(HttpResponse<byte[]> response) {
        try {
            var result = Json.read(response.body());
            if(result==null || !result.isObject()) throw new IllegalArgumentException();
            return result;
        } catch(RuntimeException e) { throw new ApiException(503,"统一认证响应格式无效"); }
    }
    private synchronized String serviceToken() {
        if(machineToken!=null && expires>System.currentTimeMillis()) return machineToken;
        String secret = settings.get("IDENTITY_CLIENT_SECRET","");
        if(clientId().isEmpty() || secret.length()<32) throw new ApiException(503,"统一认证服务凭据配置不完整");
        var form = new LinkedHashMap<String,String>();
        form.put("grant_type","client_credentials"); form.put("client_id",clientId()); form.put("client_secret",secret); form.put("scope","directory:read session:revoke");
        var result = send(HttpRequest.newBuilder(URI.create(issuer()+"/token")).timeout(Duration.ofSeconds(8)).header("Content-Type","application/x-www-form-urlencoded;charset=UTF-8").POST(HttpRequest.BodyPublishers.ofString(Urls.form(form))).build());
        if(result.statusCode()<200 || result.statusCode()>=300) throw new ApiException(503,"统一认证服务身份验证失败");
        var data = response(result);
        if(!data.path("access_token").isTextual() || !data.path("expires_in").isNumber() || data.path("expires_in").doubleValue()<=0) throw new ApiException(503,"统一认证服务响应无效");
        machineToken = data.path("access_token").textValue();
        expires = System.currentTimeMillis() + (long)(Math.max(0,Math.min(60,data.path("expires_in").doubleValue()-5))*1000);
        return machineToken;
    }
    private JsonNode request(String path, Object body) {
        for(int attempt=0;attempt<2;attempt++) {
            String token=serviceToken();
            var res=send(HttpRequest.newBuilder(URI.create(issuer()+"/api/unified/"+path)).timeout(Duration.ofSeconds(8)).header("Authorization","Bearer "+token).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofByteArray(Json.bytes(body))).build());
            if(res.statusCode()==401 && attempt==0) { synchronized(this) { if(Objects.equals(machineToken,token)) machineToken=null; } continue; }
            if(res.statusCode()<200 || res.statusCode()>=300) throw new ApiException(res.statusCode()==400 || res.statusCode()==401?401:503,"统一认证请求未通过");
            return response(res);
        }
        throw new ApiException(503,"统一认证服务身份已失效");
    }
    public static String token(String value) {
        if(value==null || !value.matches("[A-Za-z0-9_-]{43}")) throw new ApiException(401,"统一登录令牌缺失或无效");
        return value;
    }
    public JsonNode introspect(String token) { return introspect(token,clientId()); }
    public JsonNode introspect(String token,String app) {
        var data=request("introspect",Map.of("token",token(token),"app_id",app));
        if(!data.path("active").isBoolean() || !data.path("active").booleanValue()) throw new ApiException(401,"统一登录已失效或没有应用访问权限");
        return profile(data,app);
    }
    JsonNode profile(JsonNode data,String app) {
        boolean valid = data.path("active").isBoolean() && data.path("active").booleanValue() && issuer().equals(Json.string(data,"iss")) && app.equals(Json.string(data,"aud"))
            && !Json.string(data,"sub").isEmpty() && !Json.string(data,"sid").isEmpty() && !Json.string(data,"name").strip().isEmpty() && data.path("role").isTextual()
            && nullableString(data,"username") && nullableString(data,"department") && nullableString(data,"localUserId")
            && Json.safeInteger(data.path("exp")) && data.path("exp").longValue()>System.currentTimeMillis()/1000d && Json.safeInteger(data.path("securityVersion")) && Json.safeInteger(data.path("authTime"))
            && data.path("amr").isArray() && !Json.string(data,"csrfToken").isEmpty();
        for(var method:data.path("amr")) valid &= method.isTextual();
        if(data.hasNonNull("avatarUrl")) valid &= data.path("avatarUrl").isTextual() && data.path("avatarUrl").asText().length()<=2048 && data.path("avatarUrl").asText().startsWith("https://");
        if(data.has("roles")) {
            valid &= data.path("roles").isArray();
            for(var role:data.path("roles")) valid &= role.isObject() && role.path("id").isTextual() && role.path("name").isTextual() && (!role.has("key") || nullableString(role,"key"));
        }
        if(data.has("authorizationSources")) {
            valid &= data.path("authorizationSources").isArray();
            for(var source:data.path("authorizationSources")) valid &= source.isObject() && ("user".equals(Json.string(source,"type")) || "role".equals(Json.string(source,"type")) && source.path("roleId").isTextual() && source.path("name").isTextual());
        }
        if(!valid) throw new ApiException(503,"统一身份契约校验失败");
        return data;
    }
    private boolean nullableString(JsonNode data,String key) { return data.has(key) && (data.path(key).isNull() || data.path(key).isTextual()); }
    public Set<String> applications(String token) {
        var data=request("applications",Map.of("token",token(token))).path("applications");
        if(!data.isArray()) throw new ApiException(503,"授权应用目录无效");
        var result=new HashSet<String>();
        for(var app:data) {
            if(!app.path("id").isTextual() || !app.path("name").isTextual()) throw new ApiException(503,"授权应用目录无效");
            result.add(app.path("id").textValue());
        }
        return result;
    }
    public Session exchange(String code,String verifier,String redirect) {
        var data=request("exchange",Map.of("code",code,"code_verifier",verifier,"redirect_uri",redirect));
        return new Session(token(Json.string(data,"access_token")),profile(data.path("profile"),clientId()));
    }
    public Session renew(String token) {
        var data=request("renew",Map.of("token",token(token)));
        if(!token.equals(Json.string(data,"access_token"))) throw new ApiException(503,"续期未保持统一令牌一致性");
        return new Session(token,profile(data.path("profile"),clientId()));
    }
    public void revoke(String token) {
        if(!request("revoke",Map.of("token",token(token),"app_id",clientId())).path("revoked").equals(Json.MAPPER.getNodeFactory().booleanNode(true))) throw new ApiException(503,"统一退出未完成");
    }
    public boolean hasRequiredRole(AppCatalog.App app,String token) {
        if(app.requiredRole()==null) return true;
        try {
            var res=send(HttpRequest.newBuilder(ApplicationGateway.target(app.upstream(),app.policy().rolePath(),null)).timeout(Duration.ofSeconds(8)).header("Authorization","Bearer "+token).GET().build());
            if(res.statusCode()<200 || res.statusCode()>=300) return false;
            var data=response(res);
            return app.requiredRole().equals(data.at(app.policy().rolePointer()).asText());
        } catch(RuntimeException e) { return false; }
    }
}
