import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {ResourceStore,ResourceError} from './store.ts';
import {UnifiedIdentityClient,UnifiedAuthError,bearerToken} from './unified-client.ts';
export function createResourceServer(store:ResourceStore,identity:Pick<UnifiedIdentityClient,'introspect'>=new UnifiedIdentityClient()){
 return createServer(async(req,res)=>{const send=(data:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{const path=new URL(req.url||'/','http://localhost').pathname;if(path==='/health'&&req.method==='GET')return send({ok:true});if(!path.startsWith('/api/'))throw new ResourceError(404,'接口不存在');const user=await identity.introspect(bearerToken(req.headers.authorization),'resource-manager');
 if(!['GET','HEAD'].includes(req.method||'')){const a=Buffer.from(String(req.headers['x-csrf-token']||'')),b=Buffer.from(user.csrfToken);if(a.length!==b.length||!timingSafeEqual(a,b))throw new ResourceError(403,'安全校验失败，请刷新后重试')}
 if(path==='/api/overview'&&req.method==='GET')return send(store.overview());
 const refresh=/^\/api\/resources\/([0-9a-f-]{36})\/refresh$/.exec(path);
 if(refresh&&req.method==='POST'){await store.refresh(refresh[1],user.sub);return send(store.overview())}
 const metadata=/^\/api\/resources\/([0-9a-f-]{36})\/metadata$/.exec(path);
 if(metadata&&req.method==='POST'){let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192)throw new ResourceError(413,'请求过大')}let input;try{input=JSON.parse(body)}catch{throw new ResourceError(400,'请求格式无效')}await store.update(metadata[1],input,user.sub);return send(store.overview())}
 throw new ResourceError(404,'接口不存在');
 }catch(e){const known=e instanceof ResourceError||e instanceof UnifiedAuthError;send({message:known?e.message:'资源服务暂时不可用'},known?e.status:500)}})
}
