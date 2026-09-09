<template>
  <article class="doc-page">
    <nav class="doc-breadcrumb" aria-label="页面路径">文档 / 接入与支持 / 错误排查</nav>
    <h1>错误排查</h1>
    <p class="doc-lead">网关错误使用标准 HTTP 状态码，并尽量返回可以直接定位问题的说明。不要在客户端日志或截图中暴露完整令牌。</p>
    <section id="status-codes"><h2>常见状态码</h2><div class="doc-table-wrap"><table><colgroup><col style="width: 20%" /><col style="width: 35%" /><col /></colgroup><thead><tr><th scope="col">状态</th><th scope="col">原因</th><th scope="col">处理方式</th></tr></thead><tbody><tr><th scope="row"><code>400</code></th><td>请求格式错误，或模型不支持图片输入</td><td>检查 <code>model</code>、<code>messages</code> 和模型能力。</td></tr><tr><th scope="row"><code>401</code></th><td>令牌无效、过期或已禁用</td><td>重新复制 <code>sk-</code> 令牌并确认状态。</td></tr><tr><th scope="row"><code>403</code></th><td>模型不在当前分组权限内</td><td>更换可见模型，或联系管理员调整分组。</td></tr><tr><th scope="row"><code>404</code></th><td>地址或模型名不存在</td><td>确认 Base URL 为 <code>/v1</code>，并核对模型名称。</td></tr><tr><th scope="row"><code>429</code></th><td>额度不足</td><td>查看用量并联系管理员调整额度。</td></tr><tr><th scope="row"><code>502 / 503</code></th><td>上游渠道异常或暂不可用</td><td>稍后重试；持续发生时提交请求时间和请求 ID。</td></tr></tbody></table></div></section>
    <section id="troubleshooting"><h2>排查顺序</h2><ol class="doc-list"><li>先确认域名和网络连通性。</li><li>确认请求地址、Authorization 头和模型名。</li><li>使用非流式请求缩小问题范围，再切换流式。</li><li>提交问题时仅提供时间、状态码、模型和请求 ID，不要提供完整令牌或请求敏感内容。</li></ol></section>
  </article>
</template>
