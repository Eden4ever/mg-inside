import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** 失败原因取自各登录路径已有的判定结果，不另行推断。 */
export type LoginResult = 'success' | 'failure';
export type LoginReason = 'invalid_credentials' | 'locked' | 'disabled' | 'unbound' | 'challenge_failed';
export type LoginSource = 'local' | 'wecom' | 'zentao';

export interface LoginAttemptInput {
  username: string;
  userId?: string | null;
  displayName?: string | null;
  result: LoginResult;
  reason?: LoginReason | null;
  source: LoginSource;
  secondMethod?: string | null;
  sessionId?: string | null;
  context?: { userAgent?: string; ipAddress?: string };
}

export interface LoginAttemptQuery {
  result?: string;
  username?: string;
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const RESULTS = new Set<string>(['success', 'failure']);
const MAX_PAGE_SIZE = 100;
/** 记录长度上限只为防止异常输入撑大表，不改变业务判定。 */
const limit = (value: string | null | undefined, max: number) => typeof value === 'string' && value ? value.slice(0, max) : null;

@Injectable()
export class LoginAttemptService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * 写入一条登录尝试。成功记录随会话事务一起提交；失败记录必须在计数事务提交之后调用，
   * 否则会随事务回滚一起丢失。写入失败不能影响登录结果本身。
   */
  async record(input: LoginAttemptInput, transaction: Prisma.TransactionClient | PrismaService = this.prisma): Promise<void> {
    const data = {
      userId: input.userId ?? null,
      username: limit(input.username, 128) ?? '',
      displayName: limit(input.displayName, 128),
      result: input.result,
      reason: input.reason ?? null,
      source: input.source,
      secondMethod: limit(input.secondMethod, 32),
      ipAddress: limit(input.context?.ipAddress, 64),
      userAgent: limit(input.context?.userAgent, 512),
      sessionId: input.sessionId ?? null,
    };
    try { await transaction.loginAttempt.create({ data }); }
    catch { /* 审计写入失败不阻断登录，也不吞掉登录本身的错误。 */ }
  }

  async list(query: LoginAttemptQuery): Promise<object> {
    const page = Math.max(1, Math.trunc(Number(query.page ?? 1)) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(query.pageSize ?? 20)) || 20));
    const where: Prisma.LoginAttemptWhereInput = {};
    if (query.result) {
      if (!RESULTS.has(query.result)) throw new BadRequestException('登录结果筛选无效。');
      where.result = query.result;
    }
    if (query.username) where.username = { contains: query.username.trim().toLowerCase().slice(0, 128) };
    if (query.userId) where.userId = query.userId;
    const at: Prisma.DateTimeFilter = {};
    for (const [key, bound] of [['from', 'gte'], ['to', 'lte']] as const) {
      const raw = query[key];
      if (!raw) continue;
      const value = new Date(raw);
      if (Number.isNaN(value.getTime())) throw new BadRequestException('时间范围无效。');
      at[bound] = value;
    }
    if (at.gte || at.lte) where.at = at;
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.loginAttempt.count({ where }),
      this.prisma.loginAttempt.findMany({ where, orderBy: { at: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return {
      page, pageSize, total,
      items: rows.map(row => ({
        id: row.id, username: row.username, displayName: row.displayName ?? undefined, userId: row.userId ?? undefined,
        result: row.result, reason: row.reason ?? undefined, source: row.source, secondMethod: row.secondMethod ?? undefined,
        ipAddress: row.ipAddress ?? undefined, userAgent: row.userAgent ?? undefined, at: row.at.toISOString(),
      })),
    };
  }
}
