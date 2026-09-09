import { describe, expect, it } from 'vitest';
import { availableUsername, usernameBase } from '../src/username-suggestion';

describe('首次设置用户名建议', () => {
  it('使用姓名全拼、小写和姓氏读音，保留英文姓名', () => {
    expect(usernameBase('张三')).toBe('zhangsan');
    expect(usernameBase(' 曾乐乐 ')).toBe('zenglele');
    expect(usernameBase('吕布')).toBe('lvbu');
    expect(usernameBase('Alice Wang')).toBe('alicewang');
  });
  it('重名添加数字，不覆盖已有账号，优先选择最小可用序号', () => {
    const existing = new Set(['zhangsan', 'zhangsan1', 'zhangsan3']);
    expect(availableUsername('张三', existing)).toBe('zhangsan2');
    expect(existing.size).toBe(3);
  });
  it('特殊符号和超长姓名产生有界建议', () => {
    expect(usernameBase('😀')).toBe('user');
    expect(usernameBase('张'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});
