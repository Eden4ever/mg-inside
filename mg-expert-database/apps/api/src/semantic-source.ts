import { createHash } from 'node:crypto';
import type { ModuleDefinition } from './contract';
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface SourceChunk { hash: string; nodeId: string; path: string; label: string; text: string; metadata: Record<string, unknown>; }
export function splitText(text: string, maxBytes = 1800): string[] {
  const result: string[] = []; let part = ''; let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes && part) { result.push(part); part = ''; bytes = 0; }
    part += character; bytes += size;
  }
  if (part.trim()) result.push(part);
  return result;
}
export function readable(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(readable).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}：${readable(v)}`).join('\n');
  return String(value).replace(/<[^>]*>/g, ' ').trim();
}
export function activeDefinitions(value: unknown): ModuleDefinition[] {
  return (value as ModuleDefinition[]).filter(m => m.deleted !== true && m.active !== false).map(m => ({ ...m, fields: m.fields.filter(f => f.deleted !== true && f.active !== false) }));
}
export function appendChunks(target: SourceChunk[], nodeId: string, path: string, label: string, content: string, metadata: Record<string, unknown>) {
  if (!content.trim()) return;
  // 给路径与字段名称留出空间，按 UTF-8 字节数保守控制输入，不静默截断正文。
  const context = splitText(`${path}\n${label}`, 700)[0] || '';
  for (const [index, part] of splitText(content).entries()) {
    const text = `${context}\n${part}`;
    target.push({ nodeId, path, label, text, metadata: { ...metadata, part: index }, hash: digest({ nodeId, path, label, text, metadata, index, format: 1 }) });
  }
}
