package com.metagravity.desktop;

import java.util.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/** 内核服务清单不依赖用户登录，避免认证中心和桌面启动相互依赖。 */
@RestController
public class ApplicationRegistryController {
    private final Settings settings;
    private final AppCatalog catalog;
    private final AuthService auth;
    public ApplicationRegistryController(Settings settings, AppCatalog catalog, AuthService auth) {
        this.settings=settings; this.catalog=catalog; this.auth=auth;
    }
    @GetMapping("/internal/applications")
    public Mono<ResponseEntity<byte[]>> directory(ServerWebExchange exchange) {
        return Mono.fromCallable(() -> {
            String expected=settings.get("APPLICATION_REGISTRY_KEY", "");
            var values=exchange.getRequest().getHeaders().getOrEmpty("X-Application-Registry-Key");
            if(expected.length()<32 || values.size()!=1 || !LoginFlow.equal(values.getFirst(),expected))
                throw new ApiException(401,"内核应用目录服务身份无效");
            return PlatformController.json(200,Map.of("applications",catalog.directory()));
        }).subscribeOn(Schedulers.boundedElastic());
    }
    @RequestMapping(path="/api/application-registry",method={RequestMethod.GET,RequestMethod.POST})
    public Mono<ResponseEntity<byte[]>> manage(ServerWebExchange exchange,@RequestBody(required=false) byte[] body) {
        return Mono.fromCallable(() -> {
            var headers=exchange.getRequest().getHeaders();var session=auth.session(headers);
            if(!"system_admin".equals(Json.string(session.profile(),"role")))throw new ApiException(403,"仅平台管理员可维护应用注册");
            if(exchange.getRequest().getMethod().name().equals("GET"))return PlatformController.json(200,Map.of("applications",catalog.directory()));
            auth.csrf(headers,Json.string(session.profile(),"csrfToken"));
            if(body==null || body.length>8192)throw new ApiException(400,"应用注册内容无效");
            var input=Json.read(body);
            catalog.register(input,Json.string(session.profile(),"sub"));
            return PlatformController.json(201,catalog.directoryItem(Json.string(input,"id")));
        }).subscribeOn(Schedulers.boundedElastic());
    }
    @PutMapping("/api/application-registry/{id}/runtime")
    public Mono<ResponseEntity<byte[]>> runtime(@PathVariable String id,ServerWebExchange exchange,@RequestBody byte[] body) {
        return Mono.fromCallable(() -> {
            var headers=exchange.getRequest().getHeaders();var session=auth.session(headers);
            if(!"system_admin".equals(Json.string(session.profile(),"role")))throw new ApiException(403,"仅平台管理员可配置应用入口");
            auth.csrf(headers,Json.string(session.profile(),"csrfToken"));
            if(body==null || body.length>16384)throw new ApiException(400,"应用入口配置无效");
            catalog.configureRuntime(id,Json.read(body),Json.string(session.profile(),"sub"));
            return PlatformController.json(200,catalog.directoryItem(id));
        }).subscribeOn(Schedulers.boundedElastic());
    }
}
