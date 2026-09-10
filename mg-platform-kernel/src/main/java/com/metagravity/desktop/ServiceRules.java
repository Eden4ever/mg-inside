package com.metagravity.desktop;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.*;
import java.util.*;
import java.util.regex.Pattern;

public final class ServiceRules {
    private static final Pattern ID=Pattern.compile("[a-z][a-z0-9-]{1,63}"),VERSION=Pattern.compile("\\d{1,4}\\.\\d{1,4}\\.\\d{1,4}"),OPERATION=Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,79}"),PATH=Pattern.compile("/(?:[A-Za-z0-9_-]+|\\{[A-Za-z][A-Za-z0-9]*})(?:/(?:[A-Za-z0-9_-]+|\\{[A-Za-z][A-Za-z0-9]*}))*"),SAFE_PATH=Pattern.compile("/[A-Za-z0-9/_-]*");
    private ServiceRules() {}
    static void fields(JsonNode value,Set<String> allowed,String message) {
        if(value==null || !value.isObject()) throw new ApiException(400,message);
        value.fieldNames().forEachRemaining(name->{if(!allowed.contains(name))throw new ApiException(400,message);});
    }
    public static ObjectNode manifest(JsonNode input,Set<String> appIds) {
        fields(input,Set.of("schemaVersion","serviceId","appId","name","version","description","operations","exposure"),"清单包含无效字段");
        if(input.has("exposure")&&!Set.of("gateway","catalog").contains(Json.string(input,"exposure")))throw new ApiException(400,"服务接入方式无效");
        boolean catalog=catalogOnly(input);
        String app=Json.string(input,"appId"),service=Json.string(input,"serviceId"),version=Json.string(input,"version"),name=Json.string(input,"name"),description=Json.string(input,"description");
        var operations=input.path("operations");
        if(input.path("schemaVersion").asInt()!=1 || !ID.matcher(app).matches() || !appIds.contains(app) || !service.startsWith(app+".") || !service.matches("[a-z0-9.-]{3,100}") || !VERSION.matcher(version).matches() || name.strip().isEmpty() || name.length()>100 || !input.path("description").isTextual() || description.length()>2000 || !operations.isArray() || operations.isEmpty() || operations.size()>200) throw new ApiException(400,"服务清单格式无效");
        var ids=new HashSet<String>();var routes=new HashSet<String>();var normalized=new ArrayList<ObjectNode>();
        for(var operation:operations) {
            fields(operation,Set.of("operationId","method","path","summary","effect"),"清单包含无效字段");
            String id=Json.string(operation,"operationId"),method=Json.string(operation,"method"),path=Json.string(operation,"path"),summary=Json.string(operation,"summary"),effect=Json.string(operation,"effect");
            boolean validRoute=catalog?Set.of("GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS","ANY","WS").contains(method)&&path.matches("/[A-Za-z0-9/_.{}*~-]*")&&!path.contains("..")&&!path.contains("//"):Set.of("GET","POST","PUT","PATCH","DELETE").contains(method)&&PATH.matcher(path).matches();
            if(!OPERATION.matcher(id).matches() || !ids.add(id) || !validRoute || path.length()>300 || summary.strip().isEmpty() || summary.length()>200 || !effect.equals(Set.of("GET","HEAD","OPTIONS").contains(method)?"read":"write")) throw new ApiException(400,"接口定义无效或操作 ID 重复");
            String route=method+" "+path.replaceAll("\\{[^}]+}","{}");if(!routes.add(route))throw new ApiException(400,"接口路径重复");
            normalized.add(Json.object().put("operationId",id).put("method",method).put("path",path).put("summary",summary).put("effect",effect));
        }
        if(!catalog)for(int i=0;i<normalized.size();i++)for(int j=i+1;j<normalized.size();j++)if(overlap(normalized.get(i),normalized.get(j)))throw new ApiException(400,"接口路径存在重叠，会导致调用匹配冲突");
        normalized.sort(Comparator.comparing(op->Json.string(op,"operationId")));
        var result=Json.object().put("schemaVersion",1).put("serviceId",service).put("appId",app).put("name",name.strip()).put("version",version).put("description",description);result.set("operations",Json.MAPPER.valueToTree(normalized));if(input.has("exposure"))result.put("exposure",Json.string(input,"exposure"));return result;
    }
    public static boolean catalogOnly(JsonNode manifest){return "catalog".equals(manifest.path("exposure").asText());}
    public static boolean overlap(JsonNode left,JsonNode right) {
        if(!Json.string(left,"method").equals(Json.string(right,"method")))return false;
        String[] a=Json.string(left,"path").split("/",-1),b=Json.string(right,"path").split("/",-1);if(a.length!=b.length)return false;
        for(int i=0;i<a.length;i++)if(!a[i].equals(b[i]) && !a[i].matches("\\{\\w+}") && !b[i].matches("\\{\\w+}"))return false;return true;
    }
    public static boolean matches(JsonNode operation,String method,String path) {
        if(!Json.string(operation,"method").equals(method.toUpperCase(Locale.ROOT)) || !SAFE_PATH.matcher(path).matches())return false;
        String pattern=Arrays.stream(Json.string(operation,"path").split("/",-1)).map(part->part.matches("\\{[A-Za-z][A-Za-z0-9]*}")?"[A-Za-z0-9_-]+":Pattern.quote(part)).reduce((a,b)->a+"/"+b).orElse("");return path.matches("^"+pattern+"$");
    }
    public static String path(JsonNode operation,Map<String,String> params) {
        var matcher=Pattern.compile("\\{([A-Za-z][A-Za-z0-9]*)}").matcher(Json.string(operation,"path"));var output=new StringBuilder();
        while(matcher.find()) {String value=params.get(matcher.group(1));if(value==null || !value.matches("[A-Za-z0-9_-]+"))throw new ApiException(400,"路径参数无效");matcher.appendReplacement(output,MatcherQuote.quote(value));}matcher.appendTail(output);return output.toString();
    }
    public static boolean validDate(String value) {
        try{return value!=null && value.matches("\\d{4}-\\d{2}-\\d{2}") && LocalDate.parse(value).toString().equals(value);}catch(DateTimeException e){return false;}
    }
    private static final class MatcherQuote { static String quote(String value){return java.util.regex.Matcher.quoteReplacement(value);} }
}
