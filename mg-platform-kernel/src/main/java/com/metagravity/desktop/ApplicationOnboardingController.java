package com.metagravity.desktop;

import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.http.ResponseEntity;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
public class ApplicationOnboardingController {
    private final ApplicationOnboarding onboarding;
    private final AuthService auth;
    private final IdentityClient identity;
    private final AppCatalog catalog;
    public ApplicationOnboardingController(ApplicationOnboarding onboarding,AuthService auth,IdentityClient identity,AppCatalog catalog){this.onboarding=onboarding;this.auth=auth;this.identity=identity;this.catalog=catalog;}
    @RequestMapping(path={"/api/application-registrations","/api/application-registrations/{id}","/api/application-registrations/{id}/retry","/api/application-registrations/{id}/sso"},method={RequestMethod.GET,RequestMethod.POST})
    public Mono<ResponseEntity<byte[]>> handle(ServerWebExchange exchange,@PathVariable(required=false) String id,@RequestBody(required=false) byte[] body){
        return Mono.fromCallable(()->{
            var session=auth.session(exchange.getRequest().getHeaders());
            if(!"system_admin".equals(Json.string(session.profile(),"role")))throw new ApiException(403,"仅平台管理员可配置应用接入");
            String path=exchange.getRequest().getPath().value();
            if(exchange.getRequest().getMethod().name().equals("GET")){
                if(id==null || path.endsWith("/retry") || path.endsWith("/sso"))throw new ApiException(405,"不支持此请求方法");
                return PlatformController.json(200,onboarding.status(id));
            }
            auth.csrf(exchange.getRequest().getHeaders(),Json.string(session.profile(),"csrfToken"));
            if(body==null||body.length>450000)throw new ApiException(400,"注册内容过大或为空");
            if(id==null)return PlatformController.json(201,onboarding.register(Json.read(body),session));
            if(!"internal".equals(catalog.directoryItem(id).path("kind").asText()))throw new ApiException(403,"系统和默认应用由平台维护");
            if(path.endsWith("/retry"))return PlatformController.json(200,onboarding.finish(id,session));
            if(path.endsWith("/sso")){
                var input=Json.read(body);if(!input.isObject())throw new ApiException(400,"SSO 配置无效");
                var request=((com.fasterxml.jackson.databind.node.ObjectNode)input).put("clientId",id);
                return PlatformController.json(200,identity.manageClient(session.token(),Json.string(session.profile(),"csrfToken"),request));
            }
            throw new ApiException(405,"不支持此请求方法");
        }).subscribeOn(Schedulers.boundedElastic());
    }
    @GetMapping("/api/application-icons/{key}.png")
    public Mono<ResponseEntity<byte[]>> icon(@PathVariable String key){return Mono.fromCallable(()->ResponseEntity.ok().header("Content-Type","image/png").header("Cache-Control","public,max-age=31536000,immutable").body(onboarding.readIcon(key))).subscribeOn(Schedulers.boundedElastic());}
}
