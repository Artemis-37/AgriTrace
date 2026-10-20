import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { NoOrg, Public } from '../access/decorators';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) password: string;
  @IsOptional() @IsString() device_label?: string;
}
class RefreshDto {
  @IsString() refresh_token: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() b: LoginDto, @Req() req: any) {
    return this.auth.login(b.email.toLowerCase(), b.password, req.ip, b.device_label);
  }

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
}
