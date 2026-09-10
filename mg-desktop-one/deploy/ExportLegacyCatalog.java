import java.util.*;

/** 从当前发布包导出运行目录，不读取或输出服务凭据。 */
public class ExportLegacyCatalog {
    public static void main(String[] args) throws Exception {
        Class<?> settingsType=Class.forName("com.metagravity.desktop.Settings");
        Object settings=settingsType.getConstructor().newInstance();
        Class<?> catalogType=Class.forName("com.metagravity.desktop.AppCatalog");
        Object catalog=catalogType.getConstructor(settingsType).newInstance(settings);
        Object mapper=Class.forName("com.metagravity.desktop.Json").getField("MAPPER").get(null);
        var convert=mapper.getClass().getMethod("convertValue",Object.class,Class.class);
        var applications=new ArrayList<Map<String,Object>>();
        try {
            for(Object app:(List<?>)catalogType.getMethod("all").invoke(catalog)) {
                Class<?> type=app.getClass();
                Map<?,?> visible=(Map<?,?>)convert.invoke(mapper,type.getMethod("publicData").invoke(app),Map.class);
                var entry=new LinkedHashMap<String,Object>();
                for(String key:List.of("id","name","description","entryUrl","defaultPath","allowedPaths","icon","kind","minWidth","minHeight"))entry.put(key,visible.get(key));
                entry.put("defaultMaximized",Boolean.TRUE.equals(visible.get("defaultMaximized")));
                for(String key:List.of("upstream","authorizationAppId","allowedApiPaths","requiredRole"))entry.put(key,type.getMethod(key).invoke(app));
                try{entry.put("runtimePolicy",convert.invoke(mapper,type.getMethod("policy").invoke(app),Map.class));}catch(NoSuchMethodException ignored){}
                applications.add(entry);
            }
            System.out.println(Class.forName("com.metagravity.desktop.Json").getMethod("text",Object.class).invoke(null,Map.of("schemaVersion",1,"applications",applications)));
        }finally{if(catalog instanceof AutoCloseable resource)resource.close();}
    }
}
