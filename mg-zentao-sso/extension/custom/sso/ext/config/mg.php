<?php
/**
 * 统一身份单点登录的默认配置。
 * 站点相关的 clientID / clientSecret 不写在这里，放服务器上的 config/my.php，避免进入代码仓库。
 */
$config->sso->mg = new stdclass();
$config->sso->mg->turnon       = false;
$config->sso->mg->issuer       = 'https://identity.meta-gravity.com';
$config->sso->mg->authURL      = 'https://identity.meta-gravity.com/auth';
$config->sso->mg->tokenURL     = 'https://identity.meta-gravity.com/token';
$config->sso->mg->userInfoURL  = 'https://identity.meta-gravity.com/me';
$config->sso->mg->scope        = 'openid profile';
$config->sso->mg->clientID     = '';
$config->sso->mg->clientSecret = '';
/* 回调地址留空则按当前站点根地址自动拼装。 */
$config->sso->mg->redirectURI  = '';
/* 账号映射：按顺序取第一个非空的声明作为禅道账号。
 * zentao_account 由身份中心依据 ZentaoIdentity 绑定下发，是权威来源；
 * preferred_username 仅作回退，平台用户名为空的账号取不到值。 */
$config->sso->mg->accountClaims = array('zentao_account', 'preferred_username');
