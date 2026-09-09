import type { Component } from 'vue';
import enterpriseLogo from '../../mg-platform/packages/frontend/assets/enterprise-logo.svg';
export const pageComponents: Record<string, () => Promise<{ default: Component }>> = { applications: () => import('./views/Applications.vue') };
export const assets: Record<string, string> = { enterpriseLogo };
