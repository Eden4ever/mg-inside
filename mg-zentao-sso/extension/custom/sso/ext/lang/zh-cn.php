<?php
/**
 * 统一身份单点登录的提示文案。
 */
$lang->sso->mg = new stdclass();
$lang->sso->mg->entry          = '统一身份登录';
$lang->sso->mg->notConfigured  = '统一身份登录尚未配置，请联系管理员。';
$lang->sso->mg->badCallback    = '登录回调参数不完整，请重新发起登录。';
$lang->sso->mg->stateMismatch  = '登录状态校验失败，请重新发起登录。';
$lang->sso->mg->tokenFailed    = '与统一身份中心换取令牌失败，请稍后重试。';
$lang->sso->mg->userInfoFailed = '获取统一身份用户信息失败，请稍后重试。';
$lang->sso->mg->noAccountClaim = '统一身份未返回可用的账号标识，请联系管理员。';
$lang->sso->mg->userNotBound   = '禅道中没有账号 %s，或该账号已停用。请联系管理员先在禅道创建并绑定该账号后再登录。';
