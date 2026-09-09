import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './app.module'
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter'
import { AppConfig } from '@/config/configuration'
import { existsSync } from 'fs'
import { join } from 'path'
const express = require('express')

async function bootstrap() {
  // 关闭内置 body 解析器，改为下方统一注册（放大 JSON 上限，适配大上下文客户端）
  const app = await NestFactory.create(AppModule, { bodyParser: false })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      disableErrorMessages: false,
    }),
  )
  app.useGlobalFilters(new HttpExceptionFilter())

  // 放大 JSON 请求体上限（默认 100KB，WorkBuddy 等客户端会携带大上下文）。
  // 须低于宿主 nginx 的 client_max_body_size(64m)，否则网关接受了 nginx 却拒收。
  // 注册在默认解析器之前，先消费 body 即采用 50MB 上限；超限由异常过滤器返回 413。
  const express = require('express')
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ limit: '50mb', extended: true }))

  const config = app.get<AppConfig>('APP_CONFIG', { strict: false })
  // eslint-disable-next-line no-console
  console.log('[bootstrap] config keys:', config ? Object.keys(config) : 'undefined')

  // 静态托管前端构建产物（生产）
  if (config.webDistDir && existsSync(config.webDistDir)) {
    app.use('/', express.static(config.webDistDir))
    // SPA 回退：仅非 /api、非 /v1 的 GET 请求才返回 index.html
    // （/v1 是转发面，其 GET 路由如 /v1/models 必须正常走到 relay 控制器）
    app.use((req: any, res: any, next: any) => {
      if (
        req.method === 'GET' &&
        !req.path.startsWith('/api') &&
        !req.path.startsWith('/v1')
      ) {
        return res.sendFile(join(config.webDistDir, 'index.html'))
      }
      next()
    })
  }

  await app.listen(config.port || 3000)
  // eslint-disable-next-line no-console
  console.log(`MG Gateway 已启动: http://localhost:${config.port || 3000}`)
}

bootstrap()
