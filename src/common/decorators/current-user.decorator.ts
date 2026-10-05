import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

export interface AuthUser {
  id: string;
  telegramId: string;
}

export interface AuthAdmin {
  id: string;
  username: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    if (!req.user) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return req.user;
  },
);

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthAdmin => {
    const req = ctx.switchToHttp().getRequest<{ admin?: AuthAdmin }>();
    if (!req.admin) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return req.admin;
  },
);
