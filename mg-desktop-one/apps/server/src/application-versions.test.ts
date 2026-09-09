import {it,expect,vi} from 'vitest';
import {createApplicationVersionReader} from './application-versions';
it('同源多入口共享构建版本，拒绝不匹配应用与站点回退 HTML',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({schemaVersion:1,appId:'token-one',version:'20260908T191620Z'})));
 const reader=createApplicationVersionReader(fetcher),entryUrl='https://token.example';
 expect(await Promise.all(['token-one','token-one-console','token-one-docs'].map(id=>reader({id,entryUrl})))).toEqual(Array(3).fill('20260908T191620Z'));
 expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1].credentials).toBe('omit');
 expect(await reader({id:'files',entryUrl})).toBe(null);
 expect(await createApplicationVersionReader(vi.fn().mockResolvedValue(new Response('<html>fallback</html>')))({id:'files',entryUrl})).toBe(null);
});
it('缺失、超大和错误版本元数据不影响应用目录',async()=>{
 for(const response of [new Response('',{status:404}),new Response('x'.repeat(5000)),new Response(JSON.stringify({schemaVersion:1,appId:'files',version:'猜测版本'}))])expect(await createApplicationVersionReader(vi.fn().mockResolvedValue(response))({id:'files',entryUrl:'https://files.example'})).toBe(null);
});
