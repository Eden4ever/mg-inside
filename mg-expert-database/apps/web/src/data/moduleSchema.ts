import schemaJson from '../../../../docs/research-module-schema.json';
import type { ModuleDefinition } from '@/types/domain';

interface SchemaWithDefinitions {
  'x-moduleDefinitions': ModuleDefinition[];
}

export const MODULE_DEFINITIONS = [...(schemaJson as unknown as SchemaWithDefinitions)['x-moduleDefinitions']]
  .sort((a, b) => a.displayOrder - b.displayOrder);
