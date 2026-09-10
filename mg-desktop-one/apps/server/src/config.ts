// 仅保留旧测试的导入位置。生产构建和运行均不得加载此测试目录。
export type { RegisteredApp } from '../../../tests/fixtures/legacy-config';
export { registry, allowsApiPath, publicApp, allowedOrigins, desktopOrigin, identityOrigin, desktopPresentation, essentialApplicationIds } from '../../../tests/fixtures/legacy-config';
