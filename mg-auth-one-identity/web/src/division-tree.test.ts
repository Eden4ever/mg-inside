import { describe, it, expect } from 'vitest';
import { descendantIds, divisionTree } from './division-tree';
import type { Division } from './api/client';
const rows = [
  {id:'a',parentId:null,name:'省',code:'410000'}, {id:'b',parentId:'a',name:'市',code:'410100'},
  {id:'c',parentId:'b',name:'县',code:'410105'}, {id:'d',parentId:'a',name:'另一市',code:'410200'},
] as Division[];
describe('区划层级检索',()=>{
  it('名称和编码检索保留匹配节点的完整祖先路径',()=>{
    const tree=divisionTree(rows,' 410105 ');expect(tree).toHaveLength(1);expect(tree[0].id).toBe('a');expect(tree[0].children).toHaveLength(1);expect(tree[0].children[0].children[0].id).toBe('c');expect(divisionTree(rows,'不存在')).toEqual([]);
  });
  it('机构区划范围包含全部后代而非编码前缀猜测',()=>{
    expect([...descendantIds(rows,'a')].sort()).toEqual(['a','b','c','d']);expect([...descendantIds(rows,'b')]).toEqual(['b','c']);expect(divisionTree(rows)).toHaveLength(1);
  });
});
