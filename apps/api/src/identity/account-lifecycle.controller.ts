import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AccountLifecycleService } from './account-lifecycle.service';
import { MfaService } from './mfa.service';
import { PublicEndpoint } from './session.guard';

@Controller('auth')
export class AccountLifecycleController {
  constructor(private readonly accounts: AccountLifecycleService, private readonly mfa: MfaService) {}

  @Get('users/mfa-enrolled')
  enrolledUsers(@Req() request: Request) { return this.mfa.enrolledUsers(request.cookies.b2b_session); }

  @Get('users')
  users(@Req() request: Request) { return this.accounts.list(request.cookies.b2b_session); }

  @Post('users/:id/mfa-reset')
  resetMfa(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { return this.mfa.resetByAdministrator(request.cookies.b2b_session, id, body); }

  @Post('invitations')
  invite(@Req() request: Request, @Body() body: unknown) { return this.accounts.invite(request.cookies.b2b_session, body); }

  @Post('users/:id/invitation')
  reissue(@Req() request: Request, @Param('id') id: string) { return this.accounts.reissue(request.cookies.b2b_session, id, 'invitation'); }

  @Post('users/:id/password-reset')
  reset(@Req() request: Request, @Param('id') id: string) { return this.accounts.reissue(request.cookies.b2b_session, id, 'password_reset'); }

  @Post('users/:id/status')
  @HttpCode(200)
  status(@Req() request: Request, @Param('id') id: string, @Body() body: unknown) { return this.accounts.setStatus(request.cookies.b2b_session, id, body); }

  @PublicEndpoint()
  @Post('invitations/accept')
  @HttpCode(200)
  accept(@Body() body: unknown) { return this.accounts.complete(body, 'invitation'); }

  @PublicEndpoint()
  @Post('password-reset/complete')
  @HttpCode(200)
  completeReset(@Body() body: unknown) { return this.accounts.complete(body, 'password_reset'); }
}
