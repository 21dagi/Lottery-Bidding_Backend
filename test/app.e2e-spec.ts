import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from '../src/common/interceptors/transform-response.interceptor';
import { buildTestInitData } from '../src/auth/telegram/telegram-init-data';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Requires a running Postgres with DATABASE_URL from .env
 * and seeded admin. Skip automatically if DB is unreachable.
 */
describe('Job1 e2e smoke (auth → deposit → approve)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let skip = false;

  const botToken = process.env.TELEGRAM_BOT_TOKEN || 'test-bot-token';

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = botToken;
    process.env.USER_JWT_SECRET =
      process.env.USER_JWT_SECRET || 'test-user-jwt-secret-change-me-min-32';
    process.env.ADMIN_JWT_SECRET =
      process.env.ADMIN_JWT_SECRET || 'test-admin-jwt-secret-change-me-min-32';
    process.env.ADMIN_BOOTSTRAP_PASSWORD =
      process.env.ADMIN_BOOTSTRAP_PASSWORD || 'ChangeMeOwner!123';

    try {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      app.use(cookieParser());
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      app.useGlobalFilters(new AllExceptionsFilter());
      app.useGlobalInterceptors(new TransformResponseInterceptor());
      await app.init();
      prisma = app.get(PrismaService);
      await prisma.$queryRaw`SELECT 1`;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Skipping e2e — DB not available:', e);
      skip = true;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('telegram auth → upload → deposit → admin approve → balance', async () => {
    if (skip) return;

    const initData = buildTestInitData(botToken, {
      id: 900001,
      first_name: 'Test',
      username: 'tester',
    });

    const authRes = await request(app.getHttpServer())
      .post('/auth/telegram')
      .send({ initData })
      .expect(201);
    const userToken = authRes.body.data.accessToken as string;
    expect(userToken).toBeTruthy();

    // Auth isolation: user token forbidden on admin
    await request(app.getHttpServer())
      .get('/admin/deposits')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(401);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const upload = await request(app.getHttpServer())
      .post('/media/upload')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', png, { filename: 'proof.png', contentType: 'image/png' })
      .expect(201);
    const mediaId = upload.body.data.id as string;

    const deposit = await request(app.getHttpServer())
      .post('/me/deposits')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ amountEtb: 100, method: 'telebirr', mediaId })
      .expect(201);
    const depositId = deposit.body.data.id as string;

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/admin/login')
      .send({
        username: process.env.ADMIN_BOOTSTRAP_USERNAME || 'owner',
        password: process.env.ADMIN_BOOTSTRAP_PASSWORD || 'ChangeMeOwner!123',
      })
      .expect(201);
    const adminToken = adminLogin.body.data.accessToken as string;

    await request(app.getHttpServer())
      .post(`/admin/deposits/${depositId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    // Double approve must not double credit
    await request(app.getHttpServer())
      .post(`/admin/deposits/${depositId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    const wallet = await request(app.getHttpServer())
      .get('/me/wallet')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(wallet.body.data.balanceEtb).toBe(100);

    // Ban check
    const userId = authRes.body.data.user.id as string;
    await request(app.getHttpServer())
      .post(`/admin/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'test ban' })
      .expect(201);

    const banned = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(banned.body.code).toBe('USER_BANNED');
  });
});
