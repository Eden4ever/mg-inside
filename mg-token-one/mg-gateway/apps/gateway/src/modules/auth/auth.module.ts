import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { User } from '@/entities/user.entity'
import { AuthService } from './auth.service'
import { AuthController } from './auth.controller'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { ZentaoAuthService } from './zentao-auth.service'
import { IdentityController, IdentitySyncService } from './identity.controller'

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AuthController, IdentityController],
  providers: [AuthService, JwtAuthGuard, ZentaoAuthService, IdentitySyncService],
  exports: [AuthService, JwtAuthGuard, ZentaoAuthService, TypeOrmModule],
})
export class AuthModule {}
