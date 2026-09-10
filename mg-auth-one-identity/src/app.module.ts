import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaService } from './prisma.service';
import { AuthService, SessionAuthGuard } from './auth';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { WeComAuthService } from './wecom-auth';
import { AccountSecurityService } from './account-security';
import { AccountSecurityController } from './account-security.controller';
import { SecurityKeyService } from './security-key';
import { EmailOtpService } from './email-otp';
import { MailConfigService } from './mail-config';
import { MailConfigController } from './mail-config.controller';
import { ApplicationsController } from './applications.controller';
import { ZentaoAuthService } from './zentao-auth';
import { RolesController } from './roles.controller';
import { LoginAttemptService } from './login-attempt';
import { LoginAttemptController } from './login-attempt.controller';
import { OrganizationController } from './organization.controller';
import { ScopeController } from './scope.controller';

@Module({
  controllers: [AuthController, UsersController, AccountSecurityController, MailConfigController, ApplicationsController, RolesController, LoginAttemptController, OrganizationController, ScopeController],
  providers: [PrismaService, AuthService, WeComAuthService, ZentaoAuthService, AccountSecurityService, SecurityKeyService,
    EmailOtpService, MailConfigService, LoginAttemptService, { provide: APP_GUARD, useClass: SessionAuthGuard }],
})
export class AppModule {}
