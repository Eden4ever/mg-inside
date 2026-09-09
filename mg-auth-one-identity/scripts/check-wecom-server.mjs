import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const host = process.argv[2];
if (!['106.52.90.82', '1.12.253.86'].includes(host)) throw new Error('仅允许已授权并核对主机密钥的服务器');
const settings = { corpId: process.env.WECOM_CORP_ID, agentId: process.env.WECOM_AGENT_ID, secret: process.env.WECOM_APP_SECRET };
if (Object.values(settings).some(v => !v)) throw new Error('缺少企业微信配置');
// 机密只经 SSH 加密 stdin 传入内存，不放命令行，不写服务器文件。
const script = `import json, urllib.request, urllib.parse, re
config = json.loads(${JSON.stringify(JSON.stringify(settings))})
report = {}
def request(endpoint, params):
    try:
        url = 'https://qyapi.weixin.qq.com/cgi-bin/' + endpoint + '?' + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=12) as response:
            return json.load(response)
    except Exception:
        return {'errcode': -1}
result = request('gettoken', {'corpid': config['corpId'], 'corpsecret': config['secret']})
token = result.get('access_token')
report['tokenVerified'] = result.get('errcode') == 0 and bool(token)
if report['tokenVerified']:
    checks = [('application', 'agent/get', {'agentid': config['agentId']}, None), ('departments', 'department/list', {'id': 1}, 'department'), ('members', 'user/list', {'department_id': 1, 'fetch_child': 1}, 'userlist')]
    for label, endpoint, params, field in checks:
        params['access_token'] = token
        data = request(endpoint, params)
        entry = {'ok': data.get('errcode') == 0, 'errcode': data.get('errcode')}
        if entry['ok'] and field: entry['visibleCount'] = len(data.get(field, []))
        if entry['ok'] and label == 'application':
            entry['agentMatches'] = str(data.get('agentid')) == config['agentId']
            entry['redirectDomain'] = data.get('redirect_domain')
        if data.get('errcode') == 60020:
            message = data.get('errmsg', '').lower()
            entry['reason'] = 'approval_required' if 'no approval auth' in message else ('ip_not_allowed' if 'not allow' in message else 'access_restricted')
            match = re.search(r'from ip: ([0-9.]+)', data.get('errmsg', ''))
            if match: entry['observedEgressIp'] = match.group(1)
        report[label] = entry
else:
    report['errcode'] = result.get('errcode')
print(json.dumps(report))
`;
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=12', `root@${host}`, 'python3', '-'], { input: script, encoding: 'utf8', timeout: 60000 });
if (result.status !== 0) { console.error('服务器企业微信检查失败；未输出请求参数或远端错误正文'); process.exit(1); }
const report = { host, checkedAt: new Date().toISOString(), ...JSON.parse(result.stdout) };
await fs.writeFile(path.resolve(import.meta.dirname, `../../mg-token-one/identity/private/production/wecom-check-${host}.json`), JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.application?.agentMatches) process.exitCode = 1;
