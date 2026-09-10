# 禅道统一身份单点登录扩展

给禅道 22.1 开源版加一个 OIDC 依赖方扩展，让用户从平台免密进入禅道，身份源为统一身份中心 `https://identity.meta-gravity.com`。

不改禅道原始代码，全部文件位于官方扩展目录 `extension/custom/sso/ext/`，禅道升级不覆盖。删除该目录即可完全回滚。

本轮不做单点登出与会话时效同步：禅道会话与平台会话相互独立。

设计、现场事实与流程见 [docs/design.md](docs/design.md)。

## 目录

```
extension/custom/sso/ext/
├── config/mg.php        默认配置（不含密钥）
├── control/mgauthen.php 发起授权，生成 state 与 PKCE
├── control/mglogin.php  授权回调，换令牌、取用户、建会话
└── lang/zh-cn.php       提示文案
```

## 部署前必须完成

1. 在统一身份中心注册禅道客户端，回调地址 `https://pm.meta-gravity.com/index.php?m=sso&f=mgLogin`。
2. 在禅道服务器的 `config/my.php` 追加站点配置，密钥只放服务器，不进仓库：

```php
$config->sso->mg->turnon       = true;
$config->sso->mg->clientID     = '填入 client_id';
$config->sso->mg->clientSecret = '填入 client_secret';
```

3. 账号前提：中心返回的 `preferred_username` 必须在禅道中已存在同名且未删除的账号。扩展不自动建号。
