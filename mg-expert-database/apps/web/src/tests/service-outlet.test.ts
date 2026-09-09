import {afterEach,expect,it,vi} from 'vitest';
vi.mock('@/desktop',()=>({unifiedDesktop:true,desktop:{origin:'https://desktop.example',apiBase:'https://desktop.example/api/apps/expert-database',beginRequest:()=>()=>{},login:vi.fn()}}));
import {api} from '@/api/client';
afterEach(()=>vi.unstubAllGlobals());
it('公共查询经过服务出口，业务写入保留原接口和响应解包',async()=>{
 const fetch=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({data:[]}),{headers:{'content-type':'application/json'}}));vi.stubGlobal('fetch',fetch);
 expect(await api.listSystems()).toEqual([]);
 expect(fetch.mock.calls[0]?.[0]).toBe('https://desktop.example/api/services/apps/expert-database/systems');
 await api.semanticList();expect(fetch.mock.calls[1]?.[0]).toContain('/api/services/apps/expert-database/semantic-libraries');
 await api.updateSystem('system1',{name:'测试',region:'测试'});expect(fetch.mock.calls[2]?.[0]).toContain('/api/apps/expert-database/systems/system1');
});
