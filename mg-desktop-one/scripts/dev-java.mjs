import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const kernel = resolve(root, '../mg-platform-kernel');
const config = process.env.DESKTOP_ENV_FILE || join(root, '.runtime/local/desktop.env');
if (existsSync(config)) loadEnvFile(config);
const runtimeConfig = join(root, '.runtime/local/desktop-runtime.env');
if (!process.env.DESKTOP_ENV_FILE && existsSync(runtimeConfig)) loadEnvFile(runtimeConfig);
const catalogConfig = join(root, '.runtime/local/kernel-catalog.env');
if (!process.env.DESKTOP_ENV_FILE && existsSync(catalogConfig)) loadEnvFile(catalogConfig);
const portable = join(kernel, '.runtime/java-tools');
const jdk = existsSync(portable) ? readdirSync(portable).find(name => name.startsWith('jdk-25')) : null;
const executable = process.platform === 'win32' ? 'java.exe' : 'java';
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', executable)
  : jdk ? join(portable, jdk, 'bin', executable) : executable;
const jar = process.env.DESKTOP_JAR || join(kernel, 'target/mg-platform-kernel-0.1.0-SNAPSHOT.jar');
if (!existsSync(jar)) throw new Error('Build mg-platform-kernel before starting the desktop backend.');
const child = spawn(java, ['-jar', jar], { cwd: root, env: process.env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
