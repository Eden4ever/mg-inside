import type { Division } from './api/client';
export const divisionTypes: Record<string,string> = { province:'省级', city:'地市', county:'县', district:'市辖区', town:'乡镇', street:'街道', village:'村级', functional_zone:'功能区' };
export const organizationTypes: Record<string,string> = { government:'政府机关', institution:'事业单位', enterprise:'企业', social:'社会组织', supervision:'监察机关', other:'其他' };
export type DivisionNode = Division & { label: string; children: DivisionNode[] };
export function descendantIds(rows: Division[], root: string): Set<string> {
  const result = new Set([root]);
  for (const id of result) for (const row of rows) if (row.parentId === id) result.add(row.id);
  return result;
}
export function divisionTree(rows: Division[], keyword = ''): DivisionNode[] {
  const term = keyword.trim().toLowerCase(), byId = new Map(rows.map(row => [row.id, row]));
  const retained = new Set<string>();
  if (term) for (const row of rows) {
    if (!`${row.name} ${row.code}`.toLowerCase().includes(term)) continue;
    let cursor: Division | undefined = row;
    while (cursor && !retained.has(cursor.id)) { retained.add(cursor.id); cursor = byId.get(cursor.parentId || ''); }
  }
  const nodes = new Map(rows.filter(row => !term || retained.has(row.id)).map(row => [row.id, { ...row, label: `${row.name}（${row.code}）`, children: [] as DivisionNode[] }]));
  const roots: DivisionNode[] = [];
  for (const node of nodes.values()) { const parent = nodes.get(node.parentId || ''); if (parent) parent.children.push(node); else roots.push(node); }
  return roots;
}
