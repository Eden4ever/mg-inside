package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;
import java.net.URI;
import java.nio.file.*;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.*;
import org.springframework.stereotype.Component;

/** 保留 Node 的 SHA-256 用户文件名与 JSON 结构；同一数据目录只允许一个写入服务。 */
@Component
public class UserState {
    private final Path root;
    private final AppCatalog catalog;
    private final Set<String> protectedHosts=new HashSet<>();
    private final Object[] locks=new Object[128];
    private static final DateTimeFormatter TIME=new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
    public UserState(Settings settings,AppCatalog catalog) {
        root=settings.runtime(); this.catalog=catalog;
        protectedHosts.add(URI.create(settings.desktopOrigin()).getHost());
        protectedHosts.add(URI.create(settings.identityOrigin()).getHost());
        Arrays.setAll(locks,index->new Object());
    }
    private Object lock(String user) { return locks[(user.hashCode()&Integer.MAX_VALUE)%locks.length]; }
    private Path file(String area,String user) { return root.resolve(area).resolve(LoginFlow.sha256(user)+".json"); }
    private JsonNode read(String area,String user,boolean array) {
        try { return Json.read(Files.readAllBytes(file(area,user))); }
        catch(NoSuchFileException e) { return array?Json.MAPPER.createArrayNode():Json.object(); }
        catch(IOException e) { throw new IllegalStateException("个人数据读取失败",e); }
    }
    private void write(String area,String user,JsonNode data) {
        try { PrivateFiles.replace(file(area,user),Json.bytes(data)); }
        catch(IOException e) { throw new IllegalStateException("个人数据保存失败",e); }
    }
    public ArrayNode applications(String user) { synchronized(lock(user)) { return (ArrayNode)read("applications",user,true); } }
    public ArrayNode enabledApplications(String user) {
        var items=Json.MAPPER.createArrayNode();
        applications(user).forEach(item -> { if(item.path("enabled").asBoolean(true)) items.add(item); });
        return items;
    }
    public ObjectNode setApplicationEnabled(String user, String id, JsonNode input) {
        if(input==null || !input.isObject() || input.size()!=1 || !input.path("enabled").isBoolean()) throw new ApiException(400,"应用启停参数无效");
        synchronized(lock(user)) {
            var items=applications(user);
            for(var item:items) if(Json.string(item,"id").equals(id)) {
                var result=((ObjectNode)item).put("enabled",input.path("enabled").asBoolean());
                write("applications",user,items); return result;
            }
            throw new ApiException(404,"外链应用不存在");
        }
    }
    public ObjectNode saveApplication(String user,JsonNode input,String id) {
        var value=externalApplication(input);
        synchronized(lock(user)) {
            var items=applications(user); int index=-1;
            for(int i=0;i<items.size();i++) if(Json.string(items.get(i),"id").equals(id)) index=i;
            if(id!=null && index<0) throw new ApiException(404,"外链应用不存在");
            if(id==null && items.size()>=32) throw new ApiException(400,"最多可添加 32 个外链应用");
            value.put("id",id==null?"external-"+UUID.randomUUID():id).put("kind","external").put("defaultPath","/").put("minWidth",640).put("minHeight",480);
            value.set("allowedPaths",Json.MAPPER.valueToTree(List.of("/")));
            value.put("enabled",index<0 || items.get(index).path("enabled").asBoolean(true));
            if(index>=0) items.set(index,value); else items.add(value);
            write("applications",user,items); return value;
        }
    }
    public void removeApplication(String user,String id) {
        synchronized(lock(user)) {
            var items=applications(user); int index=-1;
            for(int i=0;i<items.size();i++) if(Json.string(items.get(i),"id").equals(id)) index=i;
            if(index<0) throw new ApiException(404,"外链应用不存在");
            items.remove(index); write("applications",user,items);
        }
    }
    ObjectNode externalApplication(JsonNode input) {
        if(input==null || !input.isObject()) throw new ApiException(400,"应用配置无效");
        String name=Json.string(input,"name"),url=Json.string(input,"url");
        if(name.strip().isEmpty() || name.length()>80) throw new ApiException(400,"应用名称应为 1 至 80 个字符");
        if(url.isEmpty() || url.length()>4096) throw new ApiException(400,"应用地址无效");
        URI uri;
        try { uri=URI.create(url); if(uri.getHost()==null) throw new IllegalArgumentException(); }
        catch(RuntimeException e) { throw new ApiException(400,"请输入完整的 HTTP 或 HTTPS 地址"); }
        if(!Set.of("http","https").contains(uri.getScheme()) || uri.getRawUserInfo()!=null) throw new ApiException(400,"应用地址不支持此协议或内嵌账号密码");
        String host=uri.getHost().toLowerCase(Locale.ROOT);
        var currentHosts = new HashSet<>(protectedHosts);
        catalog.registered().forEach(app -> currentHosts.add(URI.create(app.entryUrl()).getHost().toLowerCase(Locale.ROOT)));
        if(currentHosts.stream().anyMatch(protectedHost->host.equals(protectedHost)||host.endsWith("."+protectedHost))) throw new ApiException(400,"平台应用请使用已有入口，不能作为外链重复添加");
        if(input.has("description") && (!input.path("description").isTextual() || input.path("description").textValue().length()>200)) throw new ApiException(400,"应用说明不能超过 200 个字符");
        if(input.has("developer") && (!input.path("developer").isTextual() || input.path("developer").textValue().length()>120)) throw new ApiException(400,"开发者名称不能超过 120 个字符");
        if(input.has("icon") && !Set.of("knowledge","token","identity","personal").contains(Json.string(input,"icon"))) throw new ApiException(400,"应用图标不支持此类型");
        String href=Settings.origin(uri)+(uri.getRawPath().isEmpty()?"/":uri.normalize().getRawPath())+(uri.getRawQuery()==null?"":"?"+uri.getRawQuery())+(uri.getRawFragment()==null?"":"#"+uri.getRawFragment());
        return Json.object().put("name",name.strip()).put("description",Json.string(input,"description").strip()).put("developer",Json.string(input,"developer").strip()).put("entryUrl",href).put("icon",input.has("icon")?input.path("icon").textValue():"knowledge");
    }
    public JsonNode preferences(String user) { synchronized(lock(user)) { return read("preferences",user,false); } }
    public JsonNode savePreferences(String user,JsonNode input) {
        if(input==null || !input.isObject()) throw new ApiException(400,"偏好参数无效");
        synchronized(lock(user)) {
            var ids=new HashSet<String>(); catalog.all().forEach(app->ids.add(app.id())); applications(user).forEach(app->ids.add(Json.string(app,"id")));
            var value=Json.object().put("theme",Set.of("system","light","dark").contains(Json.string(input,"theme"))?input.path("theme").textValue():"system")
                .put("wallpaper",Set.of("dawn","dusk").contains(Json.string(input,"wallpaper"))?input.path("wallpaper").textValue():"dawn")
                .put("restore",!input.path("restore").equals(BooleanNode.FALSE));
            value.set("pinned",input.path("pinned").isArray()?filteredIds(input.path("pinned"),ids):Json.MAPPER.valueToTree(catalog.all().stream().map(AppCatalog.App::id).toList()));
            value.set("applicationOrder",filteredIds(input.path("applicationOrder"),ids));
            write("preferences",user,value); return value;
        }
    }
    private ArrayNode filteredIds(JsonNode array,Set<String> allowed) {
        var ids=new LinkedHashSet<String>();
        if(array.isArray()) for(var value:array) if(value.isTextual() && allowed.contains(value.textValue()) && ids.size()<40) ids.add(value.textValue());
        return Json.MAPPER.valueToTree(ids);
    }
    public ArrayNode notifications(String user) { synchronized(lock(user)) { return (ArrayNode)read("notifications",user,true); } }
    public ArrayNode changeNotification(String user,String method,JsonNode input) {
        if(input==null || !input.isObject() || input.has("id") && (!input.path("id").isTextual() || Json.string(input,"id").isEmpty() || Json.string(input,"id").length()>80)) throw new ApiException(400,"通知参数无效");
        synchronized(lock(user)) {
            var items=notifications(user); String id=Json.string(input,"id");
            if(method.equals("POST")) {
                String text=Json.string(input,"text"),appId=Json.string(input,"appId");
                var app=catalog.find(appId);
                if(text.strip().isEmpty() || text.length()>500 || !appId.isEmpty() && app.isEmpty()) throw new ApiException(400,"通知内容无效");
                var result=Json.MAPPER.createArrayNode();
                result.add(Json.object().put("text",text.strip()).put("appId",appId).put("appName",app.map(a->Json.string(a.publicData(),"name")).orElse("桌面")).put("id",UUID.randomUUID().toString()).put("createdAt",TIME.format(Instant.now())).put("read",false));
                for(int i=0;i<Math.min(99,items.size());i++) result.add(items.get(i)); items=result;
            } else if(method.equals("PATCH")) {
                if(!input.path("read").equals(BooleanNode.TRUE)) throw new ApiException(400,"通知状态无效");
                for(var item:items) if(id.isEmpty() || id.equals(Json.string(item,"id"))) ((ObjectNode)item).put("read",true);
            } else if(method.equals("DELETE")) {
                var result=Json.MAPPER.createArrayNode();
                if(!id.isEmpty()) for(var item:items) if(!id.equals(Json.string(item,"id"))) result.add(item);
                items=result;
            } else throw new ApiException(405,"不支持此请求方法");
            write("notifications",user,items); return items;
        }
    }
}
