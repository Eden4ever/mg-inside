import {readFile} from 'node:fs/promises';
import {it,expect} from 'vitest';
import {compileStyle,parse} from '@vue/compiler-sfc';
import postcss from 'postcss';

it('公共壳编译后的样式不隐藏 iframe 内的 html，遮罩偏移只作用于遮罩',async()=>{
 const root='../../../../mg-platform/packages/frontend/';
 const styles:string[]=[];
 for(const file of ['ApplicationHeader.vue','ConfiguredApplicationShell.vue']){
  const {descriptor}=parse(await readFile(new URL(root+file,import.meta.url),'utf8'));
  for(const style of descriptor.styles){
   const result=compileStyle({source:style.content,filename:file,id:'data-v-regression',scoped:style.scoped});
   expect(result.errors).toEqual([]);styles.push(result.code);
  }
 }
 const rules=postcss.parse(styles.join('\n'));
 rules.walkRules(rule=>{
  if(rule.selectors.some(selector=>/^(?:html)?\.desktop-embedded$/.test(selector.trim()))){
   rule.walkDecls(decl=>expect(['display','visibility','height','width','top','content-visibility'],`根节点被错误设置 ${decl.prop}:${decl.value}`).not.toContain(decl.prop));
  }
 });
 let backdrop=false;
 rules.walkRules(rule=>{if(rule.selector==='.desktop-embedded .mg-navigation-backdrop')backdrop=true;});
 expect(backdrop).toBe(true);
});
