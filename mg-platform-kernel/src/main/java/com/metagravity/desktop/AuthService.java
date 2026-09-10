package com.metagravity.desktop;

import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
public class AuthService {
    private final IdentityClient identity;
    private final AppCatalog catalog;
    public AuthService(IdentityClient identity,AppCatalog catalog) { this.identity=identity; this.catalog=catalog; }
    public IdentityClient.Session session(HttpHeaders headers) {
        String token=LoginFlow.readCookie(String.join(";",headers.getOrEmpty("Cookie")),LoginFlow.TOKEN_COOKIE);
        if(token.isEmpty()) throw new ApiException(401,"请通过统一认证登录");
        return new IdentityClient.Session(token,identity.introspect(token));
    }
    public void csrf(HttpHeaders headers,String expected) {
        if(!catalog.allowedOrigins().contains(Objects.toString(headers.getOrigin(),"")) || headers.getOrEmpty("X-CSRF-Token").size()!=1 || !LoginFlow.equal(headers.getFirst("X-CSRF-Token"),expected)) throw new ApiException(401,"请求验证失败，请刷新后重试");
    }
    public List<AppCatalog.App> granted(String token) {
        return granted(token, catalog.all());
    }
    public List<AppCatalog.App> grantedRegistered(String token) { return granted(token, catalog.registered()); }
    private List<AppCatalog.App> granted(String token, List<AppCatalog.App> apps) {
        Set<String> authorized=identity.applications(token);
        return apps.stream().filter(app->authorized.contains(app.audience())).filter(app->identity.hasRequiredRole(app,token)).toList();
    }
    public void authorize(AppCatalog.App app,String token) {
        identity.introspect(token,app.audience());
        if(!identity.hasRequiredRole(app,token)) throw new ApiException(403,"当前业务账号没有此应用的访问权限");
    }
}
