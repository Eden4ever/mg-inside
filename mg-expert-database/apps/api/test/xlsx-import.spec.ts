import { createRequire } from 'node:module';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { readXlsxRows } from '../src/xlsx-import';
import { validateArchive } from '../src/xlsx-import-worker';

const JSZip = createRequire(require.resolve('exceljs'))('jszip');
describe('受限目录解析', () => {
  it('中文列头可正常解析并保留行号及内容', async () => {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('目录');
    sheet.addRow(['层级', '指标编码', '指标名称']); sheet.addRow([1, 'A', '一级']);
    expect(await readXlsxRows(Buffer.from(await workbook.xlsx.writeBuffer()))).toEqual([{ row: 2, level: 1, code: 'A', name: '一级', parentCode: null, sortOrder: null }]);
  }, 20_000);
  it('拒绝高压缩比和过多条目，而非只检查上传字节数', async () => {
    const compressed = new JSZip(); compressed.file('xl/extra.xml', 'a'.repeat(2 * 1024 * 1024));
    await expect(validateArchive(await compressed.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))).rejects.toThrow();
    const many = new JSZip(); for (let i = 0; i < 257; i++) many.file(`item-${i}`, 'a');
    await expect(validateArchive(await many.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow();
  });
  it('拒绝累计解压超限及伪造条目尺寸', async () => {
    const many = new JSZip(); for (let i = 0; i < 4; i++) many.file(`item-${i}`, Buffer.alloc(6 * 1024 * 1024));
    await expect(validateArchive(await many.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))).rejects.toThrow();
    const zip = new JSZip(); zip.file('entry', 'actual-content');
    const file: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const central = file.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); file.writeUInt32LE(1, central + 24);
    await expect(validateArchive(file)).rejects.toThrow();
  });
  it('损坏文件和非首个工作表超限被拒绝，失败后可继续正常请求', async () => {
    await expect(readXlsxRows(Buffer.from('not-zip'))).rejects.toThrow('无法读取');
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('目录').addRow(['level', 'code', 'name']);
    workbook.addWorksheet('附表').getCell('A10002').value = '超限';
    await expect(readXlsxRows(Buffer.from(await workbook.xlsx.writeBuffer()))).rejects.toThrow('安全限制');
    await expect(readXlsxRows(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toThrow('10 MB');
    const valid = new ExcelJS.Workbook();
    valid.addWorksheet('目录').addRows([['level', 'code', 'name'], [1, 'A', '正常指标']]);
    expect(await readXlsxRows(Buffer.from(await valid.xlsx.writeBuffer()))).toHaveLength(1);
  // 本例顺序启动三个隔离进程；测试超时需覆盖每次 15 秒的生产上限。
  }, 50_000);
});
