import { PrismaClient } from '@prisma/client';
import { syncWeComAvatars } from '../dist/wecom-avatar-sync.js';

// 使用中心原有运行环境。默认预检，--apply 仅写已有绑定账号的 avatarUrl。
const config = { corpId: process.env.WECOM_CORP_ID?.trim(), secret: process.env.WECOM_APP_SECRET?.trim() };
if (!process.env.DATABASE_URL || !config.corpId || !config.secret) throw new Error('请注入中心现有 DATABASE_URL、WECOM_CORP_ID、WECOM_APP_SECRET，勿在命令参数中传入机密');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('仅支持可选参数 --apply');
const prisma = new PrismaClient();
try { console.log(JSON.stringify(await syncWeComAvatars(prisma, config, process.argv.includes('--apply')))); }
catch { console.error('头像补齐未完成，未成功读取的用户继续保留原头像。请检查配置与网络后重试。'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
