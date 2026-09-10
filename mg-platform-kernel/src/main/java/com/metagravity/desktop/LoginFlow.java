package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import org.springframework.stereotype.Component;

@Component
public class LoginFlow {
    public static final String TOKEN_COOKIE="mg_desktop_token", FLOW_COOKIE="mg_desktop_flow";
    private final byte[] key;
    private static final SecureRandom RANDOM=new SecureRandom();
    public LoginFlow(Settings settings) throws java.io.IOException {
        String hex=settings.get("DESKTOP_FLOW_KEY","");
        if(!hex.isEmpty()) {
            if(!hex.matches("[a-fA-F0-9]{64}")) throw new IllegalStateException("桌面登录流程密钥格式无效");
            key=HexFormat.of().parseHex(hex);
        } else {
            if(settings.production()) throw new IllegalStateException("生产环境必须提供 DESKTOP_FLOW_KEY");
            Path file=settings.runtime().resolve("flow.key"); Files.createDirectories(file.getParent());
            if(!Files.exists(file)) {
                byte[] generated=new byte[32]; RANDOM.nextBytes(generated);
                try { PrivateFiles.create(file,generated); } catch(FileAlreadyExistsException ignored) {}
            }
            key=Files.readAllBytes(file);
        }
        if(key.length!=32) throw new IllegalStateException("桌面登录流程密钥无效");
    }
    public static String randomToken() { byte[] bytes=new byte[32]; RANDOM.nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    public static String sha256(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    public static String challenge(String verifier) { return Base64.getUrlEncoder().withoutPadding().encodeToString(HexFormat.of().parseHex(sha256(verifier))); }
    public String pack(Object value) {
        byte[] iv=new byte[12]; RANDOM.nextBytes(iv);
        try {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv)); cipher.updateAAD(FLOW_COOKIE.getBytes(StandardCharsets.UTF_8));
            byte[] ciphertext=cipher.doFinal(Json.bytes(value)); byte[] packed=Arrays.copyOf(iv,iv.length+ciphertext.length); System.arraycopy(ciphertext,0,packed,iv.length,ciphertext.length);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(packed);
        } catch(GeneralSecurityException e) { throw new IllegalStateException("登录流程加密失败",e); }
    }
    public JsonNode unpack(String value) {
        try {
            byte[] packed=Base64.getUrlDecoder().decode(value);
            if(packed.length<29 || packed.length>4096) throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,Arrays.copyOf(packed,12))); cipher.updateAAD(FLOW_COOKIE.getBytes(StandardCharsets.UTF_8));
            var result=Json.read(cipher.doFinal(packed,12,packed.length-12));
            if(result==null || !result.isObject()) throw new IllegalArgumentException();
            return result;
        } catch(GeneralSecurityException | IllegalArgumentException e) { throw new ApiException(401,"登录请求已失效，请重新登录"); }
    }
    public static String readCookie(String header,String name) {
        if(header==null) return "";
        var matches=Arrays.stream(header.split(";")).map(String::strip).filter(item->item.startsWith(name+"=")).toList();
        if(matches.size()!=1) return "";
        try { return Urls.decode(matches.getFirst().substring(name.length()+1)); } catch(RuntimeException e) { return ""; }
    }
    public static boolean equal(String a,String b) { return a!=null && b!=null && MessageDigest.isEqual(a.getBytes(StandardCharsets.UTF_8),b.getBytes(StandardCharsets.UTF_8)); }
}
