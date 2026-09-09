import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ImportRow { row: number; level: unknown; code: unknown; name: unknown; parentCode: unknown; sortOrder: unknown; }
let parsing = false;

export async function readXlsxRows(file: Buffer): Promise<ImportRow[]> {
  if (!Buffer.isBuffer(file) || !file.length || file.length > 10 * 1024 * 1024) throw new BadRequestException('xlsx 文件必须非空且不超过 10 MB。');
  if (parsing) throw new HttpException('正在解析其他导入文件，请稍后重试。', HttpStatus.TOO_MANY_REQUESTS);
  parsing = true;
  try {
    return await new Promise<ImportRow[]>((resolve, reject) => {
      const compiled = join(__dirname, 'xlsx-import-worker.js');
      const useCompiled = existsSync(compiled);
      const child = fork(useCompiled ? compiled : join(__dirname, 'xlsx-import-worker.ts'), [], {
        execArgv: ['--max-old-space-size=128', ...(useCompiled ? [] : ['--import', 'tsx'])],
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
      });
      const timer = setTimeout(() => { child.kill(); reject(new BadRequestException('导入解析超时，请简化文件后重试。')); }, 15_000);
      child.once('message', (message: { rows?: ImportRow[]; error?: string }) => {
        clearTimeout(timer); child.kill();
        if (message.rows) resolve(message.rows);
        else reject(new BadRequestException(message.error || '无法读取 xlsx 文件。'));
      });
      child.once('error', () => { clearTimeout(timer); child.kill(); reject(new BadRequestException('无法启动导入解析。')); });
      child.once('exit', () => { clearTimeout(timer); reject(new BadRequestException('导入文件超过解析资源限制或格式无效。')); });
      child.send(file, error => { if (error) { clearTimeout(timer); child.kill(); reject(new BadRequestException('无法传递导入文件。')); } });
    });
  } finally { parsing = false; }
}
