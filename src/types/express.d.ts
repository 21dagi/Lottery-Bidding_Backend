import 'multer';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Multer {
      // re-export for controllers using Express.Multer.File
    }
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    cookies?: Record<string, string>;
    user?: { id: string; telegramId: string };
    admin?: { id: string; username: string; role: string };
  }
}

export {};
