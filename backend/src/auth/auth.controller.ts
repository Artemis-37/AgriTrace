import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { NoOrg, Public } from '../access/decorators';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @Length(1, 200) password: string;
  @IsOptional() @IsString() @MaxLength(80) device_label?: string;
  @IsOptional() @IsString() @MaxLength(32) otp?: string;
}
class CodeDto {
  @IsString() @Length(6, 32) code: string;
}
class DisableDto {
  @IsString() @MaxLength(200) password: string;
  @IsString() @Length(6, 32) code: string;
}
class ChangePasswordDto {
  @IsString() @MaxLength(200) current_password: string;
  @IsString() @MinLength(10) @MaxLength(200) new_password: string;
}
class RefreshDto {
  @IsString() @MaxLength(300) refresh_token: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Anti-force brute : 10 tentatives par minute et par adresse (LOGIN_THROTTLE_LIMIT), en plus du verrouillage du compte. */
  @Throttle({ default: { limit: Number(process.env.LOGIN_THROTTLE_LIMIT) || 10, ttl: 60_000 } })
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() b: LoginDto, @Req() req: any) {
    return this.auth.login(b.email.toLowerCase(), b.password, req.ip, b.device_label, req.headers['x-client'] === 'web', b.otp);
  }

  @Throttle({ default: { limit: Number(process.env.LOGIN_THROTTLE_LIMIT) || 30, ttl: 60_000 } })
  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() b: RefreshDto) {
    return this.auth.refresh(b.refresh_token);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: any) {
    await this.auth.logout(req.user.sessionId, req.user.id);
  }

  @NoOrg()
  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(@Body() b: ChangePasswordDto, @Req() req: any) {
    await this.auth.changePassword(req.user.id, req.user.sessionId, b.current_password, b.new_password);
  }

  @NoOrg() @ApiBearerAuth() @Get('2fa')
  twoFactorStatus(@Req() req: any) { return this.auth.twoFactorStatus(req.user.id); }

  @NoOrg() @ApiBearerAuth() @Post('2fa/setup') @HttpCode(200)
  twoFactorSetup(@Req() req: any) { return this.auth.twoFactorSetup(req.user.id); }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @NoOrg() @ApiBearerAuth() @Post('2fa/enable') @HttpCode(200)
  twoFactorEnable(@Body() b: CodeDto, @Req() req: any) { return this.auth.twoFactorEnable(req.user.id, b.code); }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @NoOrg() @ApiBearerAuth() @Post('2fa/disable') @HttpCode(204)
  async twoFactorDisable(@Body() b: DisableDto, @Req() req: any) { await this.auth.twoFactorDisable(req.user.id, b.password, b.code); }
}
