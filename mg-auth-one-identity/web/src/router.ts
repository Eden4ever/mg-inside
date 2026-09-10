import { createRouter,createWebHistory } from 'vue-router';
import { loadSession,user } from './session';
import { desktop, usesDesktopAuthentication } from './desktop';
import { identityPresentation } from './presentation';
import { identityAuthorizePath, managementReturnPath } from './navigation';
export const router=createRouter({history:createWebHistory(import.meta.env.BASE_URL),routes:[
  {path:'/login',component:()=>import('./components/Login.vue'),meta:{title:'统一登录',public:true}},
  {path:'/',component:()=>import('./components/Overview.vue'),meta:{title:'管理概览',admin:true}},
  {path:'/admin',component:()=>import('./components/Users.vue'),meta:{title:'员工身份',admin:true}},
  {path:'/applications',component:()=>import('./components/Applications.vue'),meta:{title:'应用授权',admin:true}},
  {path:'/roles',component:()=>import('./components/Roles.vue'),meta:{title:'角色管理',admin:true}},
  {path:'/divisions',component:()=>import('./components/Divisions.vue'),meta:{title:'行政区划管理',admin:true}},
  {path:'/organizations',component:()=>import('./components/Organizations.vue'),meta:{title:'组织机构管理',admin:true}},
  {path:'/scopes',component:()=>import('./components/Scopes.vue'),meta:{title:'范围应用权限',admin:true}},
  {path:'/access-denied',component:()=>import('./components/AccessDenied.vue'),meta:{title:'管理访问受限',foundation:true}},
  {path:'/account',component:()=>import('./components/AccessDenied.vue'),meta:{title:'正在前往个人中心',foundation:true}},
  {path:'/settings',component:()=>import('./components/Settings.vue'),meta:{title:'认证配置',admin:true}},
  {path:'/:pathMatch(.*)*',redirect:'/'},
]});
router.beforeEach(async to=>{
  document.title=to.meta.title ? `${to.meta.title} · ${identityPresentation.name}` : identityPresentation.name;
  if(to.path==='/account'){desktop.openPersonalCenter('/security');return false}
  if(usesDesktopAuthentication&&to.path==='/login'){desktop.login(managementReturnPath(to.query.next));return false}
  const interaction=to.query.interaction;
  if(!usesDesktopAuthentication&&typeof interaction==='string'&&/^[A-Za-z0-9_-]+$/.test(interaction))sessionStorage.setItem('identity-interaction',interaction);
  if(!usesDesktopAuthentication&&(to.query.authPending||to.query.authError))return to.path==='/login'?true:{path:'/login',query:to.query};
  if(to.meta.public)return true;
  try{await loadSession(true)}catch{return {path:'/login',query:{unavailable:'1',next:to.fullPath}}}
  if(!user.value)return {path:'/login',query:{next:to.fullPath}};
  if(!usesDesktopAuthentication&&typeof interaction==='string'&&/^[A-Za-z0-9_-]+$/.test(interaction)){location.assign(`/interaction/${encodeURIComponent(interaction)}`);return false}
  const unifiedNext=!usesDesktopAuthentication&&identityAuthorizePath(sessionStorage.getItem('identity-unified-return'),location.origin);
  if(unifiedNext){sessionStorage.removeItem('identity-unified-return');location.assign(unifiedNext);return false}
  if(!to.meta.foundation&&!user.value.identityAuthorized)return '/access-denied';
  if(to.meta.admin&&!user.value.roles?.some(role=>role.key==='platform-admin')) {
    const scoped=user.value.roles?.some(role=>['division-admin','organization-admin'].includes(role.key||''));
    if(scoped&&to.path==='/')return '/scopes';
    if(!scoped||to.path!=='/scopes')return '/access-denied';
  }
  return true;
});
desktop.configure({onNavigate:async path=>{await router.push(path)}});
router.afterEach(to=>{desktop.setTitle(identityPresentation.name);desktop.routeChanged(to.fullPath)});
