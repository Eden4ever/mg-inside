<?php
/**
 * 统一身份单点登录：授权回调。
 *
 * 校验 state，用授权码换令牌，取用户信息，按账号映射到已有禅道账号并建立会话。
 * 不自动建号、不按姓名认领、不从中心提升权限，与平台侧既有的禅道认证策略保持一致。
 */
class mySso extends sso
{
    public function mgLogin()
    {
        $this->app->loadConfig('sso');
        $mg = $this->config->sso->mg;
        if(empty($mg->turnon) or empty($mg->clientID) or empty($mg->clientSecret)) return $this->showError($this->lang->sso->mg->notConfigured);

        $code          = isset($_GET['code'])  ? (string)$this->get->code  : '';
        $state         = isset($_GET['state']) ? (string)$this->get->state : '';
        $expectedState = (string)$this->session->mgSsoState;
        $verifier      = (string)$this->session->mgSsoVerifier;
        $referer       = (string)$this->session->mgSsoReferer;

        /* 一次性使用，无论成败都清掉，避免重放。 */
        $this->session->set('mgSsoState', '');
        $this->session->set('mgSsoVerifier', '');
        $this->session->set('mgSsoReferer', '');

        if(empty($code) or empty($state) or empty($expectedState) or empty($verifier)) return $this->showError($this->lang->sso->mg->badCallback);
        if(!hash_equals($expectedState, $state)) return $this->showError($this->lang->sso->mg->stateMismatch);

        $token = $this->mgExchangeToken($code, $verifier);
        if(empty($token)) return $this->showError($this->lang->sso->mg->tokenFailed);

        $profile = $this->mgFetchUserInfo($token);
        if(empty($profile)) return $this->showError($this->lang->sso->mg->userInfoFailed);

        $account = '';
        foreach($this->config->sso->mg->accountClaims as $claim)
        {
            if(empty($profile->$claim)) continue;
            $account = trim((string)$profile->$claim);
            if($account !== '') break;
        }
        if($account === '') return $this->showError($this->lang->sso->mg->noAccountClaim);

        $user = $this->dao->select('*')->from(TABLE_USER)->where('account')->eq($account)->andWhere('deleted')->eq('0')->fetch();
        if(empty($user)) return $this->showError(sprintf($this->lang->sso->mg->userNotBound, htmlspecialchars($account)));

        $this->session->set('rand', '');
        $user = $this->loadModel('user')->identify($user->account, $user->password);
        if(empty($user)) return $this->showError(sprintf($this->lang->sso->mg->userNotBound, htmlspecialchars($account)));
        $this->user->login($user);

        if(!empty($referer)) return $this->locate($referer);
        return $this->locate($this->createLink('my', 'index'));
    }

    /**
     * 用授权码换取访问令牌。后端直连中心，client_secret 不经过浏览器。
     */
    protected function mgExchangeToken($code, $verifier)
    {
        $mg     = $this->config->sso->mg;
        $params = array(
            'grant_type'    => 'authorization_code',
            'code'          => $code,
            'redirect_uri'  => $this->mgRedirectURI(),
            'client_id'     => $mg->clientID,
            'client_secret' => $mg->clientSecret,
            'code_verifier' => $verifier,
        );
        /* 第五参数 data 表示按表单编码提交，第六参数为方法，第七参数为超时秒数。 */
        $result = common::http($mg->tokenURL, $params, array(), array('Accept: application/json'), 'data', 'POST', 20);
        if(empty($result)) return '';

        $data = json_decode($result);
        if(empty($data) or empty($data->access_token)) return '';
        return (string)$data->access_token;
    }

    /**
     * 用访问令牌取用户信息。
     */
    protected function mgFetchUserInfo($token)
    {
        $mg     = $this->config->sso->mg;
        /* userinfo 必须用 GET，默认方法是 POST，这里显式指定。 */
        $result = common::http($mg->userInfoURL, null, array(), array('Accept: application/json', "Authorization: Bearer {$token}"), 'data', 'GET', 20);
        if(empty($result)) return null;

        $data = json_decode($result);
        return empty($data) ? null : $data;
    }

    protected function mgRedirectURI()
    {
        $configured = $this->config->sso->mg->redirectURI;
        if(!empty($configured)) return $configured;
        return rtrim(common::getSysURL() . $this->config->webRoot, '/') . '/index.php?m=sso&f=mgLogin';
    }
}
