# Codex Desktop 接入 GPT-6 Astra

Token One 生产环境当前提供的模型标识是 `gpt-6-astra`。Codex Desktop、Codex CLI 和 IDE 共用用户级 Codex 配置；本方案只在本机生成一个可被 Codex 读取的模型目录，并将默认模型切换为 `gpt-6-astra`。网关地址、协议和令牌继续由已有的 CC Switch Token One provider 管理。

## 云端一键配置

已经配置好 CC Switch Token One 的用户，直接执行对应平台的云端入口即可。入口自身包含模型目录模板，不需要安装 Python 或下载其他文件。

Windows PowerShell：

```powershell
irm https://token.meta-gravity.com/codex-gpt6/codex-gpt6-setup.ps1 | iex
```

macOS Terminal：

```bash
curl -fsSL https://token.meta-gravity.com/codex-gpt6/codex-gpt6-setup.sh | bash
```

脚本沿用 CC Switch 中已有的 Token One 地址和鉴权配置，并完成以下操作：

- 写入 `$CODEX_HOME/token-one-gpt6-models.json`；未设置 `CODEX_HOME` 时，Windows 使用 `%USERPROFILE%\.codex`，macOS 使用 `~/.codex`。
- 将用户级 `config.toml` 的默认模型设为 `gpt-6-astra`，并设置本地模型目录路径。
- 设置 `model_catalog_json`，让 Desktop 的模型选择器加载本地模型目录。
- 保留已有的 `model_provider` 和 `[model_providers.*]` 配置，不改写 CC Switch 的地址、协议或鉴权字段。
- 修改前自动生成带 UTC 时间戳的 `.bak.gpt6-*` 备份，并支持重复执行。

脚本不会写入 API key，也不会修改生产服务器。运行前请先在 CC Switch 中完成 Token One provider 配置和连通性测试。

## 启动前检查

1. 确认 CC Switch 已配置 Token One provider，并完全退出 Codex Desktop。
2. 在模型选择器中选择 `GPT-6 Astra`，模型 ID 使用 `gpt-6-astra`。
3. 若使用 Codex CLI，在新会话中运行 `/status`，确认仍使用 CC Switch 的 provider，model 为 `gpt-6-astra`。
4. 先发送一个最小请求，确认模型可用。

如果模型仍未出现，确认 Desktop 与脚本使用的是同一个 `CODEX_HOME`，然后完全退出并重新启动 Desktop。不要直接修改 `models_cache.json`，该文件可能被客户端刷新覆盖。

## 项目内离线执行

如果所在网络不允许直接执行云端入口，也可以直接运行仓库中的 `codex-gpt6-setup.ps1` 或 `codex-gpt6-setup.sh`。两个入口自身包含安装逻辑，不要求 Python；`codex-gpt6-setup.py` 仅作为开发和测试用的可选实现保留。

## 地址与权限

脚本不接收网关地址参数，也不会覆盖 CC Switch 的 provider。测试环境或生产环境需要切换地址时，请直接在 CC Switch 中修改 Token One provider，并重新执行连通性测试；模型权限、计量和路由仍由 Token One 管理。
