import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { AuthService } from './auth';

async function bootstrap() {
  const issuer = process.env.IDENTITY_ISSUER || 'http://127.0.0.1:4200';
  if (process.env.NODE_ENV === 'production' && issuer !== 'https://identity.meta-gravity.com') throw new Error('生产签发方必须为 https://identity.meta-gravity.com');
  process.env.WEB_APP_URL = issuer;
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix('api');
  const server = app.getHttpAdapter().getInstance();
  server.addHook('onRequest', async (req: any, reply: any) => {
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && origin !== issuer)) {
        return reply.code(403).send({ message: '不允许跨站提交认证请求' });
      }
    }
  });
  // 认证页面、Cookie 和接口同源；不允许其他应用跨域读取认证中心的 Session。
  server.addHook('onSend', async (req: any, reply: any, payload: unknown) => {
    const desktopOrigin = process.env.DESKTOP_ORIGIN || 'https://desktop.meta-gravity.com';
    const loginPage = req.url.startsWith('/login') || req.url.startsWith('/interaction');
    reply.header('Content-Security-Policy', `frame-ancestors ${loginPage ? "'none'" : `'self' ${new URL(desktopOrigin).origin}`}`);
    reply.header('Cache-Control', req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store'); reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff'); return payload;
  });
  const { installIdentity } = await import('./oidc.mjs');
  await installIdentity(server, app.get(PrismaService), app.get(AuthService), issuer);
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 4200), process.env.HOST || '127.0.0.1');
}
void bootstrap();
