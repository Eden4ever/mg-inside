import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {chromium} from '@playwright/test';
const root=resolve(import.meta.dirname,'..'),dist=resolve(root,'../mg-service-one/dist');
const evidence=resolve(process.argv[2]||'');
assert(evidence.startsWith(join(root,'.runtime')+sep),'仅使用本任务的隔离测试证据');
const captured=JSON.parse(await readFile(evidence,'utf8'));
const work=join(resolve(evidence,'..'),'governance-ui');await mkdir(work,{recursive:true});
let administrator=true,failed=false,empty=false,reads=0;
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve(dist,'.'+path);if(!file.startsWith(dist+sep)&&file!==dist){res.writeHead(403);res.end();return;}const extension=extname(file);const content=await readFile(extension?file:join(dist,'index.html'));res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'}[extension]||'text/html'));res.end(content);}catch{res.writeHead(404);res.end();}});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const metric={count:1,successful:1,failed:0,cancelled:0,unknown:0,averageMs:1,responseBytes:0,measured:1,successRate:100};
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  let result;
  if(path==='/api/service-registry'){reads++;if(failed)return route.fulfill({status:503,json:{message:'审计服务暂不可用'}});result={items:[],activity:[captured.activity],audit:empty?[]:[captured.audit],canManage:administrator,storage:{backend:'postgresql',environment:'local'},runningEnvironment:'local',providers:[{id:captured.audit.appId,name:'动态注册应用'}]};}
  else if(path==='/api/service-registry/workspace')result={revision:0,services:{},tags:[]};
  else if(path==='/api/service-registry/insights')result={summary:metric,groups:[],logs:[captured.activity],series:[],total:1,pageSize:50,coverage:'persisted',from:captured.audit.at,to:captured.audit.at};
  else if(path==='/api/session')result={csrfToken:'ui-fixture',apps:[]};
  else return route.abort();
  await route.fulfill({json:result});
 });
 const url='http://127.0.0.1:'+server.address().port+'/activity';
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);await page.goto(url);await page.getByRole('tab',{name:'API 治理',exact:true}).click();
  await page.getByText('未登记兼容',{exact:true}).waitFor();
  const search=page.getByRole('textbox',{name:'筛选 API 治理记录'});
  await search.fill('not-a-matching-request');await page.getByText('暂无 API 治理记录',{exact:true}).waitFor();
  await search.fill('');await page.getByText('未登记兼容',{exact:true}).waitFor();
  const previous=reads;await page.getByRole('button',{name:'刷新治理记录',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.el-loading-mask'));
  assert(reads>previous,'刷新必须重新读取接口');
  await page.screenshot({path:join(work,viewport.width+'.png'),fullPage:true});
  if(viewport.width<600){await page.locator('.el-table').last().scrollIntoViewIfNeeded();await page.screenshot({path:join(work,'390-table.png'),fullPage:true});}
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'页面不能横向溢出');
 }
 empty=true;await page.getByRole('button',{name:'刷新治理记录',exact:true}).click();await page.getByText('暂无 API 治理记录',{exact:true}).waitFor();
 failed=true;await page.getByRole('button',{name:'刷新治理记录',exact:true}).click();await page.getByRole('alert').filter({hasText:'审计服务暂不可用'}).waitFor();
 failed=false;administrator=false;await page.reload();await page.getByRole('tab',{name:'调用日志',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'API 治理',exact:true}).count(),0);
 assert.deepEqual(errors,[]);
 const result={passed:true,checks:['桌面和手机截图','无页面横向溢出','筛选','刷新重新请求','空态','失败态','普通用户不显示治理入口'],scope:'使用真实隔离网关事件的前端接口替身，非生产端到端验收'};
 await writeFile(join(work,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,evidence:work},null,2));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
