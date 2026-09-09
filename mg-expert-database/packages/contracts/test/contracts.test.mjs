import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { WORKBOOK_COLUMN_MAPPINGS } from '../src/workbook-mapping.ts';

const schema = JSON.parse(fs.readFileSync(new URL('../../../docs/research-module-schema.json', import.meta.url), 'utf8'));
const modules = schema['x-moduleDefinitions'];

test('research schema compiles with JSON Schema 2020-12', () => {
  const ajv = new Ajv2020({ strict: false });
  assert.equal(typeof ajv.compile(schema), 'function');
});

test('research schema fixes exactly eight unique modules and unique field ids', () => {
  const expected = ['portrait', 'policy', 'data', 'quality', 'governance', 'rectify', 'optimize', 'contacts'];
  assert.deepEqual(modules.map((item) => item.moduleKey), expected);
  const fieldIds = modules.flatMap((item) => item.fields.map((field) => `${item.moduleKey}.${field.fieldId}`));
  assert.equal(new Set(fieldIds).size, fieldIds.length);
});

test('research record schema accepts levels one through six', () => {
  const level = schema.$defs.researchRecord.properties.indicatorLevel;
  assert.equal(level.minimum, 1);
  assert.equal(level.maximum, 6);
});

test('workbook mapping preserves the eight research semantics and does not treat expert contacts as people data', () => {
  const moduleKeys = new Set(WORKBOOK_COLUMN_MAPPINGS.filter((item) => item.target.kind === 'module').map((item) => item.target.moduleKey));
  assert.deepEqual([...moduleKeys], ['portrait', 'policy', 'data', 'quality', 'rectify', 'optimize', 'governance', 'contacts']);
  for (const header of ['指标属性', '政策源头追溯', '计算公式分解', '数据真实性核验', '分层整改建议', '指标必要性评估', '条块关系梳理', '省级责任单位']) {
    assert.ok(WORKBOOK_COLUMN_MAPPINGS.some((item) => item.header === header), `缺少核心语义映射：${header}`);
  }
  const peopleColumn = WORKBOOK_COLUMN_MAPPINGS.find((item) => item.header === '专家姓名及联系方式');
  assert.equal(peopleColumn?.target.kind, 'ignored');
});
