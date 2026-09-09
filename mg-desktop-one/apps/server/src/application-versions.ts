/** 仅读取平台登记应用的公开构建元数据，不请求个人外链或携带用户凭据。 */
export function createApplicationVersionReader(fetcher:typeof fetch=fetch){
 const cache=new Map<string,{at:number;value:Promise<{appId:string;version:string}|null>}>();
 async function read(entryUrl:string){
  try{
   const response=await fetcher(entryUrl.replace(/\/$/,'')+'/version.json',{signal:AbortSignal.timeout(2500),redirect:'error',credentials:'omit'});
   if(!response.ok||!response.body)return null;
   const reader=response.body.getReader();let content='',size=0;const decoder=new TextDecoder();
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return null;}content+=decoder.decode(value,{stream:true});}content+=decoder.decode();}finally{reader.releaseLock();}
   const data=JSON.parse(content);
   if(data.schemaVersion!==1||typeof data.appId!=='string'||typeof data.version!=='string'||!/^\d{8}T\d{6}Z$/.test(data.version))return null;
   return {appId:data.appId,version:data.version};
  }catch{return null;}
 }
 return async(app:{id:string;entryUrl:string})=>{
  let cached=cache.get(app.entryUrl);if(!cached||Date.now()-cached.at>15000){cached={at:Date.now(),value:read(app.entryUrl)};cache.set(app.entryUrl,cached);}
  const result=await cached.value,owner=['token-one-console','token-one-docs'].includes(app.id)?'token-one':app.id;
  return result?.appId===owner?result.version:null;
 };
}
