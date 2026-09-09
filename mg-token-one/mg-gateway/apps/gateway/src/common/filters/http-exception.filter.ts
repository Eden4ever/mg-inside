import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common'
import { Request, Response } from 'express'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    let status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    // body-parser 超限抛出的是普通 Error，带 statusCode=413，需还原为 413
    if (status === HttpStatus.INTERNAL_SERVER_ERROR && exception instanceof Error) {
      const sc = (exception as any).statusCode || (exception as any).status
      if (sc === 413) status = 413
    }

    let message: any = '服务器内部错误'
    if (exception instanceof HttpException) {
      const res = exception.getResponse()
      message =
        typeof res === 'string'
          ? res
          : (res as any).message || (res as any).error || exception.message
    } else if (exception instanceof Error) {
      message = exception.message
    }

    const requestPath = request.originalUrl?.split('?')[0] || request.path || request.url?.split('?')[0] || ''
    if (requestPath === '/v1/messages' || requestPath.startsWith('/v1/messages/')) {
      const errorType = this.anthropicErrorType(status)
      response.status(status).json({
        type: 'error',
        error: { type: errorType, message },
        request_id: (request as any).requestId || undefined,
      })
      return
    }

    response.status(status).json({
      error: {
        message,
        status_code: status,
        request_id: (request as any).requestId || undefined,
      },
    })
  }

  private anthropicErrorType(status: number): string {
    if (status === 400) return 'invalid_request_error'
    if (status === 401) return 'authentication_error'
    if (status === 403) return 'permission_error'
    if (status === 404) return 'not_found_error'
    if (status === 413) return 'request_too_large'
    if (status === 429) return 'rate_limit_error'
    if (status === 529) return 'overloaded_error'
    return 'api_error'
  }
}
