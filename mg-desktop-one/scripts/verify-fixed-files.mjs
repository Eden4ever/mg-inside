import { chromium, expect } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const account = JSON.parse(await readFile('.runtime/local/account.json', 'utf8'));
const output = resolve('.runtime/fixed-files'); await mkdir(output, {recursive:true});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks=[], errors=[]; let page, session, created;
async function check(name, run) { try {await run(); checks.push(name); console.log(name);}catch(error){await page.screenshot({path:resolve(output,'failure.png')});console.log(JSON.stringify({failed:name,frames:await Promise.all(page.frames().filter(f=>f.parentFrame()).map(async f=>({url:f.url(),text:(await f.locator('body').innerText()).slice(0,2000)})))}));throw error;} }
async function api(path, method='GET', body) { return page.evaluate(async ({path,method,body,csrf}) => {const response=await fetch(path,{method,credentials:'include',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})}); const data=await response.json();if(!response.ok)throw Error(`${method} ${path}: ${response.status} ${data.message}`);return data;},{path,method,body,csrf:session?.csrfToken||''}); }
async function showDesktop() { for(let i=0;i<12;i++){const buttons=page.locator('.app-window:visible .window-minimize');if(!await buttons.count())return;await buttons.last().click();}throw Error('窗口未全部最小化'); }
async function blankMenu() { await showDesktop(); const r=await page.locator('.work-area').boundingBox(); await page.mouse.click(r.x+r.width-150,r.y+180,{button:'right'});await page.getByRole('menu',{name:'桌面选项'}).waitFor();return page.getByRole('menu',{name:'桌面选项'}); }
async function itemMenu() { await showDesktop();await page.getByRole('button',{name:created.name+'（文件夹）',exact:true}).click({button:'right'});return page.getByRole('menu',{name:'桌面选项'}); }
async function cancelChild(path) {const child=page.frameLocator(`iframe[src*="${path}"]`);await child.getByRole('button',{name:'取消',exact:true}).click();await page.locator(`iframe[src*="${path}"]`).waitFor({state:'detached'});}
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  // 隔离浏览器状态；测试产生的固定/排列偏好不得写回真实用户。
  await context.route('**/api/preferences',async route=>route.request().method()==='PUT'?route.fulfill({json:{ok:true}}):route.continue());
  await page.goto('http://127.0.0.1:4301/');
  await page.getByRole('textbox',{name:'登录账号',exact:true}).fill(account.username);
  await page.getByRole('textbox',{name:'登录密码',exact:true}).fill(account.password);
  await page.getByRole('button',{name:'登 录',exact:true}).click();await page.waitForURL('http://127.0.0.1:4301/');
  const dock=page.getByRole('navigation',{name:'应用 Dock'});await dock.getByRole('button',{name:'打开文件',exact:true}).waitFor();session=await api('/api/session');
  await check('所有授权应用均有桌面快捷方式，从上到下后向右换列',async()=>{
    const shortcuts=page.locator('.desktop-app-shortcut');await shortcuts.last().waitFor();
    assert.deepEqual((await shortcuts.allTextContents()).map(x=>x.replace('↗','').trim()).sort(),session.apps.map(a=>a.name).sort());
    const rects=await shortcuts.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{x:r.x,y:r.y}}));
    assert.ok(rects.length>5);let wrapped=false;
    for(let i=1;i<rects.length;i++){const a=rects[i-1],b=rects[i];if(Math.abs(a.x-b.x)<1)assert.ok(b.y>a.y);else{wrapped=true;assert.ok(b.x>a.x);assert.equal(b.y,rects[0].y);}}
    assert.ok(wrapped,'必须实际覆盖向右换列');await page.screenshot({path:resolve(output,'desktop-shortcuts.png')});
  });
  await check('Dock文件固定最左、回收站最右、图标中心对齐且固定项不可拖动移除',async()=>{
    const labels=await dock.locator(':scope > button').evaluateAll(items=>items.map(item=>item.getAttribute('aria-label')));
    assert.deepEqual(labels.slice(0,2),['打开文件','所有应用']);assert.equal(labels.at(-1),'打开回收站');
    for(const name of ['打开文件','打开回收站']){assert.equal(labels.filter(v=>v===name).length,1);const item=dock.getByRole('button',{name,exact:true});assert.equal(await item.getAttribute('draggable'),'false');await item.click({button:'right'});assert.equal(await page.getByRole('menu',{name:'应用选项'}).count(),0);const r=await item.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+180,r.y-170,{steps:8});assert.equal(await page.locator('.application-drag-ghost').count(),0);await page.mouse.up();}
    await page.mouse.move(1300,100);const centers=await dock.locator('.app-icon').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return r.y+r.height/2;}));assert.ok(Math.max(...centers)-Math.min(...centers)<1);
    assert.ok(await dock.locator('.running-dot').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).position==='absolute')));
    assert.deepEqual(await dock.locator(':scope > button').evaluateAll(items=>items.map(item=>item.getAttribute('aria-label'))),labels);
  });
  await check('所有应用排除files，快捷方式沿用应用菜单',async()=>{
    await dock.getByRole('button',{name:'所有应用',exact:true}).click();assert.equal(await page.getByRole('button',{name:'启动文件',exact:true}).count(),0);assert.equal(await page.locator('.grid-app-launch').count(),session.apps.filter(a=>a.id!=='files').length);await page.getByRole('button',{name:'关闭菜单',exact:true}).click();
    await page.locator('.desktop-app-shortcut').filter({hasText:'Token One'}).first().click({button:'right'});const menu=page.getByRole('menu',{name:'应用选项'});await menu.getByRole('menuitem',{name:'打开应用',exact:true}).waitFor();assert.equal(await page.getByRole('menu',{name:'桌面选项'}).count(),0);await page.keyboard.press('Escape');await page.mouse.click(1300,150);
  });
  const desktop=await api('/api/apps/files/desktop');created=await api('/api/apps/files/folders','POST',{parentId:desktop.folderId,name:'桌面交互验证-'+Date.now()});
  await check('空白右键包含新建、上传、刷新及打开桌面；刷新显示新目录',async()=>{
    const menu=await blankMenu();assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['新建文件夹','上传文件…','在文件中打开桌面','刷新']);await menu.getByRole('menuitem',{name:'刷新',exact:true}).click();await page.getByRole('button',{name:created.name+'（文件夹）',exact:true}).waitFor();
  });
  await check('空白新建打开独立名称对话框，上传打开桌面上传选择入口',async()=>{
    let menu=await blankMenu();await menu.getByRole('menuitem',{name:'在文件中打开桌面',exact:true}).click();await page.frameLocator('iframe[title="文件"]').locator('.finder-folder-title').filter({hasText:'桌面'}).waitFor();menu=await blankMenu();await menu.getByRole('menuitem',{name:'新建文件夹',exact:true}).click();await page.frameLocator('iframe[src*="/dialogs/name"]').getByRole('textbox',{name:'名称',exact:true}).waitFor();await cancelChild('/dialogs/name');
    menu=await blankMenu();await menu.getByRole('menuitem',{name:'上传文件…',exact:true}).click();const frame=page.frameLocator('iframe[title="文件"]');await frame.getByRole('button',{name:'选择文件',exact:true}).waitFor();const chooser=page.waitForEvent('filechooser');await frame.getByRole('button',{name:'选择文件',exact:true}).click();await(await chooser).setFiles([]);await frame.getByRole('button',{name:'取消',exact:true}).click();
  });
  await check('条目右键打开目录、重命名和移动对话框均定位本条目',async()=>{
    let menu=await itemMenu();assert.deepEqual(await menu.getByRole('menuitem').allTextContents(),['打开','重命名','移动到…','移到回收站','在文件中打开桌面','刷新']);await page.screenshot({path:resolve(output,'desktop-context-menu.png')});await menu.getByRole('menuitem',{name:'打开',exact:true}).click();await page.frameLocator('iframe[title="文件"]').locator('.finder-folder-title').filter({hasText:created.name}).waitFor();
    menu=await itemMenu();await menu.getByRole('menuitem',{name:'重命名',exact:true}).click();const editor=page.frameLocator('iframe[src*="/dialogs/name"]').getByRole('textbox',{name:'名称',exact:true});await editor.waitFor();await expect(editor).toHaveValue(created.name);await cancelChild('/dialogs/name');
    menu=await itemMenu();await menu.getByRole('menuitem',{name:'移动到…',exact:true}).click();await page.frameLocator('iframe[src*="/dialogs/move"]').getByText('将「'+created.name+'」移动到：',{exact:true}).waitFor();await cancelChild('/dialogs/move');
  });
  await check('桌面删除只回收选中测试目录，固定回收站打开且无重复Dock项',async()=>{
    const menu=await itemMenu();page.once('dialog',dialog=>dialog.accept());const deletion=page.waitForRequest(request=>request.method()==='DELETE'&&request.url().endsWith('/entries/'+created.id));await menu.getByRole('menuitem',{name:'移到回收站',exact:true}).click();assert.equal((await deletion).postDataJSON().version,created.version);await page.getByRole('button',{name:created.name+'（文件夹）',exact:true}).waitFor({state:'detached'});
    await dock.getByRole('button',{name:'打开回收站',exact:true}).click();await page.frameLocator('iframe[title="文件"]').locator('.finder-folder-title').filter({hasText:'回收站'}).waitFor();await page.frameLocator('iframe[title="文件"]').getByText(created.name,{exact:true}).waitFor();assert.equal(await dock.getByRole('button',{name:'打开文件',exact:true}).count(),1);assert.equal(await dock.getByRole('button',{name:'打开回收站',exact:true}).count(),1);assert.equal(await dock.locator('[data-app-id="files"]').count(),0);await page.screenshot({path:resolve(output,'trash-open.png')});
  });
  assert.deepEqual(errors,[]);
} finally {
  if(created&&page){const trash=await api('/api/apps/files/entries?view=trash');let target=trash.items.find(e=>e.id===created.id);if(!target){const current=await api('/api/apps/files/entries/'+created.id);assert.equal(current.name,created.name);await api('/api/apps/files/entries/'+created.id,'DELETE',{version:current.version});target=(await api('/api/apps/files/entries?view=trash')).items.find(e=>e.id===created.id);}assert.equal(target.name,created.name);await api('/api/apps/files/entries/'+created.id+'/permanent','DELETE',{version:target.version});}
  await writeFile(resolve(output,'results.json'),JSON.stringify({checks,errors},null,2));await browser.close();
}
console.log(JSON.stringify({checks,errors}));
