export class ApplicationRequestError extends Error {
  constructor(message: string, public status: number, public requestId?: string) { super(message); this.name='ApplicationRequestError'; }
}
export function serviceRequestUrl(origin: string, appId: string, path: string, method='GET') {
  if(!/^[a-z][a-z0-9-]{1,63}$/.test(appId)||!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method.toUpperCase()))throw new Error('应用请求配置无效');
  if(!/^\/[A-Za-z0-9/_-]*(?:\?[^#\r\n]*)?$/.test(path))throw new Error('应用请求路径无效');
  // 服务端根据当前注册库解析；前端不携带决定路由的服务目录快照。
  return `${new URL(origin).origin}/api/apps/${appId}${path}`;
}
export function serviceInvocationUrl(origin:string,serviceId:string,operationId:string,params:Record<string,string>={},query:Record<string,string>={}) {
  if(!/^[a-z0-9.-]+$/.test(serviceId)||!/^[A-Za-z0-9_-]+$/.test(operationId))throw new Error('服务标识无效');
  const search=new URLSearchParams();for(const [key,value] of Object.entries(query)){if(key.startsWith('path.'))throw new Error('查询参数使用了保留名称');search.set(key,value)}
  for(const [key,value] of Object.entries(params))search.set('path.'+key,value);
  return `${new URL(origin).origin}/api/services/invoke/${serviceId}/${operationId}${search.size?'?'+search.toString():''}`;
}
export function createApplicationClient(options:{origin:string;appId:string;session:{csrf():Promise<string>;clear():void};onExpired:()=>void;beginRequest?:()=>()=>void;basePath?:string;timeoutMs?:number}) {
  const origin=new URL(options.origin).origin;
  if(!/^[a-z0-9-]+$/.test(options.appId)||options.basePath&&!/^\/api\/[a-z0-9/-]+$/.test(options.basePath))throw new Error('应用客户端配置无效');
  let expired=false;
  async function send(url:string,init:RequestInit={},readJson=false) {
    const method=(init.method||'GET').toUpperCase(),mutation=!['GET','HEAD'].includes(method),headers=new Headers(init.headers);
    if(mutation)headers.set('X-CSRF-Token',await options.session.csrf());
    if(typeof init.body==='string'&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
    const done=mutation?options.beginRequest?.():undefined;
    try {
      const response=await fetch(url,{...init,method,headers,credentials:'include',redirect:'error',cache:'no-store',signal:init.signal||AbortSignal.timeout(options.timeoutMs||30000)});
      if(!response.ok){
        if(response.status===401&&!expired){expired=true;options.session.clear();options.onExpired()}
        const body=await response.json().catch(()=>({}));throw new ApplicationRequestError(typeof body.message==='string'?body.message:`服务请求失败（${response.status}）`,response.status,response.headers.get('X-Request-Id')||undefined);
      }
      expired=false;return readJson ? await response.json() : response;
    }finally{done?.()}
  }
  function requestUrl(path:string,init:RequestInit={}) {
    // 固定 API 根路径允许仅附加查询参数，仍不能替换目标路径或来源。
    const rootQuery=!!options.basePath&&/^\?[^#\r\n]*$/.test(path);
    if(!/^\/[A-Za-z0-9/_-]*(?:\?[^#\r\n]*)?$/.test(path)&&path!==''&&!rootQuery)throw new Error('应用请求路径无效');
    const url=options.basePath?origin+options.basePath+path:serviceRequestUrl(origin,options.appId,path,init.method);
    return url;
  }
  return {response(path:string,init:RequestInit={}):Promise<Response>{return send(requestUrl(path,init),init)},async request<T>(path:string,init:RequestInit={}):Promise<T>{return send(requestUrl(path,init),init,true)},
    async invoke<T>(serviceId:string,operationId:string,init:RequestInit={},params:Record<string,string>={},query:Record<string,string>={}):Promise<T>{return send(serviceInvocationUrl(origin,serviceId,operationId,params,query),init,true)}};
}
