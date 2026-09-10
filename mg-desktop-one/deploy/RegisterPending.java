public final class RegisterPending {
 public static void main(String[] args) throws Exception {
  var settings=Class.forName("com.metagravity.desktop.Settings").getConstructor().newInstance();
  var url=(String)settings.getClass().getMethod("get",String.class,String.class).invoke(settings,"SERVICE_DATABASE_URL","");
  var storage=Class.forName("com.metagravity.desktop.DesktopApplicationCatalogStorage").getConstructor(String.class).newInstance(url);
  var read=Class.forName("com.metagravity.desktop.Json").getMethod("read",byte[].class);
  for(String pair:new String[]{"desktop-one|统一桌面","document-one|Document One"}) {
   var p=pair.split("\\|",2);
   String input="{\"id\":\""+p[0]+"\",\"name\":\""+p[1]+"\",\"description\":\"\",\"developer\":\"郑州元引信息科技有限公司\"}";
   var n=read.invoke(null,(Object)input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
   storage.getClass().getMethod("register",Class.forName("com.fasterxml.jackson.databind.JsonNode"),String.class).invoke(storage,n,"production-migration");
  }
  ((AutoCloseable)storage).close(); System.out.println("pending applications registered");
 }
}
