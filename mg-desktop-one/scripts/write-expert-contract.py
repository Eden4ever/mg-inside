"""根据知识库的 Nest 路由、查询映射和 Prisma 模型生成只读契约。"""
from pathlib import Path
import json

root = Path('../mg-expert-database/services')
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
manifest['version'] = '1.1.0'
text = {'type': 'string'}
identifier = {'type': 'string', 'minLength': 1, 'description': '提供方返回的稳定标识；兼容已有非 UUID 数据标识。'}
integer = {'type': 'integer'}
count = {'type': 'integer', 'minimum': 0}
boolean = {'type': 'boolean'}
date = {'type': 'string', 'format': 'date-time'}
def nullable(schema): return {'anyOf': [schema, {'type': 'null'}]}
def array(schema): return {'type': 'array', 'items': schema}
def ref(name): return {'$ref': '#/components/schemas/' + name}
def obj(fields, required=None): return {'type': 'object', 'properties': fields, 'required': list(fields) if required is None else required, 'additionalProperties': False}
def response(schema, description): return {'description': description, 'content': {'application/json': {'schema': schema}}}

schemas = {}
permission = {key: boolean for key in ['canView', 'canResearch', 'canManageCatalog', 'canReview', 'canPublish']}
schemas['SystemPermissions'] = obj({**permission, 'canManageAccess': boolean, 'systemRole': nullable({'enum': ['creator', 'manager', 'editor', 'viewer']})}, list(permission))
schemas['SystemSummary'] = obj({
    'id': identifier, 'name': text, 'code': text, 'region': text,
    'year': nullable(integer), 'version': nullable(text), 'versionId': nullable(identifier),
    'indicatorCount': count, 'maxLevel': integer, 'progress': {'type': 'integer', 'minimum': 0, 'maximum': 100},
    'status': text, 'updatedAt': date, 'access': ref('SystemPermissions'),
})
schemas['IndicatorVersion'] = obj({'id': identifier, 'systemId': identifier, 'year': integer, 'versionCode': text, 'status': text, 'createdAt': date, 'updatedAt': date})
schemas['SystemDetail'] = obj({
    'id': identifier, 'name': text, 'code': text, 'region': text, 'creatorUserId': nullable(identifier),
    'maxLevel': integer, 'templateRevision': integer, 'createdAt': date, 'updatedAt': date,
    'access': ref('SystemPermissions'), 'versions': array(ref('IndicatorVersion')),
})
schemas['SemanticBuild'] = obj({
    'id': identifier, 'status': text, 'total': count, 'completed': count, 'reused': count, 'tokens': count,
    'error': nullable(text), 'createdAt': date, 'finishedAt': nullable(date), 'fingerprint': text,
})
schemas['SemanticLibrary'] = obj({
    'id': identifier, 'name': text, 'versionId': identifier, 'systemName': text, 'version': text,
    'activeBuildId': nullable(identifier), 'build': nullable(ref('SemanticBuild')), 'canManage': boolean,
})
schemas['SemanticLibraries'] = obj({'configured': boolean, 'model': {'const': 'embedding-3'}, 'dimensions': {'const': 1024}, 'libraries': array(ref('SemanticLibrary'))})
# Nest 提供方错误含状态码；统一出口提前拒绝请求时使用 {message}。同一契约描述两者。
schemas['Error'] = obj({'message': {'anyOf': [text, array(text)]}, 'statusCode': {'type': 'integer', 'minimum': 400, 'maximum': 599}, 'error': text}, ['message'])
doc = {
    'openapi': '3.1.1', 'jsonSchemaDialect': 'https://json-schema.org/draft/2020-12/schema',
    'info': {'title': manifest['name'], 'version': '1.1.0', 'description': '只读查询保持知识库体系授权：普通用户仅可访问已获准查看的体系，系统管理员可查看全部。使用提供方原始 JSON 响应，不额外包装 data。'},
    'x-service-id': manifest['serviceId'], 'x-app-id': manifest['appId'],
    'servers': [{'url': '/api'}], 'security': [{'unifiedSession': []}], 'paths': {},
    'components': {'schemas': schemas, 'securitySchemes': {'unifiedSession': {'type': 'http', 'scheme': 'bearer', 'description': '由桌面出口转发当前用户身份；提供方映射本地用户及角色，再校验体系权限。服务登记不授予体系访问权。'}}},
}
descriptions = {
    'systems': '返回可查看的体系列表，按体系修改时间倒序；没有授权返回空数组。摘要选择年份最新、同年份修改时间最新的版本。没有版本时 year/version/versionId 为 null，指标数和进度为 0，status 为 draft。无分页或搜索参数。',
    'system': '返回体系基本资料、当前用户有效权限及版本列表，不包含指标树或研究正文。版本按年份及修改时间倒序。普通用户无查看授权时返回 403（包括不存在但无授权的 ID），系统管理员查询不存在的 ID 返回 404。',
    'libraries': '只返回可查看体系关联的语义库，按创建时间倒序。build 为最近创建的构建摘要，可能为空或与 activeBuildId 指向的可用构建不同。configured 仅表示向量服务已配置，不保证网络或业务健康。此操作不构建向量、不搜索、不产生模型调用；canManage 由当前用户体系权限决定。',
}
success = {'systems': array(ref('SystemSummary')), 'system': ref('SystemDetail'), 'libraries': ref('SemanticLibraries')}
for item in manifest['operations']:
    operation = {'operationId': item['operationId'], 'summary': item['summary'], 'description': descriptions[item['operationId']], 'responses': {
        '200': response(success[item['operationId']], '查询成功'),
        '401': response(ref('Error'), '未登录、会话过期或统一身份无法验证'),
        '403': response(ref('Error'), '无应用访问权限、账户停用或无体系查看权限'),
        '500': response(ref('Error'), '提供方未完成请求'),
        '502': response(ref('Error'), '统一出口无法连接提供方'),
        '503': response(ref('Error'), '服务未启用或当前部署未配置提供方'),
    }}
    if item['operationId'] == 'system':
        operation['parameters'] = [{'name': 'id', 'in': 'path', 'required': True, 'schema': identifier, 'description': '体系列表中的 id，不是 versionId。'}]
        operation['responses']['404'] = response(ref('Error'), '具有访问范围的调用者查询的体系不存在')
    doc['paths'][item['path']] = {'get': operation}
for name, value in [('openapi.json', doc), ('registration.json', {'manifest': manifest, 'contract': doc})]:
    (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('知识库三个只读操作契约已生成，尚未修改生产目录。')
