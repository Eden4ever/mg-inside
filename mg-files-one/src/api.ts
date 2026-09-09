import { desktop, platformSession } from './desktop';
import {createApplicationClient,serviceRequestUrl} from '@mg-inside/frontend';
export interface FileEntry { id: string; parentId: string | null; name: string; kind: 'file' | 'folder'; protected?: 'root' | 'desktop'; size: number; mimeType: string; preview: 'image' | 'text' | 'pdf' | 'none'; version: number; favorite: boolean; createdAt: string; updatedAt: string; deletedAt?: string; accessedAt?: string; label?: string }
export interface Listing { items: FileEntry[]; total: number; parentId: string; rootId: string; desktopFolderId: string; breadcrumbs: FileEntry[]; quota: { used: number; limit: number; maxFile: number } }
const client=createApplicationClient({origin:desktop.origin,appId:'files',session:platformSession,onExpired:()=>desktop.login(),beginRequest:()=>desktop.beginRequest(),timeoutMs:60000});
export const response=client.response;
export const request=client.request;
export const uploadUrl=(path:string)=>serviceRequestUrl(desktop.origin,'files',path,'POST');
export function bytes(value: number) { if (!value) return '0 B'; const units = ['B','KB','MB','GB','TB'], exponent = Math.min(4, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`; }
export async function download(item: FileEntry) { const res = await response(`/entries/${item.id}/content`); const url = URL.createObjectURL(await res.blob()); const link = document.createElement('a'); link.href = url; link.download = item.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
