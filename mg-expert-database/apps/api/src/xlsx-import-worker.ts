import ExcelJS from 'exceljs';
import { fromBufferPromise } from 'yauzl';
import type { ImportRow } from './xlsx-import';

export async function validateArchive(file: Buffer) {
  const zip = await fromBufferPromise(file, { validateEntrySizes: true, strictFileNames: true });
  let total = 0; let count = 0;
  const names = new Set<string>();
  try {
    for await (const entry of zip.eachEntry()) {
      if (++count > 256 || names.has(entry.fileName) || entry.isEncrypted() || entry.uncompressedSize > 8 * 1024 * 1024 || entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * 200)) throw new Error('压缩包条目数量、大小或压缩比超限。');
      names.add(entry.fileName);
      const stream = await zip.openReadStreamPromise(entry);
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length; total += chunk.length;
        if (size > 8 * 1024 * 1024 || total > 20 * 1024 * 1024) { stream.destroy(); throw new Error('文件解压后超过安全大小限制。'); }
      }
    }
  } finally { zip.close(); }
}

async function parse(file: Buffer): Promise<ImportRow[]> {
  await validateArchive(file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as any);
  if (workbook.worksheets.length > 16) throw new Error('工作表数量不能超过 16。');
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > 10_001 || sheet.columnCount > 64) throw new Error('工作表不能超过 10000 行数据或 64 列。');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('工作簿不包含工作表。');
  const headers = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => headers.set(String(cell.text).trim(), index));
  const header = (keys: string[]) => keys.map(key => headers.get(key)).find((value): value is number => Boolean(value));
  const level = header(['level', '层级']); const code = header(['code', '指标编码']); const name = header(['name', '指标名称']);
  const parent = header(['parentCode', '父级编码']); const sort = header(['sortOrder', '排序']);
  if (!level || !code || !name) throw new Error('导入表必须包含 level/层级、code/指标编码、name/指标名称 列。');
  const rows: ImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 1 || row.cellCount === 0) return;
    const value = (column: number | undefined) => {
      if (!column) return null;
      const result = row.getCell(column).value;
      if (JSON.stringify(result).length > 4096) throw new Error('单个字段内容不能超过 4096 字符。');
      return result;
    };
    rows.push({ row: rowNumber, level: value(level), code: value(code), name: value(name), parentCode: value(parent), sortOrder: value(sort) });
  });
  return rows;
}

if (require.main === module && process.send) process.once('message', async (file: Buffer) => {
  try { process.send?.({ rows: await parse(file) }); }
  catch { process.send?.({ error: '无法读取 xlsx 文件：格式无效或超过安全限制（10000 行、64 列、解压后 20 MB）。' }); }
});
