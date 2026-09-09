/** 发布前检查最终 CSS，防止 Vue :global 编译导致整个嵌入页面被隐藏。 */
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import postcss from 'postcss';
const source=process.argv[2];assert(source);
let checked=0;
async function visit(path){
 for(const item of await readdir(path,{withFileTypes:true})){
  const file=join(path,item.name);
  if(item.isDirectory())await visit(file);
  else if(item.name.endsWith('.css')){
   checked++;
   postcss.parse(await readFile(file,'utf8')).walkRules(rule=>{
    if(!rule.selectors.some(selector=>/^(?:html)?\.desktop-embedded$/.test(selector.trim())))return;
    rule.walkDecls(decl=>assert(!['display','visibility','height','width','top','content-visibility'].includes(decl.prop),`${file} 的 ${rule.selector} 意外修改根布局：${decl.prop}:${decl.value}`));
   });
  }
 }
}
await visit(source);assert(checked>0);console.log(`已检查 ${checked} 个构建样式：嵌入根布局无意外覆盖`);
