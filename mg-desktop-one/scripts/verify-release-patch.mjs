import { chromium, expect as baseExpect } from '@playwright/test';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const expect=baseExpect.configure({timeout:15000});
const release=resolve(process.env.RELEASE_DIR || 'artifacts/platform-20260908T124713Z'),output=resolve(process.env.QA_OUTPUT || '.runtime/release-patch-smoke');await mkdir(output,{recursive:true});
const shaPath=join(release,'SHA256SUMS'),manifest=await readFile(shaPath,'utf8'),sha=createHash('sha256').update(manifest).digest('hex');
const hashErrors=[];let verified=0;
for(const line of manifest.trim().split(/\r?\n/)){const match=/^([a-f0-9]{64})\s+(.+)$/.exec(line);if(!match)throw new Error('SHA清单格式异常');const file=resolve(release,match[2]);if(!file.startsWith(release+'/')&&!file.startsWith(release+'\\'))throw new Error('SHA路径越界');const actual=createHash('sha256').update(await readFile(file)).digest('hex');if(actual!==match[1])hashErrors.push(match[2]);verified++;}
if(hashErrors.length)throw new Error(`产物校验失败 ${JSON.stringify(hashErrors)}`);
const origin='https://desktop.meta-gravity.com',rootId='00000000-0000-4000-8000-000000000001',desktopId='00000000-0000-4000-8000-000000000002',fileId='00000000-0000-4000-8000-000000000003';
const user={id:'release-smoke-user',userId:'release-smoke-user',username:'release-smoke',name:'发布隔离验证',department:null,departmentName:null,role:'system_admin',authSource:'unified',identityAuthorized:true,roles:[{id:'release-smoke-role',key:'platform-admin',name:'平台管理员'}]};
const apps=[['personal-center','个人中心','/profile'],['app-manager','应用管理','/applications'],['files','文件','/my-files'],['identity','统一身份','/']].map(([id,name,defaultPath])=>({id,name,description:'本地隔离验证',kind:'default',icon:'knowledge',entryUrl:`${origin}/apps/${id}`,defaultPath,allowedPaths:id==='files'?['/my-files','/recent','/favorites','/trash','/dialogs']:['/','/profile','/security','/preferences','/notifications','/applications','/applications/editor','/admin','/roles','/settings'],minWidth:700,minHeight:500}));
const prefs={theme:'light',wallpaper:'sky',restore:false,pinned:['files','personal-center','app-manager','identity'],applicationOrder:apps.map(a=>a.id)};
const root={id:rootId,parentId:null,name:'我的文件',kind:'folder',protected:'root',size:0,version:1,favorite:false,preview:'none',mimeType:'',createdAt:'2026-09-08T00:00:00Z',updatedAt:'2026-09-08T00:00:00Z'};
const desktop={...root,id:desktopId,parentId:rootId,name:'桌面',protected:'desktop'};
const file={...root,id:fileId,parentId:desktopId,name:'发布验证.txt',kind:'file',protected:undefined,size:19,preview:'text',mimeType:'text/plain'};const entries=[root,desktop,file];
const requests=[],unknown=[],missing=[],localhost=[],errors=[],checks=[];let stage='启动';
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:980},serviceWorkers:'block'});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
async function mockApi(route,url){const path=url.pathname,method=route.request().method();
 if(path==='/api/session')return json(route,{user,csrfToken:'isolated-csrf',expiresAt:Math.floor(Date.now()/1000)+86400,apps,desktop:{name:'MG 统一桌面'}});
 if(path==='/api/preferences')return json(route,prefs);
 if(path==='/api/notifications')return json(route,{items:[]});
 if(path==='/api/applications')return json(route,{items:apps.map(a=>({...a,editable:false,available:true})),desktop:{name:'MG 统一桌面'}});
 if(path.endsWith('/auth/me'))return json(route,path.startsWith('/api/apps/files')?{id:user.id,name:user.name,username:user.username}:{user,csrfToken:'isolated-csrf'});
 if(path==='/api/apps/identity/users'||path==='/api/apps/identity/roles'||path==='/api/apps/identity/applications')return json(route,[]);
 if(path.endsWith('/account-security'))return json(route,{mfaEnabled:false,methods:[],email:null,totpBound:false,keys:[]});
 if(path==='/api/apps/files/desktop')return json(route,{folderId:desktopId,items:entries.filter(e=>e.parentId===desktopId)});
 if(path==='/api/apps/files/folders'&&method==='GET')return json(route,{items:[{...root,label:'我的文件'},{...desktop,label:'我的文件 / 桌面'}]});
 if(path==='/api/apps/files/folders'&&method==='POST'){const input=route.request().postDataJSON();const added={...root,id:randomUUID(),parentId:input.parentId,name:input.name,protected:undefined};entries.push(added);return json(route,added,201);}
 if(path==='/api/apps/files/entries'){const parent=url.searchParams.get('parentId'),current=parent==='desktop'||parent===desktopId?desktop:root;return json(route,{items:entries.filter(e=>e.parentId===current.id),total:entries.filter(e=>e.parentId===current.id).length,parentId:current.id,rootId,desktopFolderId:desktopId,breadcrumbs:current===desktop?[root,desktop]:[root],quota:{used:file.size,limit:1024**3,maxFile:50*1024**2}});}
 const match=/^\/api\/apps\/files\/entries\/([\w-]+)(?:\/(content|access|move))?$/.exec(path);if(match){const item=entries.find(e=>e.id===match[1]);if(!item)return json(route,{message:'不存在'},404);if(match[2]==='content')return route.fulfill({status:200,contentType:'application/octet-stream',body:'静态发布预览验证'});if(method==='PATCH'){Object.assign(item,route.request().postDataJSON());return json(route,item);}if(match[2]==='access')return json(route,{ok:true});if(match[2]==='move')return json(route,item);return json(route,item);}
 unknown.push({path,method});return json(route,{message:'未声明的隔离 API'},501);
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon'};
await context.route('**/*',async route=>{const url=new URL(route.request().url());requests.push({origin:url.origin,path:url.pathname,method:route.request().method(),type:route.request().resourceType()});
 if(['127.0.0.1','localhost'].includes(url.hostname)){localhost.push(url.pathname);return route.abort();}
 if(url.origin!==origin){unknown.push({origin:url.origin,path:url.pathname});return route.abort();}
 if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/'))return mockApi(route,url);
 const app=/^\/apps\/(personal-center|app-manager|files|identity)(\/|$)/.exec(url.pathname);let base,path;
 if(app){if(url.pathname===`/apps/${app[1]}`)return route.fulfill({status:308,headers:{location:`/apps/${app[1]}/`},body:''});base=join(release,'static');path=resolve(base,'.'+decodeURIComponent(url.pathname));}
 else{base=join(release,'desktop','web');path=resolve(base,'.'+decodeURIComponent(url.pathname));}
 if(!path.startsWith(base)){unknown.push({path:url.pathname,reason:'路径越界'});return route.abort();}
 let present=await stat(path).catch(()=>undefined);if(present?.isDirectory()){path=join(path,'index.html');present=await stat(path).catch(()=>undefined);}
 if(!present){if(url.pathname.includes('/assets/')){missing.push(url.pathname);return route.fulfill({status:404,body:'missing static asset'});}path=app?join(release,'static','apps',app[1],'index.html'):join(base,'index.html');}
 return route.fulfill({status:200,contentType:mime[extname(path)]||'application/octet-stream',body:await readFile(path)});
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
try{
 for(const [app,path,heading,next,label] of [['personal-center','/profile','个人资料','/notifications','通知中心'],['app-manager','/applications','应用目录',null,null],['identity','/roles','角色管理','/admin','员工身份']]){
  stage=app;await page.goto(`${origin}/apps/${app}${path}`);await expect(page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible();await expect(page.locator('.app-header')).toBeVisible();expect(await page.locator('meta[name=application-base]').getAttribute('content')).toBe(`/apps/${app}/`);if(next){await page.getByRole('button',{name:label,exact:true}).click();await expect(page).toHaveURL(`${origin}/apps/${app}${next}`);await page.reload();await expect(page.locator('.app-header')).toBeVisible();}checks.push(`${app} 子路径直访/路由/刷新`);await page.screenshot({path:join(output,`${app}.png`)});
 }
 stage='files独立';await page.goto(`${origin}/apps/files/my-files/desktop`);await expect(page.locator('.finder-folder-title')).toHaveText('桌面');await expect(page.locator('.file-tile')).toHaveCount(1);await page.locator('.global-nav').getByRole('button',{name:'我的文件',exact:true}).click();await expect(page).toHaveURL(`${origin}/apps/files/my-files`);await page.reload();await expect(page.locator('.finder-folder-title')).toHaveText('我的文件');checks.push('files子路径/桌面alias/导航刷新');
 for(const intent of ['new-folder','rename','move','upload']){stage=`files-${intent}`;await page.goto(`${origin}/apps/files/my-files/desktop?intent=${intent}${['rename','move'].includes(intent)?`&open=${fileId}`:''}`);if(intent==='upload'){await expect(page.getByRole('button',{name:'选择文件',exact:true})).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();}else{await expect(page.locator('.el-dialog')).toBeVisible();if(intent==='rename')await expect(page.getByRole('textbox',{name:'名称',exact:true})).toHaveValue('发布验证.txt');if(intent==='move')await expect(page.getByRole('combobox',{name:'目标文件夹',exact:true})).toBeEnabled();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.el-dialog')).toHaveCount(0);}checks.push(`files intent=${intent}`);}
 stage='files preview';await page.goto(`${origin}/apps/files/my-files?open=${fileId}`);await expect(page.locator('.preview-body pre')).toContainText('静态发布预览验证');await page.locator('.el-dialog__headerbtn').click();await expect(page.locator('.el-dialog')).toHaveCount(0);checks.push('files open UUID 安全文本预览');
 stage='SDK真实父子iframe';await page.goto(`${origin}/open?app=files&path=${encodeURIComponent('/my-files/desktop')}`);const parentSelector='iframe[title="文件"]:not([src*="platformDialog="])',parent=page.frameLocator(parentSelector);await expect(parent.locator('.finder-folder-title')).toHaveText('桌面');await expect(parent.locator('.app-header')).toBeHidden();await parent.getByRole('button',{name:'新建文件夹',exact:true}).click();const selector='iframe[src*="platformDialog=file-name"]',child=page.frameLocator(selector);await expect(child.getByRole('textbox',{name:'名称',exact:true})).toBeVisible();const childUrl=new URL(await page.locator(selector).getAttribute('src'));expect(childUrl.pathname).toBe('/apps/files/dialogs/name');expect(childUrl.searchParams.get('desktopOrigin')).toBe(origin);await child.getByRole('textbox',{name:'名称',exact:true}).fill('仅隔离mock创建');await child.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator(selector)).toHaveCount(0);await expect(parent.locator('.file-tile').filter({hasText:'仅隔离mock创建'})).toBeVisible();checks.push('生产SDK真实iframe ready/context/open/complete/result与刷新');await page.screenshot({path:join(output,'sdk-files.png')});
 expect(missing).toEqual([]);expect(localhost).toEqual([]);expect(unknown).toEqual([]);expect(errors).toEqual([]);expect(requests.filter(r=>/\/apps\/(?:[^/]+)\/apps\//.test(r.path))).toEqual([]);
 const after=createHash('sha256').update(await readFile(shaPath)).digest('hex');expect(after).toBe(sha);
 const result={passed:true,manifestSha256:sha,verifiedFiles:verified,checks,requests:requests.length,staticRequests:requests.filter(r=>!r.path.startsWith('/api/')).length,mockedApiRequests:requests.filter(r=>r.path.startsWith('/api/')).length,productionNetworkRequests:0,missing,localhost,unknown,errors,artifactUnchanged:true};await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page.screenshot({path:join(output,'failure.png')});const result={passed:false,stage,detail:error.message.split('\n')[0],manifestSha256:sha,verifiedFiles:verified,checks,missing,localhost,unknown,errors};await writeFile(join(output,'result.json'),JSON.stringify(result,null,2));console.error(JSON.stringify(result));process.exitCode=1;}finally{await browser.close();}



