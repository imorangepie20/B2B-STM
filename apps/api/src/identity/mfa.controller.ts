import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MfaService } from './mfa.service';
import { SessionRequest } from './session.guard';

@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}
  @Get('status')
  status(@Req() req: SessionRequest) { return this.mfa.status(req.principal.id); }
  @Post('enroll')
  enroll(@Req() req: Request, @Body() body: unknown) { return this.mfa.execute(req.cookies.b2b_session, 'enroll', body); }
  @Post('confirm')
  @HttpCode(200)
  confirm(@Req() req: Request, @Body() body: unknown) { return this.mfa.execute(req.cookies.b2b_session, 'confirm', body); }
  @Post('verify')
  @HttpCode(200)
  verify(@Req() req: Request, @Body() body: unknown) { return this.mfa.execute(req.cookies.b2b_session, 'verify', body); }
  @Post('recover')
  @HttpCode(200)
  recover(@Req() req: Request, @Body() body: unknown) { return this.mfa.execute(req.cookies.b2b_session, 'recover', body); }
  @Post('recovery-codes')
  @HttpCode(200)
  regenerateRecoveryCodes(@Req() req: Request, @Body() body: unknown) { return this.mfa.execute(req.cookies.b2b_session, 'regenerate', body); }
}
