import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = resolve(webRoot, '../../../scripts')
const targetRoot = resolve(webRoot, 'public/codex-gpt6')
const files = [
  'codex-gpt6-setup.ps1',
  'codex-gpt6-setup.sh',
]

await mkdir(targetRoot, { recursive: true })
await Promise.all(['codex-gpt6-setup.py', 'codex-gpt6-model.json'].map((file) => rm(resolve(targetRoot, file), { force: true })))
await Promise.all(files.map((file) => copyFile(resolve(sourceRoot, file), resolve(targetRoot, file))))
console.log(`已同步 GPT-6 Astra 云端脚本：${targetRoot}`)
