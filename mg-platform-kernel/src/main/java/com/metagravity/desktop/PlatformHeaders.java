package com.metagravity.desktop;

import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.server.*;
import reactor.core.publisher.Mono;

@Component
public class PlatformHeaders implements WebFilter,Ordered {
    private final AppCatalog catalog;
    public PlatformHeaders(AppCatalog catalog) { this.catalog=catalog; }
    @Override public int getOrder() { return -100; }
    @Override public Mono<Void> filter(ServerWebExchange exchange,WebFilterChain chain) {
        return Mono.defer(() -> checkedFilter(exchange, chain))
            .subscribeOn(reactor.core.scheduler.Schedulers.boundedElastic())
            .onErrorResume(ApiException.class, e -> error(exchange, e.status(), e.getMessage()));
    }
    private Mono<Void> checkedFilter(ServerWebExchange exchange, WebFilterChain chain) {
        var headers=exchange.getResponse().getHeaders();
        headers.set("X-Content-Type-Options","nosniff");
        if(exchange.getRequest().getPath().value().startsWith("/fonts/")) { headers.set("Access-Control-Allow-Origin","*"); return chain.filter(exchange); }
        headers.set("Referrer-Policy","no-referrer");
        headers.set("Content-Security-Policy","frame-ancestors 'none'; frame-src https: http:; object-src 'none'; base-uri 'self'");
        String origin=exchange.getRequest().getHeaders().getOrigin();
        if(origin!=null) {
            if(!catalog.allowedOrigins().contains(origin)) return error(exchange,403,"未授权的应用来源");
            headers.set("Access-Control-Allow-Origin",origin); headers.set("Access-Control-Allow-Credentials","true"); headers.set("Vary","Origin");
            headers.set("Access-Control-Expose-Headers","Content-Disposition, X-Request-Id, X-Service-Id, X-Service-Lifecycle, X-Service-Retire-After, X-Api-Governance");
        }
        if(exchange.getRequest().getMethod()==HttpMethod.OPTIONS) {
            exchange.getResponse().setStatusCode(HttpStatus.NO_CONTENT);
            headers.set("Access-Control-Allow-Methods","GET, POST, PUT, PATCH, DELETE, OPTIONS");
            headers.set("Access-Control-Allow-Headers","Content-Type, X-CSRF-Token, If-Match, Range, Last-Event-ID, X-File-Name, X-File-Type"); headers.set("Access-Control-Max-Age","600");
            return exchange.getResponse().setComplete();
        }
        return chain.filter(exchange).onErrorResume(ApiException.class,e->error(exchange,e.status(),e.getMessage()));
    }
    static Mono<Void> error(ServerWebExchange exchange,int status,String message) {
        if(exchange.getResponse().isCommitted()) return Mono.error(new ApiException(status,message));
        var response=exchange.getResponse(); response.setStatusCode(HttpStatusCode.valueOf(status)); response.getHeaders().setContentType(MediaType.APPLICATION_JSON); response.getHeaders().setCacheControl("no-store");
        return response.writeWith(Mono.just(response.bufferFactory().wrap(Json.bytes(Map.of("message",message)))));
    }
}
