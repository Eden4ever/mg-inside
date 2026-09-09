import type { Component } from 'vue';
import enterpriseLogo from '../../mg-platform/packages/frontend/assets/enterprise-logo.svg';
export const pageComponents: Record<string, () => Promise<{default: Component}>> = { files: () => import('./views/Files.vue') };
export const assets = { enterpriseLogo };
