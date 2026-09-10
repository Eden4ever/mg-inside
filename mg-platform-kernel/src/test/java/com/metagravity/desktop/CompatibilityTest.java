package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class CompatibilityTest {
    @TempDir Path temporary;
    private Settings settings() { return new Settings(Map.of("DESKTOP_RUNTIME_DIR",temporary.toString(),"DESKTOP_FLOW_KEY","12".repeat(32))); }
    private AppCatalog catalog() {
        var presentation=Json.object().put("name","测试桌面");var apps=Json.object();
        for(String id:List.of("service-manager","resource-manager","low-alt-cockpit","office-one","files","personal-center","app-manager","expert-database","token-one","token-one-console","token-one-docs","identity")) apps.set(id,Json.object().put("name",id).put("description","测试应用"));
        presentation.set("applications",apps);return new AppCatalog(settings(),presentation,ApplicationFixtures.rows());
    }
    @Test void readsNodeAesGcmCookieAndRejectsTampering() throws Exception {
        var flow=new LoginFlow(settings());
        // Node crypto 的固定向量：12 字节 IV + 密文 + 16 字节 tag，AAD 为原 Cookie 名。
        String packed="AQIDBAUGBwgJCgsMdZSirff5kQGmWkhi5Lrr-J2pNSdtLbsv9qpS9cF75xNLLHw861FlVgEqur6EeBfGQ2dsq04bxCJysMxppvD9O6i0gs_Xkg00MKJX7vFGzxkFsgxiPX1oVqTr5wzay_y1rfq-ePhE8eUgqfoJOU6VYTRRwFHV5PAvdAqOcbNamI2xrGjuVsjKCpMLo2SHxHj9_1Q";
        var value=flow.unpack(packed);assertEquals("legacy-verifier",value.path("verifier").asText());assertEquals(1788929321000L,value.path("issued").longValue());
        var bytes=Base64.getUrlDecoder().decode(packed);bytes[20]^=1;
        assertEquals(401,assertThrows(ApiException.class,()->flow.unpack(Base64.getUrlEncoder().withoutPadding().encodeToString(bytes))).status());
        assertEquals("",LoginFlow.readCookie("mg_desktop_token=a; mg_desktop_token=b",LoginFlow.TOKEN_COOKIE));
    }
    @Test void preservesExistingUserFilesAndConcurrentWrites() throws Exception {
        Path notifications=temporary.resolve("notifications");Files.createDirectories(notifications);
        Files.writeString(notifications.resolve(LoginFlow.sha256("alice")+".json"),"[{\"id\":\"legacy\",\"text\":\"旧通知\",\"read\":false}]");
        var store=new UserState(settings(),catalog());assertEquals("legacy",store.notifications("alice").get(0).path("id").asText());assertTrue(store.notifications("bob").isEmpty());
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            var jobs=new ArrayList<Future<?>>();
            for(int i=0;i<24;i++) {final int index=i;jobs.add(executor.submit(()->store.changeNotification("alice","POST",Json.object().put("text","通知 "+index))));}
            for(var job:jobs)job.get();
        }
        var reopened=new UserState(settings(),catalog());assertEquals(25,reopened.notifications("alice").size());
        reopened.changeNotification("alice","PATCH",Json.object().put("id","legacy").put("read",true));
        assertTrue(reopened.notifications("alice").get(24).path("read").booleanValue());
        try(var files=Files.list(notifications)) { assertEquals(1,files.filter(path->path.toString().endsWith(".json")).count()); }
    }
    @Test void externalApplicationsCannotMutateOtherAccountsOrImpersonatePlatform() {
        var store=new UserState(settings(),catalog());
        var saved=store.saveApplication("alice",Json.object().put("name","文档").put("url","https://docs.example.org/a?q=b#intro"),null);
        assertEquals("https://docs.example.org/a?q=b#intro",saved.path("entryUrl").textValue());
        assertEquals(404,assertThrows(ApiException.class,()->store.removeApplication("bob",saved.path("id").textValue())).status());
        for(String url:List.of("https://127.0.0.1:8888/","https://a.127.0.0.1/","https://user:pass@example.org/","javascript:alert(1)")) assertThrows(ApiException.class,()->store.saveApplication("alice",Json.object().put("name","错误地址").put("url",url),null));
    }
    @Test void returnPathsAndProxyTargetsCannotEscapeTheirBoundary() {
        for(String path:List.of("//evil.invalid/","/a/../b","/%2e%2e/a","/a\\b","/a\r\nb")) assertEquals("/fallback",Urls.safeAppPath(path,"/fallback"));
        assertEquals("/my-files?view=list",Urls.safeAppPath("/my-files?token=secret&view=list#fragment","/"));
        for(String path:List.of("/../../admin","/%2e%2e/admin","/a/%2f../admin","/a%5cb")) assertThrows(ApiException.class,()->ApplicationGateway.target("https://provider.invalid/api",path,null));
        assertEquals("https://provider.invalid/api/files?q=x",ApplicationGateway.target("https://provider.invalid/api","/files","q=x").toString());
    }
    @Test void platformMetadataDoesNotGrantIdentityAdministrativeRights() {
        var catalog=catalog();assertEquals(Set.of("files","personal-center"),new HashSet<>(catalog.all().stream().filter(AppCatalog.App::isDefault).map(AppCatalog.App::id).toList()));
        var identity=catalog.find("identity").orElseThrow();assertEquals("system_admin",identity.requiredRole());
        assertFalse(catalog.find("personal-center").orElseThrow().allowsApi("/admin/users"));
        assertTrue(catalog.find("personal-center").orElseThrow().allowsApi("/auth/me"));
        assertFalse(identity.publicData().has("upstream"));assertFalse(identity.publicData().has("requiredRole"));
    }
    @Test void serviceManifestDigestMatchesNodeJsonStringifyProtocol() {
        var manifest=Json.object().put("schemaVersion",1).put("serviceId","files.api").put("appId","files").put("name","文件").put("version","1.0.0").put("description","测试");
        manifest.set("operations",Json.MAPPER.createArrayNode().add(Json.object().put("operationId","list").put("method","GET").put("path","/entries").put("summary","查询").put("effect","read")));
        assertEquals("709e26149f8ea994e7b789a96441fbfb3007edcc6a69ca93e5b44419bff365eb",CanonicalJson.manifestDigest(manifest));
    }
}
