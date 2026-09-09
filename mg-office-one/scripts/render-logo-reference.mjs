import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
const require=createRequire(new URL('../../mg-desktop-one/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const page=await browser.newPage({viewport:{width:800,height:800}});const svg=await readFile(new URL('../../mg-platform/packages/frontend/assets/enterprise-logo.svg',import.meta.url),'utf8');await page.setContent(`<style>body{margin:0;background:transparent}svg{width:800px;height:800px}</style>${svg}`);await mkdir('.runtime/wallpapers',{recursive:true});await page.screenshot({path:'.runtime/wallpapers/enterprise-logo-reference.png',omitBackground:true});}finally{await browser.close()}
