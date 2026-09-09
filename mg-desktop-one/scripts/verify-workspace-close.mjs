import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const account=JSON.parse(await readFile('.runtime/local/account.json','utf8'));
const fixture=JSON.parse(await readFile('.runtime/local/workspace.json','utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const frame=page.frameLocator('iframe[title="指标知识库"]');
try {
 await page.goto('http://127.0.0.1:4301/open?app=expert-database&path='+encodeURIComponent(fixture.path));
 await page.getByRole('textbox',{name:'登录账号',exact:true}).fill(account.username);
 await page.getByRole('textbox',{name:'登录密码',exact:true}).fill(account.password);
 await page.getByRole('button',{name:'登 录',exact:true}).click();
 await frame.getByRole('button',{name:`编辑${fixture.fieldLabel}`,exact:true}).click();
 const input=frame.getByRole('textbox',{name:fixture.fieldLabel,exact:true});
 const original=await input.inputValue();
 await input.fill('桌面关闭保护验证：'+Date.now());
 await page.getByRole('button',{name:'关闭指标知识库',exact:true}).click();
 await page.getByRole('button',{name:'在应用中处理',exact:true}).click();
 await frame.locator('.el-message-box__headerbtn').click();
 await page.getByRole('button',{name:'继续使用',exact:true}).click();
 assert.equal(await input.isVisible(),true);
 // 模拟业务保存失败，必须保留窗口和输入。
 const routePattern=`**/api/apps/expert-database/indicator-versions/${fixture.versionId}/indicators/${fixture.nodeId}/modules/${fixture.moduleKey}`;
 await page.route(routePattern,route=>route.fulfill({status:503,json:{message:'保存失败回归'}}));
 await page.getByRole('button',{name:'关闭指标知识库',exact:true}).click();
 await page.getByRole('button',{name:'在应用中处理',exact:true}).click();
 await frame.getByRole('button',{name:'保存后离开',exact:true}).click();
 await frame.getByText('保存失败回归',{exact:true}).waitFor();
 assert.equal(await input.isVisible(),true);
 assert.ok((await input.inputValue()).startsWith('桌面关闭保护验证'));
 await page.getByRole('button',{name:'继续使用',exact:true}).click();
 await page.unroute(routePattern);
 await input.fill(original || '桌面本地保存验证');
 await page.getByRole('button',{name:'关闭指标知识库',exact:true}).click();
 await page.getByRole('button',{name:'在应用中处理',exact:true}).click();
 await frame.getByRole('button',{name:'保存后离开',exact:true}).click();
 await page.locator('iframe[title="指标知识库"]').waitFor({state:'detached'});
 await mkdir('.runtime/workspace-close',{recursive:true});
 await writeFile('.runtime/workspace-close/verification.json',JSON.stringify({passed:true,checks:['真实中心登录保留业务深链接','真实体系授权与编辑','关闭可取消并保留草稿','保存失败不关窗且保留输入','真实 API 保存成功后关闭']},null,2));
 console.log('真实知识库：草稿关闭取消、保存失败保留、保存成功后关闭均通过。');
} catch(e) {console.error((await page.locator('body').innerText()).slice(0,1000)); console.error(await page.frames().find(f=>f.url().includes(':14321'))?.locator('body').innerText());throw e}
finally{await browser.close()}
