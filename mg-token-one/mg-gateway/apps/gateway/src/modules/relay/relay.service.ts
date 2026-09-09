import { Inject, Injectable } from '@nestjs/common'
import { Request, Response } from 'express'
import { isIP } from 'net'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ModelConfig } from '@/entities/model-config.entity'
import { GatewayTokenInfo } from '@/common/middleware/token-auth.middleware'
import { AppConfig } from '@/config/configuration'
import { RelayProtocol } from '@/common/utils/upstream-protocol.util'
import { ModelGroupService } from '@/modules/group/model-group.service'
import { ChannelPoolService, PickedChannel } from './channel-pool.service'
import { ChatCompletionsTransport } from './chat-completions-transport'
import { NativeResponsesTransport } from './native-responses-transport'
import { AnthropicMessagesTransport } from './anthropic-messages-transport'
import { RelayExecutor, RelayTransportResult } from './relay-executor'
import {
  RelayAccounting,
  RelayAccountingContext,
} from './relay-accounting'

interface RelayContext {
  accounting: RelayAccountingContext
  model: string
  modelConfig: ModelConfig
}

@Injectable()
export class RelayService {
  constructor(
    private readonly pool: ChannelPoolService,
    private readonly accounting: RelayAccounting,
    @InjectRepository(ModelConfig)
    private readonly modelRepo: Repository<ModelConfig>,
    private readonly modelGroups: ModelGroupService,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
    private readonly chatTransport: ChatCompletionsTransport,
    private readonly nativeResponses: NativeResponsesTransport,
    private readonly nativeAnthropic: AnthropicMessagesTransport,
    private readonly executor: RelayExecutor,
  ) {}

  async listModels(info?: GatewayTokenInfo): Promise<any> {
    const models = await this.modelRepo.find({ where: { status: 1 } })
    const groupNamesByModel = await this.modelGroups.groupNamesByModel(models)
    const visible = models.filter((model) =>
      this.canAccess(model, info, groupNamesByModel.get(model.name) || []),
    )
    return {
      object: 'list',
      data: visible.map((model) => {
        // 能力字段描述模型本身的协议支持；availability 描述当前静态路由池。
        // 两者必须保持独立：模型支持 Responses 不代表当前一定有可路由渠道。
        const availableProtocols = {
          chat: this.pool.hasModel(model.name, 'chat'),
          responses: this.pool.hasModel(model.name, 'responses'),
          anthropic: this.pool.hasModel(model.name, 'anthropic'),
        }
        return {
          id: model.name,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'mg-gateway',
          context_length: model.contextLength || 0,
          max_output_tokens: model.maxOutputTokens || 0,
          supports_vision: model.supportsVision === 1,
          supports_tools: model.supportsTools === 1,
          supports_reasoning: model.supportsReasoning === 1,
          supports_responses: model.supportsResponses === 1,
          supports_anthropic: model.supportsAnthropic === 1,
          available_protocols: availableProtocols,
          available_responses: availableProtocols.responses,
          available_anthropic: availableProtocols.anthropic,
          reasoning_efforts: model.reasoningEfforts || null,
          modalities: {
            input: model.inputModalities || ['text'],
            output: model.outputModalities || ['text'],
          },
          capabilities: {
            vision: model.supportsVision === 1,
            function_calling: model.supportsTools === 1,
            reasoning: model.supportsReasoning === 1,
            responses_api: model.supportsResponses === 1,
            anthropic_messages_api: model.supportsAnthropic === 1,
            available_protocols: availableProtocols,
            available_responses: availableProtocols.responses,
            available_anthropic: availableProtocols.anthropic,
            context_length: model.contextLength || 0,
          },
        }
      }),
    }
  }

  async listAnthropicModels(
    info?: GatewayTokenInfo,
    query: { beforeId?: string; afterId?: string; limit?: string } = {},
  ): Promise<any> {
    const models = await this.modelRepo.find({
      where: { status: 1 },
      order: { id: 'ASC' },
    })
    const groupNamesByModel = await this.modelGroups.groupNamesByModel(models)
    let visible = models.filter(
      (model) =>
        model.supportsAnthropic === 1 &&
        this.canAccess(model, info, groupNamesByModel.get(model.name) || []),
    )
    if (query.afterId) {
      const index = visible.findIndex((model) => model.name === query.afterId)
      if (index >= 0) visible = visible.slice(index + 1)
    } else if (query.beforeId) {
      const index = visible.findIndex((model) => model.name === query.beforeId)
      if (index >= 0) visible = visible.slice(0, index)
    }
    const requestedLimit = Number.parseInt(query.limit || '20', 10)
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(1, requestedLimit))
      : 20
    const page = visible.slice(0, limit)
    return {
      data: page.map((model) => ({
        type: 'model',
        id: model.name,
        display_name: model.name,
        created_at: model.createdAt?.toISOString?.() || new Date(0).toISOString(),
      })),
      has_more: visible.length > page.length,
      first_id: page[0]?.name || null,
      last_id: page[page.length - 1]?.name || null,
    }
  }

  async chatCompletions(
    body: any,
    req: Request,
    res: Response,
    info: GatewayTokenInfo,
  ) {
    const context = await this.prepareContext(
      body,
      req,
      res,
      info,
      body?.max_tokens || body?.max_completion_tokens || 1024,
      'chat',
    )
    if (!context) return

    if (this.containsImage(body?.messages) && context.modelConfig.supportsVision !== 1) {
      const hint = context.modelConfig.visionNotes
        ? `（${context.modelConfig.visionNotes}）`
        : '请改用支持视觉的模型'
      const message = `模型 ${context.model} 不支持图片/多模态输入${hint}`
      await this.accounting.fail(context.accounting, {
        code: 'vision_not_supported',
        message,
        isStream: !!body.stream,
      })
      return this.sendOpenAIError(
        res,
        400,
        'vision_not_supported',
        message,
      )
    }

    return this.executeProtocol({
      protocol: 'chat',
      context,
      res,
      isStream: !!body.stream,
      noChannel: {
        status: 503,
        code: 'no_channel',
        message: '当前无可用 Chat 渠道',
      },
      transportErrorMessage: '上游 Chat API 错误',
      forward: (picked) =>
        this.chatTransport.forward({
          picked,
          body,
          res,
          isStream: !!body.stream,
          startTs: context.accounting.startTs,
          estimateUsage: this.config.relay.enableLocalUsageEstimate,
        }),
    })
  }

  async responses(
    body: any,
    req: Request,
    res: Response,
    info: GatewayTokenInfo,
  ) {
    const context = await this.prepareContext(
      body,
      req,
      res,
      info,
      body?.max_output_tokens || body?.max_tokens || 1024,
      'responses',
    )
    if (!context) return

    return this.executeProtocol({
      protocol: 'responses',
      context,
      res,
      isStream: !!body.stream,
      noChannel: {
        status: 503,
        code: 'no_responses_channel',
        message: '当前无可用的原生 Responses 渠道',
      },
      transportErrorMessage: '上游 Responses API 错误',
      forward: (picked) =>
        this.nativeResponses.forward({
          picked,
          body,
          res,
          isStream: !!body.stream,
          startTs: context.accounting.startTs,
          requestHeaders: req.headers as Record<string, string | string[] | undefined>,
        }),
    })
  }

  async anthropicMessages(
    body: any,
    req: Request,
    res: Response,
    info: GatewayTokenInfo,
  ) {
    const context = await this.prepareContext(
      body,
      req,
      res,
      info,
      body?.max_tokens || 1024,
      'anthropic',
    )
    if (!context) return

    if (this.containsImage(body?.messages) && context.modelConfig.supportsVision !== 1) {
      const hint = context.modelConfig.visionNotes
        ? `（${context.modelConfig.visionNotes}）`
        : '请改用支持视觉的模型'
      const message = `模型 ${context.model} 不支持图片/多模态输入${hint}`
      await this.accounting.fail(context.accounting, {
        code: 'vision_not_supported',
        message,
        isStream: !!body?.stream,
      })
      return this.sendAnthropicError(res, 400, 'vision_not_supported', message)
    }

    return this.executeProtocol({
      protocol: 'anthropic',
      context,
      res,
      isStream: !!body?.stream,
      noChannel: {
        status: 529,
        code: 'no_anthropic_channel',
        message: '当前无可用的原生 Anthropic 渠道',
      },
      transportErrorMessage: '上游 Anthropic API 错误',
      forward: (picked) =>
        this.nativeAnthropic.forward({
          picked,
          body,
          res,
          isStream: !!body?.stream,
          startTs: context.accounting.startTs,
          requestHeaders: req.headers as Record<string, string | string[] | undefined>,
        }),
    })
  }

  private async executeProtocol(input: {
    protocol: RelayProtocol
    context: RelayContext
    res: Response
    isStream: boolean
    noChannel: { status: number; code: string; message: string }
    transportErrorMessage: string
    forward: (picked: PickedChannel) => Promise<RelayTransportResult>
  }) {
    const { protocol, context, res, isStream } = input
    const execution = await this.executor.execute({
      protocol,
      model: context.model,
      forward: input.forward,
      canRetry: () => !res.headersSent,
    })

    if (execution.kind === 'success') {
      await this.finalizeSuccess(
        res,
        context,
        execution.picked,
        execution.result.usage.inputTokens,
        execution.result.usage.cachedTokens,
        execution.result.usage.outputTokens,
        execution.result.usage.totalTokens,
        isStream,
        execution.result.usage.estimated === true,
        execution.result.firstTokenMs,
        execution.attempt,
      )
      return
    }

    if (execution.kind === 'no_channel') {
      await this.accounting.fail(context.accounting, {
        code: input.noChannel.code,
        message: input.noChannel.message,
        responseStatus: input.noChannel.status,
        isStream,
        retryCount: execution.attempt,
      })
      return this.sendProtocolError(
        res,
        protocol,
        input.noChannel.status,
        input.noChannel.code,
        input.noChannel.message,
      )
    }

    if (execution.kind === 'client_abort') {
      await this.accounting.fail(context.accounting, {
        code: 'client_disconnected',
        message: '客户端在响应完成前断开连接',
        picked: execution.picked,
        isStream,
        retryCount: execution.attempt,
        partial: res.headersSent,
      })
      return
    }

    if (execution.kind === 'upstream_error') {
      const message = this.upstreamErrorMessage(
        execution.result.body,
        execution.result.status,
      )
      await this.accounting.fail(context.accounting, {
        code: 'upstream_error',
        message,
        responseStatus: execution.result.status,
        picked: execution.picked,
        isStream,
        retryCount: execution.attempt,
        partial: res.headersSent,
      })
      return this.sendUpstreamError(
        res,
        protocol,
        execution.result.status,
        execution.result.body,
        execution.result.contentType,
        execution.result.requestId,
      )
    }

    const message = execution.error instanceof Error && execution.error.message
      ? execution.error.message
      : input.transportErrorMessage
    await this.accounting.fail(context.accounting, {
      code: 'upstream_error',
      message,
      responseStatus: 502,
      picked: execution.picked,
      isStream,
      retryCount: execution.attempt,
      partial: res.headersSent,
    })
    return this.sendProtocolError(res, protocol, 502, 'upstream_error', message)
  }

  private async prepareContext(
    body: any,
    req: Request,
    res: Response,
    info: GatewayTokenInfo,
    maxOutputTokens: number,
    protocol: RelayProtocol,
  ): Promise<RelayContext | null> {
    const accounting = this.accounting.begin({
      protocol,
      info,
      model: body?.model,
      clientIp: this.getClientIp(req),
    })
    const model = typeof body?.model === 'string' ? body.model.trim() : ''
    if (!model) {
      await this.accounting.fail(accounting, {
        code: 'invalid_request_error',
        message: 'model 必填',
        isStream: !!body?.stream,
      })
      this.sendProtocolError(res, protocol, 400, 'invalid_request_error', 'model 必填')
      return null
    }
    const modelConfig = await this.modelRepo.findOne({ where: { name: model } })
    if (!modelConfig || modelConfig.status !== 1) {
      await this.accounting.fail(accounting, {
        code: 'model_not_found',
        message: `模型 ${model} 未配置`,
        isStream: !!body?.stream,
      })
      this.sendProtocolError(res, protocol, 404, 'model_not_found', `模型 ${model} 未配置`)
      return null
    }
    if (protocol === 'responses' && modelConfig.supportsResponses !== 1) {
      await this.accounting.fail(accounting, {
        code: 'responses_not_supported',
        message: `模型 ${model} 未启用原生 Responses API`,
        isStream: !!body?.stream,
      })
      this.sendResponsesError(
        res,
        400,
        'responses_not_supported',
        `模型 ${model} 未启用原生 Responses API`,
      )
      return null
    }
    if (protocol === 'anthropic' && modelConfig.supportsAnthropic !== 1) {
      await this.accounting.fail(accounting, {
        code: 'anthropic_not_supported',
        message: `模型 ${model} 未启用原生 Anthropic Messages API`,
        isStream: !!body?.stream,
      })
      this.sendAnthropicError(
        res,
        400,
        'anthropic_not_supported',
        `模型 ${model} 未启用原生 Anthropic Messages API`,
      )
      return null
    }
    const modelGroups = await this.modelGroups.groupNamesForModel(modelConfig)
    if (!this.canAccess(modelConfig, info, modelGroups)) {
      await this.accounting.fail(accounting, {
        code: 'forbidden',
        message: `无权访问模型 ${model}（不在你的分组权限内）`,
        isStream: !!body?.stream,
      })
      this.sendProtocolError(
        res,
        protocol,
        403,
        'forbidden',
        `无权访问模型 ${model}（不在你的分组权限内）`,
      )
      return null
    }
    if (!this.pool.hasModel(model, protocol)) {
      const code = protocol === 'responses'
        ? 'no_responses_channel'
        : protocol === 'anthropic'
          ? 'no_anthropic_channel'
          : 'no_channel'
      const message = protocol === 'responses'
        ? `模型 ${model} 没有可用的原生 Responses 渠道`
        : protocol === 'anthropic'
          ? `模型 ${model} 没有可用的原生 Anthropic 渠道`
          : `模型 ${model} 没有可用的 Chat 渠道`
      const status = protocol === 'anthropic' ? 529 : 503
      await this.accounting.fail(accounting, {
        code,
        message,
        isStream: !!body?.stream,
      })
      this.sendProtocolError(
        res,
        protocol,
        status,
        code,
        message,
      )
      return null
    }

    if (!(await this.accounting.reserve(accounting, modelConfig, maxOutputTokens))) {
      await this.accounting.fail(accounting, {
        code: 'quota_exceeded',
        message: '额度不足',
        isStream: !!body?.stream,
      })
      this.sendProtocolError(res, protocol, 429, 'quota_exceeded', '额度不足')
      return null
    }
    return {
      accounting,
      model,
      modelConfig,
    }
  }

  private canAccess(
    model: ModelConfig,
    info?: GatewayTokenInfo,
    modelGroups: string[] = [],
  ): boolean {
    if (!info || info.userRole === 'admin') return true
    const allowed = new Set(
      info.userGroups && info.userGroups.length ? info.userGroups : ['default'],
    )
    if (info.groupTag) allowed.add(info.groupTag)
    return modelGroups.some((group) => allowed.has(group))
  }

  private containsImage(messages: any): boolean {
    if (!Array.isArray(messages)) return false
    return messages.some((message) => {
      const content = message?.content
      if (Array.isArray(content)) {
        return content.some((part: any) =>
          part?.type === 'image_url' ||
          part?.type === 'input_image' ||
          part?.type === 'image' ||
          !!part?.image_url ||
          part?.source?.type === 'image' ||
          !!part?.image,
        )
      }
      if (typeof content === 'string') return false
      return !!content?.image_url || !!content?.image || content?.type === 'image'
    })
  }

  private sendProtocolError(
    res: Response,
    protocol: RelayProtocol,
    status: number,
    code: string,
    message: string,
  ) {
    if (protocol === 'responses') return this.sendResponsesError(res, status, code, message)
    if (protocol === 'anthropic') return this.sendAnthropicError(res, status, code, message)
    return this.sendOpenAIError(res, status, code, message)
  }

  private sendOpenAIError(res: Response, status: number, code: string, message: string) {
    const body = { error: { message, type: code, code } }
    if (!res.headersSent) return res.status(status).json(body)
    this.endStartedResponse(res)
  }

  private sendResponsesError(res: Response, status: number, code: string, message: string) {
    const body = {
      error: { message, type: code, code, param: null, event_id: null },
    }
    if (!res.headersSent) return res.status(status).json(body)
    this.endStartedResponse(res)
  }

  private sendAnthropicError(
    res: Response,
    status: number,
    code: string,
    message: string,
  ) {
    const body = {
      type: 'error',
      error: {
        type: this.anthropicErrorType(status, code),
        message,
      },
    }
    if (!res.headersSent) return res.status(status).json(body)
    this.endStartedResponse(res)
  }

  private anthropicErrorType(status: number, code: string): string {
    if (code === 'anthropic_not_supported' || code === 'vision_not_supported') {
      return 'invalid_request_error'
    }
    if (status === 401) return 'authentication_error'
    if (status === 403) return 'permission_error'
    if (status === 404) return 'not_found_error'
    if (status === 413) return 'request_too_large'
    if (status === 429) return 'rate_limit_error'
    if (status === 529) return 'overloaded_error'
    if (status === 400) return 'invalid_request_error'
    return 'api_error'
  }

  private sendUpstreamError(
    res: Response,
    protocol: RelayProtocol,
    status: number,
    body: string,
    contentType: string,
    requestId?: string,
  ) {
    if (res.headersSent) return this.endStartedResponse(res)
    if (requestId) res.setHeader('request-id', requestId)
    if (!body) {
      return this.sendProtocolError(
        res,
        protocol,
        status || 502,
        'upstream_error',
        '上游返回空错误',
      )
    }
    return res.status(status || 502).type(contentType || 'application/json').send(body)
  }

  /** 已开始的 HTTP 流不能再修改头或拼接另一种协议的错误体。 */
  private endStartedResponse(res: Response) {
    if (res.writableEnded || (res as any).destroyed || (res as any).closed) return
    try {
      res.end()
    } catch {
      // 客户端关闭与上游错误并发时，结束响应只是尽力清理。
    }
  }

  private upstreamErrorMessage(body: string, status: number): string {
    if (!body) return `上游返回空错误（HTTP ${status || 502}）`
    try {
      const parsed = JSON.parse(body)
      const message = parsed?.error?.message || parsed?.message
      if (typeof message === 'string' && message.trim()) return message.trim()
    } catch {
      // 非 JSON 上游错误只记录截断后的文本摘要。
    }
    return body.length > 1000 ? `${body.slice(0, 997)}...` : body
  }

  private getClientIp(req: Request): string | null {
    const remoteIp = this.normalizeIp(req.socket.remoteAddress)
    const forwarded = req.headers['x-forwarded-for']
    const firstForwarded = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0]
    const forwardedIp = this.normalizeIp(firstForwarded)
    return forwardedIp && remoteIp && this.isTrustedProxy(remoteIp)
      ? forwardedIp
      : remoteIp
  }

  private normalizeIp(value?: string): string | null {
    if (!value) return null
    const ip = value.trim().replace(/^::ffff:/i, '')
    return isIP(ip) ? ip : null
  }

  private isTrustedProxy(ip: string): boolean {
    if (ip === '::1' || ip.startsWith('127.')) return true
    if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true
    const parts = ip.split('.')
    return parts[0] === '172' && Number(parts[1]) >= 16 && Number(parts[1]) <= 31
  }

  private async finalizeSuccess(
    res: Response,
    context: RelayContext,
    picked: PickedChannel,
    inputTokens: number,
    cachedTokens: number,
    outputTokens: number,
    totalTokens: number,
    isStream: boolean,
    usageEstimated: boolean,
    firstTokenMs: number,
    retryCount: number,
  ) {
    if (isStream && !res.writableEnded) res.end()
    await this.accounting.succeed(context.accounting, {
      picked,
      inputTokens,
      cachedTokens,
      outputTokens,
      totalTokens,
      isStream,
      usageEstimated,
      firstTokenMs,
      retryCount,
    })
  }
}
