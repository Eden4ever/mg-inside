package com.metagravity.desktop;

import java.nio.file.*;
import java.util.*;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.web.reactive.handler.SimpleUrlHandlerMapping;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@Configuration
public class StaticContent {
    @Bean SimpleUrlHandlerMapping staticMapping(Settings settings) {
        WebHandler handler=exchange->Mono.fromCallable(()->read(settings,exchange)).subscribeOn(Schedulers.boundedElastic()).flatMap(result->{
            exchange.getResponse().setStatusCode(HttpStatusCode.valueOf(result.status()));exchange.getResponse().getHeaders().putAll(result.headers());
            return exchange.getRequest().getMethod()==HttpMethod.HEAD?exchange.getResponse().setComplete():exchange.getResponse().writeWith(Mono.just(exchange.getResponse().bufferFactory().wrap(result.body())));
        });
        return new SimpleUrlHandlerMapping(Map.of("/**",handler),Integer.MAX_VALUE);
    }
    private record Result(int status,HttpHeaders headers,byte[] body) {}
    private Result read(Settings settings,ServerWebExchange exchange) {
        String path=exchange.getRequest().getURI().getRawPath();var headers=new HttpHeaders();
        if(path.startsWith("/api/") || path.startsWith("/auth/")) return error(404,"接口不存在");
        if(!Set.of(HttpMethod.GET,HttpMethod.HEAD).contains(exchange.getRequest().getMethod())) return error(405,"不支持此请求方法");
        boolean font=path.startsWith("/fonts/");
        if(font && !path.matches("/fonts/(?:fonts\\.css|alinormal-(?:400|500|600)-[a-f0-9]{12}\\.woff2)")) return new Result(404,headers,new byte[0]);
        Path root=settings.staticRoot(),file=root.resolve(font || path.matches("/(assets|app-icons)/.*")?"."+Urls.decode(path):"index.html").normalize();
        if(!file.startsWith(root)) return error(404,"资源不存在");
        try {
            byte[] bytes=Files.readAllBytes(file);String name=file.getFileName().toString(),extension=name.substring(name.lastIndexOf('.')+1);
            String type=Map.ofEntries(Map.entry("html","text/html; charset=utf-8"),Map.entry("js","application/javascript"),Map.entry("css",font?"text/css; charset=utf-8":"text/css"),Map.entry("svg","image/svg+xml"),Map.entry("png","image/png"),Map.entry("webp","image/webp"),Map.entry("woff2","font/woff2")).getOrDefault(extension,"application/octet-stream");
            headers.set("Content-Type",type);headers.setContentLength(bytes.length);
            headers.setCacheControl(font?(extension.equals("css")?"public, max-age=0, must-revalidate":"public, max-age=31536000, immutable"):path.startsWith("/assets/")?"public, max-age=31536000, immutable":"no-store");
            return new Result(200,headers,bytes);
        } catch(java.io.IOException e) { return font?new Result(404,headers,new byte[0]):error(503,"桌面前端尚未构建，请启动前端开发服务"); }
    }
    private Result error(int status,String message) {var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.setCacheControl("no-store");return new Result(status,headers,Json.bytes(Map.of("message",message)));}
}
