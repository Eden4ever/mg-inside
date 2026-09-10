package com.metagravity.desktop;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class UserWallpaperTest {
    @TempDir Path temporary;
    private Settings settings() { return new Settings(Map.of("DESKTOP_RUNTIME_DIR",temporary.toString(),"DESKTOP_FLOW_KEY","12".repeat(32))); }
    private UserState store() {
        var presentation=Json.object().put("name","测试桌面");var apps=Json.object();
        for(String id:List.of("service-manager","resource-manager","low-alt-cockpit","office-one","files","personal-center","app-manager","expert-database","token-one","token-one-console","token-one-docs","identity")) apps.set(id,Json.object().put("name",id).put("description","测试应用"));
        return new UserState(settings(),new AppCatalog(settings(),presentation,ApplicationFixtures.rows()));
    }
    private static byte[] jpeg(int size) {
        byte[] bytes=new byte[size];bytes[0]=(byte)0xff;bytes[1]=(byte)0xd8;bytes[2]=(byte)0xff;return bytes;
    }
    @Test void storesOneWallpaperPerUserAndSwitchesPreference() {
        var store=store();
        assertTrue(store.wallpaper("alice").isEmpty());
        var info=store.saveWallpaper("alice",jpeg(2048));
        assertEquals("image/jpeg",Json.string(info,"type"));assertEquals(2048,info.path("size").intValue());
        String version=Json.string(info,"version");assertEquals(32,version.length());
        var stored=store.wallpaper("alice").orElseThrow();
        assertEquals(2048,stored.bytes().length);assertEquals("image/jpeg",stored.type());assertEquals(version,stored.version());
        // 上传后立即生效，并把版本号一并写进偏好供前端拼缓存地址。
        assertEquals("custom",Json.string(store.preferences("alice"),"wallpaper"));
        assertEquals(version,Json.string(store.preferences("alice"),"wallpaperVersion"));
        assertTrue(store.wallpaper("bob").isEmpty());
        // 换图只保留最后一张，版本号随之变化。
        String next=Json.string(store.saveWallpaper("alice",jpeg(4096)),"version");
        assertNotEquals(version,next);assertEquals(4096,store.wallpaper("alice").orElseThrow().bytes().length);
    }
    @Test void rejectsUnsupportedAndOversizedImages() {
        var store=store();
        assertEquals(415,assertThrows(ApiException.class,()->store.saveWallpaper("alice","not-an-image".getBytes())).status());
        assertEquals(413,assertThrows(ApiException.class,()->store.saveWallpaper("alice",jpeg(UserState.WALLPAPER_LIMIT+1))).status());
        assertEquals(400,assertThrows(ApiException.class,()->store.saveWallpaper("alice",new byte[0])).status());
        assertTrue(store.wallpaper("alice").isEmpty());
    }
    @Test void fallsBackToDefaultWithoutStoredImage() {
        var store=store();
        // 没有壁纸文件时不接受 custom，避免桌面拿到空背景。
        assertEquals("dawn",Json.string(store.savePreferences("alice",Json.object().put("wallpaper","custom")),"wallpaper"));
        store.saveWallpaper("alice",jpeg(1024));
        assertEquals("custom",Json.string(store.savePreferences("alice",Json.object().put("wallpaper","custom")),"wallpaper"));
        store.removeWallpaper("alice");
        assertTrue(store.wallpaper("alice").isEmpty());
        assertEquals("dawn",Json.string(store.preferences("alice"),"wallpaper"));
        assertEquals("",Json.string(store.preferences("alice"),"wallpaperVersion"));
    }
}
