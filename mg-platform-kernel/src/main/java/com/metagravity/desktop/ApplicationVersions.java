package com.metagravity.desktop;

import java.net.URI;
import java.net.http.*;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

@Component
public class ApplicationVersions {
    private record Version(long at,String appId,String version) {}
    private final ConcurrentHashMap<String,Version> cache=new ConcurrentHashMap<>();
    private final HttpClient http=HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofMillis(2500)).followRedirects(HttpClient.Redirect.NEVER).build();
    public String version(AppCatalog.App app) {
        var value=cache.compute(app.entryUrl(),(url,current)->current!=null && System.currentTimeMillis()-current.at()<15000?current:read(url));
        return app.policy().versionOwnerAppId().equals(value.appId())?value.version():null;
    }
    private Version read(String url) {
        long now=System.currentTimeMillis();
        try {
            var response=http.send(HttpRequest.newBuilder(URI.create(url.replaceAll("/$","")+"/version.json")).timeout(Duration.ofMillis(2500)).GET().build(),HttpResponse.BodyHandlers.ofByteArray());
            if(response.statusCode()>=200 && response.statusCode()<300 && response.body().length<=4096) {
                var data=Json.read(response.body());
                if(data.path("schemaVersion").asInt()==1 && data.path("appId").isTextual() && Json.string(data,"version").matches("\\d{8}T\\d{6}Z")) return new Version(now,data.path("appId").textValue(),data.path("version").textValue());
            }
        } catch(InterruptedException e) { Thread.currentThread().interrupt(); }
        catch(Exception ignored) {}
        return new Version(now,null,null);
    }
}
