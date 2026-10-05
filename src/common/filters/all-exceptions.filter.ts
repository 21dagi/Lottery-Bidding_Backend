import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const obj = body as Record<string, unknown>;
        if (Array.isArray(obj.message)) {
          message = obj.message.map(String).join('; ');
          code = 'VALIDATION_ERROR';
        } else if (obj.message != null) {
          message = String(obj.message);
        }
        if (typeof obj.code === 'string') code = obj.code;
        else if (status === HttpStatus.UNAUTHORIZED) code = 'UNAUTHORIZED';
        else if (status === HttpStatus.NOT_FOUND) code = 'NOT_FOUND';
        else if (status === HttpStatus.CONFLICT) code = 'CONFLICT';
        else if (status === HttpStatus.BAD_REQUEST && code === 'INTERNAL_ERROR') {
          code = 'VALIDATION_ERROR';
        }
      }
    }

    res.status(status).json({ statusCode: status, code, message });
  }
}
