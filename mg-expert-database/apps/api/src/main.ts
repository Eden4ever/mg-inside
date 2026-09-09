import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppModule } from './app.module';

export async function createApiApplication(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }));
  app.setGlobalPrefix('api');
  // 未配置跨域来源时关闭 CORS；同源反向代理不依赖 CORS。
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',').map(value => value.trim()).filter(Boolean) ?? false, credentials: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApiApplication();
  await app.listen(Number(process.env.PORT ?? 4100), process.env.HOST?.trim() || '127.0.0.1');
}

if (require.main === module) void bootstrap();
