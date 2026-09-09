import fs from 'node:fs/promises';
import path from 'node:path';
// 只输出状态码和数量，不输出上游响应正文、Token、Secret 或员工信息。
const report = { checkedAt: new Date().toISOString(), zentao: {}, wecom: {} };
async function json(url) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { failed: true, httpStatus: response.status };
    const body = await response.json();
    return { body, httpStatus: response.status };
  } catch { return { failed: true, networkError: true }; }
}
const zentao = process.env.ZENTAO_BASE_URL;
if (zentao) {
  try {
    const url = new URL(zentao);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    const response = await fetch(`${url.href.replace(/\/$/, '')}/api.php/v1/user`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    report.zentao = { httpsReachable: true, unauthenticatedUserStatus: response.status, expectedUnauthorized: response.status === 401 };
  } catch { report.zentao = { httpsReachable: false }; }
}
const corpId = process.env.WECOM_CORP_ID;
const secret = process.env.WECOM_APP_SECRET;
const agentId = process.env.WECOM_AGENT_ID;
if (!corpId || !secret || !agentId) report.wecom = { configured: false };
else {
  const tokenUrl = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken');
  tokenUrl.search = new URLSearchParams({ corpid: corpId, corpsecret: secret }).toString();
  const result = await json(tokenUrl);
  const token = result.body?.access_token;
  if (result.failed || result.body?.errcode !== 0 || typeof token !== 'string') {
    report.wecom = { configured: true, tokenVerified: false, ...(result.networkError ? { networkError: true } : {}), httpStatus: result.httpStatus, errcode: result.body?.errcode };
  } else {
    report.wecom = { configured: true, tokenVerified: true };
    for (const [label, pathname, params, field] of [
      ['application', 'agent/get', { agentid: agentId }, null],
      ['departments', 'department/list', { id: '1' }, 'department'],
      ['members', 'user/list', { department_id: '1', fetch_child: '1' }, 'userlist'],
    ]) {
      const url = new URL(`https://qyapi.weixin.qq.com/cgi-bin/${pathname}`);
      url.search = new URLSearchParams({ access_token: token, ...params }).toString();
      const response = await json(url);
      const ok = !response.failed && response.body?.errcode === 0;
      report.wecom[label] = { ok, httpStatus: response.httpStatus, errcode: response.body?.errcode };
      if (response.body?.errcode === 60020) {
        const message = String(response.body.errmsg || '').toLowerCase();
        report.wecom[label].reason = message.includes('no approval auth') ? 'approval_required' : message.includes('not allow') ? 'ip_not_allowed' : 'access_restricted';
      }
      if (ok && field) report.wecom[label].visibleCount = Array.isArray(response.body[field]) ? response.body[field].length : 0;
      if (ok && label === 'application') report.wecom[label].agentMatches = String(response.body.agentid) === agentId;
    }
  }
}
const file = path.resolve(import.meta.dirname, '../../mg-token-one/identity/private/production/provider-check.json');
await fs.writeFile(file, JSON.stringify(report, null, 2), { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!report.zentao.expectedUnauthorized || !report.wecom.tokenVerified || !report.wecom.application?.agentMatches) process.exitCode = 1;
