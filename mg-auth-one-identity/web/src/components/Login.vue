<script setup lang="ts">
import { onMounted,reactive,ref } from 'vue';
import { useRoute,useRouter } from 'vue-router';
import { User,Lock,ArrowRight,Key } from '@element-plus/icons-vue';
import { startAuthentication } from '@simplewebauthn/browser';
import { api,request,send,setCsrf } from '../api/client';
import { acceptLogin,loadSession,user } from '../session';
import logo from '../assets/logo.svg';
import wecomLogo from '../assets/wecom.svg';
import { identityPresentation } from '../presentation';
import { identityAuthorizePath, managementReturnPath } from '../navigation';
const route=useRoute(),router=useRouter();
const source=ref('local'),busy=ref(false),error=ref(''),state=ref('login');
const providers=reactive({wecom:false,zentao:false,loaded:false});
const form=reactive({username:'',password:'',confirm:'',code:'',method:'totp'});const methods=ref<string[]>([]);
function changeSource(){form.username='';form.password='';error.value=''}
async function complete(result:any){
  form.password='';form.code='';
  if(['mfa_required','setup_required'].includes(result.state)){
    const pending=await request('/auth/pending');setCsrf(pending.csrfToken);state.value=pending.state;
    if(pending.state==='setup_required')form.username=pending.username||'';
    else{methods.value=pending.methods;form.method=pending.methods[0]||'recovery'}
    return;
  }
  acceptLogin(result);
  const unifiedNext=identityAuthorizePath(route.query.next||sessionStorage.getItem('identity-unified-return'),location.origin);
  if(unifiedNext){sessionStorage.removeItem('identity-unified-return');location.assign(unifiedNext);return}
  const interaction=sessionStorage.getItem('identity-interaction');
  if(interaction&&/^[A-Za-z0-9_-]+$/.test(interaction)){sessionStorage.removeItem('identity-interaction');location.assign(`/interaction/${interaction}`);return}
  await router.replace(managementReturnPath(route.query.next));
}
async function submit(){
  if(busy.value)return;busy.value=true;error.value='';
  try{
    if(state.value==='setup_required'){
      if(form.password!==form.confirm)throw new Error('两次密码不一致');
      await complete(await send('/auth/setup',{username:form.username,password:form.password}));
    }else if(state.value==='mfa_required'){
      const code=form.method==='key'?await startAuthentication({optionsJSON:await api.mfaKeyOptions()}):form.code;
      await complete(await send('/auth/mfa',{method:form.method,code}));
    }else await complete(await send(source.value==='zentao'?'/auth/zentao/login':'/auth/login',{username:form.username,password:form.password}));
  }catch(e){error.value=(e as Error).message}finally{busy.value=false;form.password='';form.confirm='';form.code=''}
}
async function scan(){if(busy.value)return;busy.value=true;error.value='';try{const interaction=sessionStorage.getItem('identity-interaction');const result=await send('/auth/wecom/start',{returnTo:interaction&&/^[A-Za-z0-9_-]+$/.test(interaction)?`/interaction/${interaction}`:'/'});location.assign(result.loginUrl)}catch(e){error.value=(e as Error).message;busy.value=false}}
async function email(){if(busy.value)return;busy.value=true;try{await api.sendMfaEmail();error.value='验证码已发送，请检查邮箱'}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
onMounted(async()=>{
  const unifiedNext=identityAuthorizePath(route.query.next,location.origin);
  if(unifiedNext)sessionStorage.setItem('identity-unified-return',unifiedNext);
  if(route.query.expired)error.value='登录已失效，请重新登录';if(route.query.authError)error.value='认证未完成，请重试或联系管理员';
  try{const [wecom,zentao]=await Promise.all([request('/auth/wecom/status'),request('/auth/zentao/status')]);providers.wecom=wecom.enabled;providers.zentao=zentao.enabled;providers.loaded=true}catch{error.value='暂时无法读取登录配置，请稍后重试'}
  try{if(route.query.authPending){await complete({state:'mfa_required'});return}await loadSession(true);if(user.value)await complete(await request('/auth/me'))}catch{error.value='统一认证服务暂时不可用，请稍后重试'}
});
</script>
<template>
  <main class="login-page"><div class="login-content">
    <section class="login-card">
      <div class="login-brand-block"><div class="login-brand"><img :src="logo" alt="元引"/><h1>{{identityPresentation.name}}</h1></div><p class="login-brand-subtitle">安全登录企业应用</p></div>
      <header v-if="state!=='login'"><h2>{{state==='mfa_required'?'验证你的身份':'完善统一账号'}}</h2><p>{{state==='mfa_required'?'完成二次验证，继续安全访问':'设置统一登录账号和密码，供各应用通用'}}</p></header>
      <el-tabs v-if="state==='login'" v-model="source" stretch @tab-change="changeSource"><el-tab-pane label="账号密码" name="local"/><el-tab-pane label="禅道账号" name="zentao"/></el-tabs>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon/>
      <el-alert v-if="state==='login'&&source==='zentao'&&providers.loaded&&!providers.zentao" title="当前环境尚未启用禅道认证" type="info" :closable="false"/>
      <el-form label-position="top" class="login-form" @submit.prevent="submit">
        <template v-if="state!=='mfa_required'"><el-form-item :label="source==='zentao'&&state==='login'?'禅道账号':'登录账号'"><el-input v-model="form.username" :prefix-icon="User" autocomplete="username" size="large" maxlength="50" :disabled="busy" placeholder="请输入账号"/></el-form-item><el-form-item :label="state==='setup_required'?'设置密码':'登录密码'"><el-input v-model="form.password" :prefix-icon="Lock" type="password" show-password :autocomplete="state==='setup_required'?'new-password':'current-password'" size="large" maxlength="128" :disabled="busy" :placeholder="state==='setup_required'?'至少 15 位字符':'请输入密码'"/></el-form-item><el-form-item v-if="state==='setup_required'" label="确认密码"><el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" size="large" :disabled="busy"/></el-form-item></template>
        <template v-else><el-form-item label="验证方式"><el-select v-model="form.method" :disabled="busy" class="full-width"><el-option v-if="methods.includes('totp')" label="认证器" value="totp"/><el-option v-if="methods.includes('email')" label="邮箱" value="email"/><el-option v-if="methods.includes('key')" label="安全密钥" value="key"/><el-option label="恢复码" value="recovery"/></el-select></el-form-item><el-form-item v-if="form.method!=='key'" :label="form.method==='recovery'?'恢复码':'验证码'"><el-input v-model="form.code" :prefix-icon="Key" autocomplete="one-time-code" size="large" :maxlength="form.method==='recovery'?32:6" :disabled="busy"/><el-button v-if="form.method==='email'" link type="primary" :disabled="busy" @click="email">发送邮箱验证码</el-button></el-form-item></template>
        <el-button class="login-submit" native-type="submit" type="primary" size="large" :loading="busy" :disabled="state==='login'&&source==='zentao'&&!providers.zentao">{{state==='login'?'登 录':'验证并继续'}}<el-icon><ArrowRight/></el-icon></el-button>
      </el-form>
      <template v-if="state==='login'"><el-divider>或使用企业微信</el-divider><el-button class="wecom-button" size="large" :disabled="!providers.wecom||busy" @click="scan"><img :src="wecomLogo" alt=""/>企业微信扫码登录</el-button><p class="login-note">{{providers.wecom?'在企业微信官方页面安全扫码':'当前环境未启用企业微信扫码'}}</p></template>
      <el-button v-else link @click="state='login';form.password='';form.code='';error=''">返回登录</el-button>
    </section>
  </div><footer class="login-footer">© 2026 郑州元引信息科技有限公司</footer></main>
</template>

