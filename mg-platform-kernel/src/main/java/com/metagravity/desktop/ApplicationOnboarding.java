package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.*;
import java.net.URI;
import java.sql.*;
import java.security.MessageDigest;
import java.util.*;
import javax.imageio.ImageIO;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

@Component
public final class ApplicationOnboarding {
    private final DesktopApplicationCatalogStorage storage;
    private final Settings settings;
    private final AppCatalog catalog;
    private final IdentityClient identity;
    public ApplicationOnboarding(Settings settings,AppCatalog catalog,IdentityClient identity) {
        this.settings=settings;this.catalog=catalog;this.identity=identity;
        storage=new DesktopApplicationCatalogStorage(settings.get("SERVICE_DATABASE_URL",""));
    }
    @PreDestroy public void close(){storage.close();}

    static byte[] icon(JsonNode value) {
        if(value.isMissingNode() || value.isNull() || value.asText().isEmpty())return null;
        try {
            String raw=value.textValue();
            if(raw==null || raw.length()>400000 || !raw.startsWith("data:image/png;base64,"))throw new IOException();
            byte[] bytes=Base64.getDecoder().decode(raw.substring(22));
            try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(stream);if(!readers.hasNext())throw new IOException();
                var reader=readers.next();
                try {reader.setInput(stream);if(!reader.getFormatName().equalsIgnoreCase("png") || reader.getWidth(0)>512 || reader.getHeight(0)>512 || reader.getWidth(0)<16 || reader.getHeight(0)<16)throw new IOException();
                    var image=reader.read(0);var clean=new ByteArrayOutputStream();ImageIO.write(image,"png",clean);return clean.toByteArray();
                } finally {reader.dispose();}
            }
        } catch(Exception e){throw new ApiException(400,"图标必须是 16 至 512 像素且小于 290KB 的 PNG 图片");}
    }
    static String iconId(byte[] bytes) {
        try{return "upload-"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).substring(0,56);}
        catch(Exception e){throw new IllegalStateException(e);}
    }
    JsonNode runtime(String id) {
        try(var c=storage.connection();var s=c.prepareStatement("SELECT entry_url,upstream_url,default_path,allowed_paths,allowed_api_paths,icon,kind,authorization_app_id,required_role,min_width,min_height,default_maximized,runtime_policy,revision FROM desktop_applications WHERE id=?")) {
            s.setString(1,id);try(var r=s.executeQuery()){if(!r.next())throw new ApiException(404,"应用不存在");
                var result=Json.object().put("entryUrl",r.getString(1)).put("upstream",r.getString(2)).put("defaultPath",r.getString(3)).put("icon",r.getString(6)).put("kind",r.getString(7)).put("authorizationAppId",r.getString(8)).put("requiredRole",r.getString(9)).put("minWidth",r.getInt(10)).put("minHeight",r.getInt(11)).put("defaultMaximized",r.getBoolean(12)).put("expectedRevision",r.getInt(14));
                result.set("allowedPaths",Json.read(r.getString(4)));result.set("allowedApiPaths",r.getString(5)==null?Json.MAPPER.nullNode():Json.read(r.getString(5)));result.set("runtimePolicy",Json.read(r.getString(13)));return result;
            }
        }catch(SQLException e){throw new ApiException(503,"应用配置读取失败");}
    }
    private AppCatalog.App validate(JsonNode input,byte[] image) {
        String id=Json.string(input.path("metadata"),"id"),requestId=Json.string(input,"requestId");
        if(!requestId.matches("[a-f0-9-]{36}") || !id.matches("[a-z][a-z0-9-]{1,63}"))throw new ApiException(400,"注册标识无效");
        var metadata=(ObjectNode)input.path("metadata").deepCopy();
        var allowed=Set.of("id","name","description","developer","registeredVersion");
        metadata.fieldNames().forEachRemaining(k->{if(!allowed.contains(k)||!metadata.path(k).isTextual())throw new ApiException(400,"应用资料无效");});
        if(Json.string(metadata,"developer").length()>120 || Json.string(metadata,"registeredVersion").length()>64)throw new ApiException(400,"开发者或版本过长");
        if(!input.path("runtime").isObject())throw new ApiException(400,"应用入口配置无效");
        var runtime=(ObjectNode)input.path("runtime").deepCopy();
        runtime.put("id",id).put("name",Json.string(metadata,"name")).put("description",Json.string(metadata,"description")).put("kind","internal").put("authorizationAppId",id);
        runtime.put("icon",image==null?"knowledge":iconId(image));
        var document=Json.object().put("schemaVersion",1);document.putArray("applications").add(runtime);
        AppCatalog.App app;
        try{app=DesktopApplicationCatalogAdmin.parse(document,settings).getFirst();}catch(RuntimeException e){throw new ApiException(400,"应用入口、路径或窗口配置无效");}
        if(!"registered".equals(app.policy().apiMode()))throw new ApiException(400,"新应用必须采用已登记 API 模式");
        var uris=input.path("redirectUris");
        if(!uris.isArray()||uris.isEmpty()||uris.size()>8)throw new ApiException(400,"需要 1 至 8 个回调地址");
        var unique=new HashSet<String>();
        for(var item:uris) {
            try{String text=item.textValue();var url=URI.create(text);boolean local=!settings.production()&&"http".equals(url.getScheme())&&Set.of("127.0.0.1","localhost").contains(url.getHost());
                if(text.length()>2048||text.contains("*")||url.getHost()==null||url.getRawUserInfo()!=null||url.getRawFragment()!=null||!unique.add(text)||!("https".equals(url.getScheme())||local))throw new IllegalArgumentException();
            }catch(Exception e){throw new ApiException(400,"回调必须为精确 HTTPS 地址");}
        }
        return app;
    }
    public JsonNode register(JsonNode input,IdentityClient.Session session) {
        if(!input.isObject()||!input.path("metadata").isObject())throw new ApiException(400,"注册内容无效");
        byte[] image=icon(input.path("iconData"));var app=validate(input,image);
        String id=app.id(),actor=Json.string(session.profile(),"sub");
        prepare(input,app,image,actor);
        return finish(id,session);
    }
    private void prepare(JsonNode input,AppCatalog.App app,byte[] image,String actor) {
        try(var c=storage.connection()) {
            c.setAutoCommit(false);
            try {
                try(var s=c.prepareStatement("SELECT pg_advisory_xact_lock(hashtext(?))")){s.setString(1,app.id());s.execute();}
                try(var s=c.prepareStatement("SELECT config,actor FROM desktop_application_onboarding WHERE application_id=?")){
                    s.setString(1,app.id());try(var r=s.executeQuery()){if(r.next()){
                        if(!actor.equals(r.getString(2))||!input.equals(Json.read(r.getString(1))))throw new ApiException(409,"此应用已登记，请打开接入配置继续处理");c.commit();return;
                    }}
                }
                var d=app.publicData();
                try(var s=c.prepareStatement("INSERT INTO desktop_applications(id,name,description,developer,registered_version,entry_url,upstream_url,default_path,allowed_paths,allowed_api_paths,icon,kind,authorization_app_id,min_width,min_height,default_maximized,runtime_policy,enabled,runtime_ready) VALUES(?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,'internal',?,?,?,?,?::jsonb,false,false)")){
                    s.setString(1,app.id());s.setString(2,Json.string(d,"name"));s.setString(3,Json.string(d,"description"));s.setString(4,Json.string(input.path("metadata"),"developer"));s.setString(5,Json.string(input.path("metadata"),"registeredVersion"));s.setString(6,app.entryUrl());s.setString(7,app.upstream());s.setString(8,Json.string(d,"defaultPath"));s.setString(9,d.path("allowedPaths").toString());s.setString(10,Json.text(app.allowedApiPaths()));s.setString(11,Json.string(d,"icon"));s.setString(12,app.id());s.setInt(13,d.path("minWidth").asInt());s.setInt(14,d.path("minHeight").asInt());s.setBoolean(15,d.path("defaultMaximized").asBoolean());s.setString(16,Json.text(app.policy()));s.executeUpdate();
                }
                if(image!=null)try(var s=c.prepareStatement("INSERT INTO desktop_application_icons(id,content) VALUES(?,?) ON CONFLICT DO NOTHING")){s.setString(1,iconId(image));s.setBytes(2,image);s.executeUpdate();}
                try(var s=c.prepareStatement("INSERT INTO desktop_application_onboarding(application_id,request_id,actor,config) VALUES(?,?,?,?::jsonb)")){s.setString(1,app.id());s.setString(2,Json.string(input,"requestId"));s.setString(3,actor);s.setString(4,input.toString());s.executeUpdate();}
                audit(c,app.id(),actor,"create");c.commit();
            }catch(RuntimeException|SQLException e){c.rollback();throw e;}
        }catch(SQLException e){throw new ApiException("23505".equals(e.getSQLState())?409:503,"应用标识或注册请求已存在，或注册数据库不可用");}
    }
    private void audit(Connection c,String id,String actor,String action)throws SQLException {
        try(var s=c.prepareStatement("INSERT INTO desktop_application_audit(application_id,action,after_config,actor) SELECT id,?,to_jsonb(a),? FROM desktop_applications a WHERE id=?")){s.setString(1,action);s.setString(2,actor);s.setString(3,id);s.executeUpdate();}
    }
    public JsonNode status(String id) {
        var result=Json.object().put("state","existing").put("issuer",settings.identityOrigin());
        try(var c=storage.connection();var s=c.prepareStatement("SELECT state FROM desktop_application_onboarding WHERE application_id=?")){s.setString(1,id);try(var r=s.executeQuery()){if(r.next())result.put("state",r.getString(1));}}
        catch(SQLException e){throw new ApiException(503,"注册状态读取失败");}
        result.set("application",catalog.directoryItem(id));result.set("runtime",runtime(id));return result;
    }
    public JsonNode finish(String id,IdentityClient.Session session) {
        JsonNode config;String state,actor;
        try(var c=storage.connection();var s=c.prepareStatement("SELECT config,state,actor FROM desktop_application_onboarding WHERE application_id=?")){s.setString(1,id);try(var r=s.executeQuery()){if(!r.next())throw new ApiException(404,"注册任务不存在");config=Json.read(r.getString(1));state=r.getString(2);actor=r.getString(3);}}
        catch(SQLException e){throw new ApiException(503,"注册任务读取失败");}
        if(!actor.equals(Json.string(session.profile(),"sub")))throw new ApiException(403,"请由原注册管理员继续完成接入");
        if("active".equals(state))return status(id);
        try {
            var request=Json.object().put("action","create").put("clientId",id).put("requestId",Json.string(config,"requestId"));request.set("redirectUris",config.path("redirectUris"));
            var credentials=identity.manageClient(session.token(),Json.string(session.profile(),"csrfToken"),request);
            try(var c=storage.connection()) {
                c.setAutoCommit(false);
                try {
                    try(var s=c.prepareStatement("SELECT state FROM desktop_application_onboarding WHERE application_id=? FOR UPDATE")){s.setString(1,id);s.executeQuery().close();}
                    try(var s=c.prepareStatement("UPDATE desktop_applications SET enabled=true,runtime_ready=true,revision=revision+1,updated_at=now() WHERE id=? AND runtime_ready=false")){s.setString(1,id);s.executeUpdate();}
                    try(var s=c.prepareStatement("UPDATE desktop_application_onboarding SET state='active',updated_at=now() WHERE application_id=?")){s.setString(1,id);s.executeUpdate();}
                    audit(c,id,actor,"enable");c.commit();
                }catch(Exception e){c.rollback();throw e;}
            }
            var result=(ObjectNode)status(id);result.set("credentials",credentials);result.put("issuer",settings.identityOrigin());return result;
        } catch(Exception e) {
            try(var c=storage.connection();var s=c.prepareStatement("UPDATE desktop_application_onboarding SET state='failed',updated_at=now() WHERE application_id=? AND state<>'active'")){s.setString(1,id);s.executeUpdate();}catch(SQLException ignored){}
            if(e instanceof ApiException api)throw api;
            throw new ApiException(503,"接入未完成，应用保持关闭，请重试原注册任务");
        }
    }
    public byte[] readIcon(String key) {
        if(!key.matches("upload-[a-f0-9]{56}"))throw new ApiException(404,"图标不存在");
        try(var c=storage.connection();var s=c.prepareStatement("SELECT content FROM desktop_application_icons WHERE id=?")){s.setString(1,key);try(var r=s.executeQuery()){if(!r.next())throw new ApiException(404,"图标不存在");return r.getBytes(1);}}
        catch(SQLException e){throw new ApiException(503,"图标读取失败");}
    }
}
