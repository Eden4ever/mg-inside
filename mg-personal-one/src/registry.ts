import type { Component } from 'vue';

/** 仅允许显式注册的组件；JSON 字符串不能拼接模块路径。 */
export const pageComponents: Record<string, () => Promise<{ default: Component }>> = {
  profile: () => import('./views/Profile.vue'),
  security: () => import('./views/Security.vue'),
  preferences: () => import('./views/Preferences.vue'),
  notifications: () => import('./views/Notifications.vue'),
};

import enterpriseLogo from '../../mg-platform/packages/frontend/assets/enterprise-logo.svg';
import { applicationIcons } from '@mg-inside/frontend/assets';
const personalIcon = applicationIcons['personal-center']!.src;
export const assets: Record<string, string> = { enterpriseLogo, personalIcon };
