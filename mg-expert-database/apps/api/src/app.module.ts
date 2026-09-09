import { TemplatesService } from './templates.service';
import { SecurityKeyService } from './security-key';
import { EmailOtpService } from './email-otp';
import { AccountSecurityService } from './account-security';
import { AccountSecurityController } from './account-security.controller';
import { MailConfigService } from './mail-config';
import { MailConfigController } from './mail-config.controller';
import { SemanticController } from './semantic.controller';
import { ModelConfigService } from './model-config';
import { ModelConfigController } from './model-config.controller';
import { SemanticService } from './semantic.service';
import { ZhipuEmbedding } from './zhipu-embedding';
import { Module } from '@nestjs/common';
import { IdentityController, IdentitySyncService } from './identity.controller';
import { APP_GUARD } from '@nestjs/core';
import { ApiController } from './api.controller';
import { AuthController } from './auth.controller';
import { AuthService, SessionAuthGuard } from './auth';
import { CatalogService } from './catalog.service';
import { PrismaService } from './prisma.service';
import { UsersController } from './users.controller';
import { WeComAuthService } from './wecom-auth';
import { AiController } from './ai.controller';
import { AI_MODEL_GATEWAY } from './ai-model.gateway';
import { AiService } from './ai.service';
import { DeepSeekAiModelGateway } from './deepseek-ai-model.gateway';
import { SystemAccessController } from './system-access.controller';
import { SystemAccessService, SystemPermissionGuard } from './system-access';

@Module({
  controllers: [ApiController, AuthController, UsersController, AiController, SystemAccessController, SemanticController, ModelConfigController, MailConfigController, AccountSecurityController, IdentityController],
  providers: [
    IdentitySyncService,
    PrismaService,
    SecurityKeyService,
    EmailOtpService,
    AccountSecurityService,
    MailConfigService,
    SemanticService,
    ModelConfigService,
    ZhipuEmbedding,
    CatalogService,
    TemplatesService,
    AuthService,
    WeComAuthService,
    SystemAccessService,
    AiService,
    { provide: AI_MODEL_GATEWAY, useClass: DeepSeekAiModelGateway },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: SystemPermissionGuard },
  ],
})
export class AppModule {}
