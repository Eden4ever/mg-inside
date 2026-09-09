import { config } from '@vue/test-utils';

config.global.stubs = {
  transition: false,
  'el-icon': true,
};

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => undefined,
});
