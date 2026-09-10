package com.metagravity.desktop;

import java.net.URI;
import java.util.*;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicLong;
import org.reactivestreams.Publisher;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.server.reactive.ServerHttpResponseDecorator;
import reactor.core.publisher.Flux;
import reactor.core.publisher.SignalType;
import org.springframework.cloud.gateway.filter.GatewayFilter;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.core.Ordered;
import org.springframework.cloud.gateway.filter.headers.HttpHeadersFilter;
import org.springframework.cloud.gateway.route.*;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.*;
import org.springframework.http.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import static org.springframework.cloud.gateway.support.ServerWebExchangeUtils.GATEWAY_REQUEST_URL_ATTR;

@Configuration
public class ApplicationGateway {
    static final String APP="mg.gateway.app",TOKEN="mg.gateway.token",SERVICE="mg.gateway.service",DEPLOYMENT="mg.gateway.deployment",ACTOR="mg.gateway.actor",START="mg.gateway.start",AUDIT_APP="mg.gateway.auditApp",MODE="mg.gateway.apiMode";
    private final AppCatalog catalog;
    private final AuthService auth;
    private final ServiceRegistry services;
    private final ServiceTelemetry telemetry;
    public ApplicationGateway(AppCatalog catalog,AuthService auth,ServiceRegistry services,ServiceTelemetry telemetry) { this.catalog=catalog;this.auth=auth;this.services=services;this.telemetry=telemetry; }
    @Bean RouteLocator applicationRoutes(RouteLocatorBuilder builder) {
        // 10001：在框架 RouteToRequestUrlFilter 之后设置已核验的实际目标。
        return builder.routes()
            .route("registered-services",route->route.path("/api/services/**").filters(filters->filters.filter(service(),10001)).uri("http://127.0.0.1"))
            .route("registered-applications",route->route.path("/api/apps/**").filters(filters->filters.filter(application(),10001)).uri("http://127.0.0.1"))
            .build();
    }

    GatewayFilter service() {
        return (exchange,chain)->Mono.fromCallable(()->{
            String rawPath=exchange.getRequest().getURI().getRawPath(),method=exchange.getRequest().getMethod().name();
            var direct=java.util.regex.Pattern.compile("^/api/services/apps/([a-z0-9-]+)(/.*)$").matcher(rawPath);
            var named=java.util.regex.Pattern.compile("^/api/services/invoke/([a-z0-9.-]+)/([A-Za-z0-9_-]+)$").matcher(rawPath);
            if(!direct.matches()&&!named.matches())throw new ApiException(404,"接口不存在");
            var session=auth.session(exchange.getRequest().getHeaders());
            exchange.getAttributes().put(ACTOR,Json.string(session.profile(),"sub"));
            services.refresh(true);
            ServiceRegistry.Target target;
            String query=exchange.getRequest().getURI().getRawQuery();
            if(direct.matches()) target=services.resolve(direct.group(1),method,direct.group(2));
            else {
                var parameters=new HashMap<String,String>();
                Urls.query(query).forEach((key,value)->{if(key.startsWith("path."))parameters.put(key.substring(5),value);});
                target=services.invoke(named.group(1),named.group(2),method,parameters);
                query=withoutPathParameters(query);
            }
            prepareService(exchange,target,session,query);
            return exchange;
        }).subscribeOn(Schedulers.boundedElastic()).flatMap(chain::filter).onErrorResume(error->{
            if(error instanceof ApiException api)return PlatformHeaders.error(exchange,api.status(),api.getMessage());
            if(exchange.getResponse().isCommitted())return Mono.error(error);
            return PlatformHeaders.error(exchange,502,"业务服务暂时不可用，请稍后重试");
        });
    }

    private void prepareService(ServerWebExchange exchange,ServiceRegistry.Target target,IdentityClient.Session session,String query) {
        exchange.getAttributes().put(SERVICE,target);
        var app=catalog.find(target.manifest().path("appId").asText()).orElseThrow(()->new ApiException(403,"服务绑定不可用"));
        String method=exchange.getRequest().getMethod().name();
        if(!app.allowsApi(target.path()) || !app.policy().allowedApiMethods().contains(method))throw new ApiException(403,"服务绑定不可用");
        auth.authorize(app,session.token());
        if(!Set.of("GET","HEAD").contains(method))auth.csrf(exchange.getRequest().getHeaders(),Json.string(session.profile(),"csrfToken"));
        var deployment=services.deployment(target.manifest().path("serviceId").asText());
        String upstream=deployment==null?app.upstream():deployment.path("baseUrl").asText();
        exchange.getAttributes().put(GATEWAY_REQUEST_URL_ATTR,target(upstream,target.path(),query));
        exchange.getAttributes().put(APP,app);exchange.getAttributes().put(TOKEN,session.token());
        if ("websocket".equalsIgnoreCase(exchange.getRequest().getHeaders().getUpgrade())) {
            if (!"GET".equals(method) || !app.policy().websocketPaths().contains(target.path())
                || !catalog.allowedOrigins().contains(Objects.toString(exchange.getRequest().getHeaders().getOrigin(),""))
                || query != null && !query.isEmpty()) throw new ApiException(403,"WebSocket 请求未获授权");
            URI socketTarget = exchange.getAttribute(GATEWAY_REQUEST_URL_ATTR);
            exchange.getAttributes().put(GATEWAY_REQUEST_URL_ATTR, URI.create(socketTarget.toString().replaceFirst("^http", "ws")));
        }
        if(deployment!=null)exchange.getAttributes().put(DEPLOYMENT,deployment);
        var headers=exchange.getResponse().getHeaders();
        headers.set("X-Service-Id",target.manifest().path("serviceId").asText());
        headers.set("X-Service-Lifecycle",target.lifecycle().path("status").asText());
        if(target.lifecycle().path("retireAfter").isTextual())headers.set("X-Service-Retire-After",target.lifecycle().path("retireAfter").textValue());
        if("postgresql".equals(services.storageStatus().path("backend").asText()))headers.set("X-Service-Catalog",services.storageStatus().path("stale").asBoolean()?"cached":"current");
        if(deployment!=null){headers.set("X-Service-Environment",services.environment());headers.set("X-Service-Deployment",deployment.path("deploymentId").asText());}
    }

    @Bean GlobalFilter serviceObservations() { return new ObservationFilter(telemetry); }
    static final class ObservationFilter implements GlobalFilter, Ordered {
        private final ServiceTelemetry telemetry;
        ObservationFilter(ServiceTelemetry telemetry) { this.telemetry=telemetry; }
        // 必须包住 NettyWriteResponseFilter（-1），完成信号才包含真正的响应写入。
        @Override public int getOrder() { return -2; }
        @Override public Mono<Void> filter(ServerWebExchange exchange,GatewayFilterChain chain) {
            String route=exchange.getRequest().getPath().value();
            if(!route.startsWith("/api/services/")&&!route.startsWith("/api/apps/"))return chain.filter(exchange);
            exchange.getAttributes().put(START,System.nanoTime());
            exchange.getResponse().getHeaders().set("X-Request-Id",UUID.randomUUID().toString().replace("-",""));
            var bytes=new AtomicLong();var failure=new java.util.concurrent.atomic.AtomicBoolean();var cancelled=new java.util.concurrent.atomic.AtomicBoolean();
            var response=new ServerHttpResponseDecorator(exchange.getResponse()) {
                @Override public Mono<Void> writeWith(Publisher<? extends DataBuffer> body){return super.writeWith(Flux.from(body).doOnCancel(()->cancelled.set(true)).doOnNext(buffer->bytes.addAndGet(buffer.readableByteCount())));}
                @Override public Mono<Void> writeAndFlushWith(Publisher<? extends Publisher<? extends DataBuffer>> body){return super.writeAndFlushWith(Flux.from(body).doOnCancel(()->cancelled.set(true)).map(part->Flux.from(part).doOnCancel(()->cancelled.set(true)).doOnNext(buffer->bytes.addAndGet(buffer.readableByteCount()))));}
            };
            return chain.filter(exchange.mutate().response(response).build()).doOnError(error->failure.set(true)).doFinally(signal->{
                ServiceRegistry.Target target=exchange.getAttribute(SERVICE);Long started=exchange.getAttribute(START);
                if(started==null)return;
                boolean wasCancelled=signal==SignalType.CANCEL||cancelled.get();
                int status=wasCancelled?499:response.getStatusCode()==null?(failure.get()?502:200):response.getStatusCode().value();
                String outcome=wasCancelled?"cancelled":failure.get()||status>=400?"error":"success";
                if(target==null) {
                    // 未登记请求不能伪装成某个服务的操作记录；进入管理员可见的治理审计。
                    var audit=Json.object().put("id",UUID.randomUUID().toString()).put("at",Instant.now().toString())
                        .put("action","api-route").put("appId",Objects.toString(exchange.getAttribute(AUDIT_APP),""))
                        .put("apiMode",Objects.toString(exchange.getAttribute(MODE),"registered"))
                        .put("method",exchange.getRequest().getMethod().name()).put("path",route.length()<=500?route:"[path-too-long]")
                        .put("actor",Objects.toString(exchange.getAttribute(ACTOR),""))
                        .put("requestId",response.getHeaders().getFirst("X-Request-Id")).put("status",status).put("outcome",outcome)
                        .put("forwarded",exchange.getAttributes().containsKey(APP))
                        .put("durationMs",(System.nanoTime()-started)/1_000_000);
                    telemetry.audit(audit);return;
                }
                var event=Json.object().put("id",UUID.randomUUID().toString()).put("at",Instant.now().toString()).put("serviceId",target.manifest().path("serviceId").asText()).put("version",target.manifest().path("version").asText()).put("operationId",target.operation().path("operationId").asText()).put("method",target.operation().path("method").asText()).put("path",target.operation().path("path").asText()).put("actor",Objects.toString(exchange.getAttribute(ACTOR),"")).put("requestId",response.getHeaders().getFirst("X-Request-Id")).put("status",status).put("outcome",outcome).put("durationMs",(System.nanoTime()-started)/1_000_000);
                if(!failure.get()&&!wasCancelled&&signal==SignalType.ON_COMPLETE)event.put("responseBytes",bytes.get());
                telemetry.record(event);
            });
        }
    }

    private static String withoutPathParameters(String rawQuery) {
        if(rawQuery==null||rawQuery.isEmpty())return null;
        var kept=new ArrayList<String>();
        for(String part:rawQuery.split("&"))if(!Urls.decode(part.split("=",2)[0]).startsWith("path."))kept.add(part);
        return kept.isEmpty()?null:String.join("&",kept);
    }
    GatewayFilter application() {
        return (exchange,chain)->Mono.fromCallable(()->{
            String path=exchange.getRequest().getURI().getRawPath();
            var matcher=java.util.regex.Pattern.compile("^/api/apps/([a-z0-9-]+)(/.*)$").matcher(path);
            if(!matcher.matches()) throw new ApiException(404,"接口不存在");
            exchange.getAttributes().put(AUDIT_APP,matcher.group(1));
            var app=catalog.find(matcher.group(1)).orElseThrow(()->new ApiException(404,"应用不存在"));
            var session=auth.session(exchange.getRequest().getHeaders());
            exchange.getAttributes().put(ACTOR,Json.string(session.profile(),"sub"));
            exchange.getAttributes().put(MODE,app.policy().apiMode());
            String rest=canonicalApiPath(matcher.group(2)),method=exchange.getRequest().getMethod().name();
            if(!app.allowsApi(rest)) throw new ApiException(403,"该接口不属于此应用");
            if(!app.policy().allowedApiMethods().contains(method)) throw new ApiException(403,"应用不允许此请求方法");
            services.refresh(true);
            ServiceRegistry.Target registered=services.resolveApplication(app.id(),method,rest,"compatibility".equals(app.policy().apiMode()));
            if(registered!=null) {prepareService(exchange,registered,session,exchange.getRequest().getURI().getRawQuery());return exchange;}
            if(exchange.getRequest().getHeaders().getUpgrade()!=null) throw new ApiException(403,"升级连接必须登记服务契约");
            auth.authorize(app,session.token());
            if(!Set.of("GET","HEAD").contains(method)) auth.csrf(exchange.getRequest().getHeaders(),Json.string(session.profile(),"csrfToken"));
            URI target=target(app.upstream(),rest,exchange.getRequest().getURI().getRawQuery());
            exchange.getAttributes().put(GATEWAY_REQUEST_URL_ATTR,target);exchange.getAttributes().put(APP,app);exchange.getAttributes().put(TOKEN,session.token());
            exchange.getResponse().getHeaders().set("X-Api-Governance","unregistered-compatibility");
            return exchange;
        }).subscribeOn(Schedulers.boundedElastic()).flatMap(chain::filter).onErrorResume(error->{
            if(error instanceof ApiException api) return PlatformHeaders.error(exchange,api.status(),api.getMessage());
            if(exchange.getResponse().isCommitted()) return Mono.error(error);
            return PlatformHeaders.error(exchange,502,"业务服务暂时不可用，请稍后重试");
        });
    }
    static String canonicalApiPath(String path) {
        if(!path.matches("/[A-Za-z0-9/_-]*")||path.contains("//"))throw new ApiException(400,"应用请求路径无效");
        return path.length()>1&&path.endsWith("/")?path.substring(0,path.length()-1):path;
    }
    static URI target(String upstream,String path,String query) {
        try {
            URI base=URI.create(upstream),target=URI.create(upstream+path+(query==null?"":"?"+query)).normalize();
            String decoded=Urls.decode(target.getRawPath());
            if(!Settings.origin(base).equals(Settings.origin(target)) || !target.getRawPath().startsWith(base.getRawPath().replaceAll("/$","")+"/") || Arrays.asList(decoded.split("/",-1)).contains("..") || decoded.contains("\\")) throw new IllegalArgumentException();
            return target;
        } catch(RuntimeException e) { throw new ApiException(400,"应用请求路径无效"); }
    }
    @Bean HttpHeadersFilter outboundRequestHeaders() {
        return new HttpHeadersFilter() {
            @Override public HttpHeaders filter(HttpHeaders input,ServerWebExchange exchange) {
                if(!exchange.getAttributes().containsKey(APP)) return input;
                var headers=new HttpHeaders(); headers.setBearerAuth(exchange.getAttribute(TOKEN)); headers.set("Accept-Encoding","identity");
                String requestId=exchange.getResponse().getHeaders().getFirst("X-Request-Id");
                if(requestId!=null)headers.set("X-Request-Id",requestId);
                for(String key:List.of("content-type","content-length","accept","x-csrf-token","range","if-none-match","if-match","last-event-id","x-file-name","x-file-type")) if(input.containsHeader(key)) headers.put(key,input.getOrEmpty(key));
                if ("websocket".equalsIgnoreCase(input.getUpgrade())) {
                    for (String key : List.of("connection","upgrade","sec-websocket-key","sec-websocket-version","sec-websocket-protocol","sec-websocket-extensions")) if(input.containsHeader(key)) headers.put(key,input.getOrEmpty(key));
                }
                return headers;
            }
            @Override public boolean supports(Type type) { return type==Type.REQUEST; }
        };
    }
    @Bean HttpHeadersFilter inboundResponseHeaders() {
        return new HttpHeadersFilter() {
            @Override public HttpHeaders filter(HttpHeaders input,ServerWebExchange exchange) {
                AppCatalog.App app=exchange.getAttribute(APP);
                if(app==null) return input;
                var headers=new HttpHeaders();
                for(String key:List.of("content-type","content-length","content-disposition","content-range","accept-ranges","etag","last-modified")) if(input.containsHeader(key)) headers.put(key,input.getOrEmpty(key));
                headers.setCacheControl("no-store");headers.set("X-Accel-Buffering","no");
                if(input.getLocation()!=null) {
                    try {
                        URI target=exchange.getAttribute(GATEWAY_REQUEST_URL_ATTR),location=target.resolve(input.getLocation());
                        if(Settings.origin(location).equals(Settings.origin(URI.create(app.entryUrl())))) headers.setLocation(location);
                    } catch(RuntimeException ignored) {}
                }
                return headers;
            }
            @Override public boolean supports(Type type) { return type==Type.RESPONSE; }
        };
    }
}
