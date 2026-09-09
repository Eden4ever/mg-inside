import {afterEach,describe,expect,it,vi} from 'vitest';
import {createApplicationClient,serviceRequestUrl,serviceInvocationUrl} from '../../../../mg-platform/packages/frontend/services/client';
afterEach(()=>vi.unstubAllGlobals());
describe('公共服务客户端',()=>{
  it('固定 API 根路径支持环境查询，不能借查询切换请求来源',async()=>{
    const fetch=vi.fn().mockImplementation(async()=>new Response('{"items":[]}'));vi.stubGlobal('fetch',fetch);
    const options={origin:'https://desktop.example',appId:'service-manager',session:{csrf:async()=>'',clear(){}},onExpired(){}};
    const client=createApplicationClient({...options,basePath:'/api/service-registry'});
    await client.request('?environment=production');
    expect(fetch.mock.calls[0][0]).toBe('https://desktop.example/api/service-registry?environment=production');
    await expect(client.request('?environment=production#fragment')).rejects.toThrow('路径无效');
    await expect(client.request('https://other.example')).rejects.toThrow('路径无效');
    await expect(createApplicationClient(options).request('?environment=testing')).rejects.toThrow('路径无效');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('写请求等待完整正文后才解除忙碌状态',async()=>{
    const done=vi.fn();let deliver:(value:unknown)=>void=()=>{};
    const body=new Promise(resolve=>{deliver=resolve});
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:()=>body}));
    const client=createApplicationClient({origin:'https://desktop.example',appId:'resource-manager',session:{csrf:async()=>'csrf',clear(){}},onExpired(){},beginRequest:()=>done});
    const result=client.request('/resources/server1/metadata',{method:'POST',body:'{}'});
    await Promise.resolve();await Promise.resolve();await Promise.resolve();expect(done).not.toHaveBeenCalled();
    deliver({ok:true});await result;expect(done).toHaveBeenCalledTimes(1);
  });
  it('已登记操作走统一出口，未登记操作保留旧代理',()=>{
    expect(serviceRequestUrl('https://desktop.example','resource-manager','/overview')).toBe('https://desktop.example/api/services/apps/resource-manager/overview');
    expect(serviceRequestUrl('https://desktop.example','files','/entries?page=2')).toContain('/api/services/apps/files/entries?page=2');
    expect(serviceRequestUrl('https://desktop.example','token-one','/portal/models')).toContain('/api/services/apps/token-one/portal/models');
    expect(serviceRequestUrl('https://desktop.example','token-one-console','/portal/models')).toContain('/api/apps/token-one-console/portal/models');
    expect(serviceRequestUrl('https://desktop.example','files','/unregistered')).toContain('/api/apps/files/unregistered');
    expect(()=>serviceRequestUrl('https://desktop.example','files','/../secret')).toThrow();
    expect(serviceInvocationUrl('https://desktop.example','files.api','get',{id:'123'})).toContain('?path.id=123');
  });
  it('写请求带 CSRF，失败不重试并释放忙碌状态',async()=>{
    const done=vi.fn(),beginRequest=vi.fn(()=>done),expired=vi.fn(),clear=vi.fn();
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({message:'无访问权限'}),{status:403,headers:{'X-Request-Id':'request-test'}}));
    vi.stubGlobal('fetch',fetch);
    const client=createApplicationClient({origin:'https://desktop.example',appId:'resource-manager',session:{csrf:async()=>'csrf-test',clear},onExpired:expired,beginRequest});
    await expect(client.request('/resources/server1/metadata',{method:'POST',body:'{}'})).rejects.toMatchObject({status:403,requestId:'request-test'});
    expect(fetch).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][0]).toContain('/api/services/apps/');
    expect(fetch.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('csrf-test');
    expect(done).toHaveBeenCalledTimes(1);expect(expired).not.toHaveBeenCalled();
  });
  it('并发失效只触发一次登录且保留调用方取消信号',async()=>{
    const expired=vi.fn(),clear=vi.fn(),controller=new AbortController();
    const fetch=vi.fn().mockImplementation(async()=>new Response('{}',{status:401}));vi.stubGlobal('fetch',fetch);
    const client=createApplicationClient({origin:'https://desktop.example',appId:'resource-manager',session:{csrf:async()=>'',clear},onExpired:expired});
    await Promise.allSettled([client.request('/overview',{signal:controller.signal}),client.request('/overview')]);
    expect(expired).toHaveBeenCalledTimes(1);expect(clear).toHaveBeenCalledTimes(1);expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });
});
