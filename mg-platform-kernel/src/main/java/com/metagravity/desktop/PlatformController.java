package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@RestController
public class PlatformController {
    private final Settings settings;
    private final AppCatalog catalog;
    private final IdentityClient identity;
    private final AuthService auth;
    private final LoginFlow flow;
    private final UserState state;
    private final ApplicationVersions versions;
    private final ConcurrentHashMap<String,CompletableFuture<IdentityClient.Session>> renewals=new ConcurrentHashMap<>();
    public PlatformController(Settings settings,AppCatalog catalog,IdentityClient identity,AuthService auth,LoginFlow flow,UserState state,ApplicationVersions versions) {
        this.settings=settings;this.catalog=catalog;this.identity=identity;this.auth=auth;this.flow=flow;this.state=state;this.versions=versions;
    }
    @RequestMapping(path={"/api/health","/api/session","/api/applications","/api/applications/{id}","/api/preferences","/api/notifications","/auth/start","/auth/callback","/auth/renew","/auth/logout"})
    public Mono<ResponseEntity<byte[]>> handle(ServerWebExchange exchange,@RequestBody(required=false) byte[] body) {
        return Mono.fromCallable(()->dispatch(exchange,body)).subscribeOn(Schedulers.boundedElastic());
    }
    static ResponseEntity<byte[]> json(int status,Object value) { return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).header("Cache-Control","no-store").body(Json.bytes(value)); }
    private ResponseEntity<byte[]> redirect(String location) { return ResponseEntity.status(303).header("Location",location).body(new byte[0]); }
    private String cookie(String name,String value,double age,String path) {
        return name+"="+value+"; Path="+path+"; HttpOnly; SameSite=Lax; Max-Age="+(long)Math.max(0,Math.floor(age))+(settings.desktopOrigin().startsWith("https:")?"; Secure":"");
    }
    private ResponseEntity<byte[]> withCookies(ResponseEntity<byte[]> response,String...cookies) {
        var headers=new HttpHeaders(); headers.putAll(response.getHeaders()); headers.put("Set-Cookie",List.of(cookies));
        return new ResponseEntity<>(response.getBody(),headers,response.getStatusCode());
    }
    private JsonNode body(byte[] bytes) {
        if(bytes!=null && bytes.length>65536) throw new ApiException(413,"请求过大");
        return bytes==null || bytes.length==0?Json.object():Json.read(bytes);
    }
    private ResponseEntity<byte[]> dispatch(ServerWebExchange exchange,byte[] bytes) {
        var req=exchange.getRequest(); String path=req.getPath().value(),method=req.getMethod().name();
        var query=Urls.query(req.getURI().getRawQuery()); var headers=req.getHeaders();
        if(path.equals("/api/health")) { catalog.all(); return json(200,Map.of("status","ready","application","mg-desktop-one")); }
        if(path.equals("/auth/start") && method.equals("GET")) {
            String verifier=LoginFlow.randomToken(),nonce=LoginFlow.randomToken();
            var app=catalog.find(query.getOrDefault("app",""));
            String appId=app.map(AppCatalog.App::id).orElse(query.getOrDefault("app","").matches("external-[a-f0-9-]{36}")?query.get("app"):"");
            String fallback=app.map(a->Json.string(a.publicData(),"defaultPath")).orElse("/");
            String targetPath=Urls.safeAppPath(query.get("path"),fallback);
            if(app.isPresent() && !app.get().allowsPage(targetPath)) targetPath=fallback;
            var data=Json.object().put("verifier",verifier).put("state",nonce).put("issued",System.currentTimeMillis()).put("appId",appId).put("path",targetPath).put("standalone",app.isPresent() && "standalone".equals(query.get("display")));
            var params=new LinkedHashMap<String,String>(); params.put("client_id",settings.get("IDENTITY_CLIENT_ID","desktop-one")); params.put("redirect_uri",settings.desktopOrigin()+"/auth/callback"); params.put("state",nonce); params.put("code_challenge",LoginFlow.challenge(verifier)); params.put("code_challenge_method","S256");
            return withCookies(redirect(settings.identityOrigin()+"/api/unified/authorize?"+Urls.form(params)),cookie(LoginFlow.FLOW_COOKIE,flow.pack(data),600,"/auth"));
        }
        if(path.equals("/auth/callback") && method.equals("GET")) {
            // 即使回调失败也清除旧挑战，与既有实现一致。
            exchange.getResponse().getHeaders().add("Set-Cookie",cookie(LoginFlow.FLOW_COOKIE,"",0,"/auth"));
            var data=flow.unpack(LoginFlow.readCookie(String.join(";",headers.getOrEmpty("Cookie")),LoginFlow.FLOW_COOKIE));
            long now=System.currentTimeMillis();
            if(!LoginFlow.equal(query.get("state"),Json.string(data,"state")) || !data.path("issued").isNumber() || !Double.isFinite(data.path("issued").doubleValue()) || now-data.path("issued").doubleValue()>600000 || data.path("issued").doubleValue()>now) throw new ApiException(401,"登录请求校验失败");
            var result=identity.exchange(query.getOrDefault("code",""),Json.string(data,"verifier"),settings.desktopOrigin()+"/auth/callback");
            String targetPath=Json.string(data,"path"),appId=Json.string(data,"appId"); var app=catalog.find(appId);
            ResponseEntity<byte[]> response;
            if(data.path("standalone").asBoolean(false) && app.isPresent() && app.get().allowsPage(targetPath)) {
                auth.authorize(app.get(),result.token()); response=redirect(app.get().entryUrl().replaceAll("/$","")+Urls.safeAppPath(targetPath,"/"));
            } else {
                boolean known=app.isPresent();
                for(var external:state.enabledApplications(Json.string(result.profile(),"sub"))) known|=Json.string(external,"id").equals(appId);
                var params=new LinkedHashMap<String,String>(); if(known) { params.put("app",appId);params.put("path",Urls.safeAppPath(targetPath,"/")); }
                response=redirect("/open"+(params.isEmpty()?"":"?"+Urls.form(params)));
            }
            return withCookies(response,cookie(LoginFlow.FLOW_COOKIE,"",0,"/auth"),cookie(LoginFlow.TOKEN_COOKIE,result.token(),result.profile().path("exp").longValue()-System.currentTimeMillis()/1000d,"/"));
        }
        var session=auth.session(headers); var profile=session.profile(); String user=Json.string(profile,"sub"),token=session.token(),csrf=Json.string(profile,"csrfToken");
        if(path.equals("/api/session") && method.equals("GET")) {
            var apps=Json.MAPPER.createArrayNode(); auth.granted(token).forEach(app->apps.add(app.publicData())); apps.addAll(state.enabledApplications(user));
            var person=Json.object().put("id",user).put("name",Json.string(profile,"name")).put("role",Json.string(profile,"role"));
            for(String key:List.of("username","department","avatarUrl")) person.set(key,profile.has(key)?profile.get(key):Json.MAPPER.nullNode());
            var response=Json.object();response.set("user",person);response.put("csrfToken",csrf);response.set("expiresAt",profile.path("exp"));response.set("desktop",Json.MAPPER.valueToTree(catalog.presentation()));response.set("apps",apps);
            return json(200,response);
        }
        if(path.equals("/auth/logout") && method.equals("POST")) { auth.csrf(headers,csrf);identity.revoke(token);return withCookies(json(200,Map.of("ok",true)),cookie(LoginFlow.TOKEN_COOKIE,"",0,"/")); }
        if(path.equals("/auth/renew") && method.equals("POST")) {
            auth.csrf(headers,csrf); var updated=renew(token);
            return withCookies(json(200,Map.of("expiresAt",updated.profile().path("exp").longValue())),cookie(LoginFlow.TOKEN_COOKIE,updated.token(),updated.profile().path("exp").longValue()-System.currentTimeMillis()/1000d,"/"));
        }
        if(path.equals("/api/applications") || path.startsWith("/api/applications/")) {
            if(!"system_admin".equals(Json.string(profile,"role")))auth.authorize(catalog.find("app-manager").orElseThrow(() -> new ApiException(403,"应用管理未启用")), token);
            String id=path.equals("/api/applications")?null:path.substring("/api/applications/".length());
            if(id!=null && !id.matches("[a-z0-9-]+")) throw new ApiException(404,"接口不存在");
            boolean canManage = "system_admin".equals(Json.string(profile,"role"));
            if(method.equals("GET") && id==null) {
                var items=Json.MAPPER.createArrayNode();
                if(canManage){var granted=grantedIds(token);for(var item:catalog.directory())items.add(managedApplication(item.path("id").asText(),granted));}
                else for(var app:auth.grantedRegistered(token)) items.add(applicationDetails(app,false));
                for(var external:state.applications(user)) items.add(((ObjectNode)external).deepCopy().put("editable",true).put("available",true));
                return json(200,Map.of("desktop",catalog.presentation(),"items",items,"canRegister",canManage));
            }
            if(method.equals("GET") && id!=null) {
                if(canManage && !id.startsWith("external-"))return json(200,managedApplication(id,grantedIds(token)));
                var app = auth.grantedRegistered(token).stream().filter(item -> item.id().equals(id)).findFirst();
                if(app.isPresent()) return json(200,applicationDetails(app.get(),canManage));
                for(var external:state.applications(user)) if(Json.string(external,"id").equals(id))
                    return json(200,((ObjectNode)external).deepCopy().put("editable",true).put("available",true));
                throw new ApiException(404,"应用不存在或没有访问权限");
            }
            auth.csrf(headers,csrf);
            if(method.equals("PATCH") && id!=null) {
                if(id.startsWith("external-")) return json(200,state.setApplicationEnabled(user,id,body(bytes)).put("editable",true).put("available",true));
                if(!canManage) throw new ApiException(403,"仅平台管理员可编辑应用元数据");
                catalog.directoryItem(id);
                catalog.updateMetadata(id,body(bytes),user);
                return json(200,managedApplication(id,grantedIds(token)));
            }
            if(id!=null && catalog.find(id).isPresent()) throw new ApiException(403,"系统和内部应用不可编辑");
            if(method.equals("POST") && id==null || method.equals("PUT") && id!=null) return json(method.equals("POST")?201:200,state.saveApplication(user,body(bytes),id).put("editable",true).put("available",true));
            if(method.equals("DELETE") && id!=null) {state.removeApplication(user,id);return json(200,Map.of("ok",true));}
            throw new ApiException(405,"不支持此请求方法");
        }
        if(path.equals("/api/notifications")) {
            if(method.equals("GET")) return json(200,Map.of("items",state.notifications(user)));
            if(!Set.of("POST","PATCH","DELETE").contains(method)) throw new ApiException(405,"不支持此请求方法");
            auth.csrf(headers,csrf);return json(method.equals("POST")?201:200,Map.of("items",state.changeNotification(user,method,body(bytes))));
        }
        if(path.equals("/api/preferences")) {
            String account=headers.getFirst("X-Desktop-Account");
            if(account!=null && !account.isEmpty() && !account.equals(user)) return json(409,Map.of("code","ACCOUNT_CHANGED","message","账户已切换，请重新加载桌面"));
            if(method.equals("GET")) return json(200,state.preferences(user));
            if(method.equals("PUT")) {auth.csrf(headers,csrf);return json(200,state.savePreferences(user,body(bytes)));}
        }
        throw new ApiException(404,"接口不存在");
    }
    private ObjectNode applicationDetails(AppCatalog.App app, boolean editable) {
        var data = app.publicData().deepCopy().put("editable",editable).put("available",true);
        data.setAll(catalog.metadata(app.id()));
        String registered = data.path("registeredVersion").asText("");
        data.put("version", registered.isBlank() ? versions.version(app) : registered);
        return data;
    }
    private Set<String> grantedIds(String token){var result=new HashSet<String>();auth.grantedRegistered(token).forEach(app->result.add(app.id()));return result;}
    private ObjectNode managedApplication(String id,Set<String> granted) {
        var data=catalog.directoryItem(id).deepCopy().put("editable",true).put("available",false);
        String registered=data.path("registeredVersion").asText("");
        data.put("version",registered.isBlank()?null:registered);
        var app=catalog.registered().stream().filter(value->value.id().equals(id)).findFirst();
        if(app.isPresent()) {
            if(registered.isBlank())data.put("version",versions.version(app.get()));
            data.put("available",data.path("enabled").asBoolean() && granted.contains(id));
        }
        return data;
    }
    private IdentityClient.Session renew(String token) {
        String key=LoginFlow.sha256(token);var own=new CompletableFuture<IdentityClient.Session>();var pending=renewals.putIfAbsent(key,own);
        if(pending==null) {
            try { var result=identity.renew(token);own.complete(result);return result; }
            catch(RuntimeException e) {own.completeExceptionally(e);throw e;}
            finally {renewals.remove(key,own);}
        }
        try {return pending.join();} catch(CompletionException e) {if(e.getCause() instanceof RuntimeException runtime)throw runtime;throw e;}
    }
}
