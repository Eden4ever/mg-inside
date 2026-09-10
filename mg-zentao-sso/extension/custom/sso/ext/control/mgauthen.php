<?php
/**
 * 统一身份单点登录：发起授权。
 *
 * 生成 state 与 PKCE code_verifier 存入服务端会话，再跳转到中心的授权端点。
 * 文件名必须是小写方法名，框架按 extension/custom/sso/ext/control/<方法名>.php 查找并替代 control.php 引入。
 */
class mySso extends sso
{
    public function mgAuthen()
    {
        $this->app->loadConfig('sso');
        $mg = $this->config->sso->mg;
        if(empty($mg->turnon) or empty($mg->clientID) or empty($mg->clientSecret)) return $this->showError($this->lang->sso->mg->notConfigured);

        $verifier  = rtrim(strtr(base64_encode(random_bytes(48)), '+/', '-_'), '=');
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $state     = rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');

        $this->session->set('mgSsoState', $state);
        $this->session->set('mgSsoVerifier', $verifier);
        /* 登录后要回到的地址，仅接受站内路径，避免被构造成开放重定向。 */
        $referer = empty($_GET['referer']) ? '' : base64_decode($this->get->referer);
        $this->session->set('mgSsoReferer', $this->mgSafeReferer($referer));

        $query = http_build_query(array(
            'client_id'             => $mg->clientID,
            'response_type'         => 'code',
            'scope'                 => $mg->scope,
            'redirect_uri'          => $this->mgRedirectURI(),
            'state'                 => $state,
            'code_challenge'        => $challenge,
            'code_challenge_method' => 'S256',
        ));
        return $this->locate($mg->authURL . '?' . $query);
    }

    /**
     * 回调地址：配置了就用配置的，否则按当前站点根地址拼装。
     */
    protected function mgRedirectURI()
    {
        $configured = $this->config->sso->mg->redirectURI;
        if(!empty($configured)) return $configured;
        return rtrim(common::getSysURL() . $this->config->webRoot, '/') . '/index.php?m=sso&f=mgLogin';
    }

    /**
     * 只允许跳回本站路径，拒绝绝对地址与协议相对地址。
     */
    protected function mgSafeReferer($referer)
    {
        if(empty($referer) or !is_string($referer)) return '';
        if(strpos($referer, '//') === 0) return '';
        if(preg_match('/^[a-zA-Z][a-zA-Z0-9+.-]*:/', $referer)) return '';
        if(strpos($referer, '/') !== 0) return '';
        return $referer;
    }
}
