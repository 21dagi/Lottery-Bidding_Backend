import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  DIRECT_URL: Joi.string().required(),
  TELEGRAM_BOT_TOKEN: Joi.string().required(),
  USER_JWT_SECRET: Joi.string().min(32).required(),
  ADMIN_JWT_SECRET: Joi.string().min(32).required(),
  USER_JWT_EXPIRES_IN: Joi.string().default('7d'),
  ADMIN_ACCESS_JWT_EXPIRES_IN: Joi.string().default('15m'),
  ADMIN_REFRESH_JWT_EXPIRES_IN: Joi.string().default('7d'),
  ADMIN_BOOTSTRAP_USERNAME: Joi.string().default('owner'),
  ADMIN_BOOTSTRAP_PASSWORD: Joi.string().min(8).required(),
  ADMIN_BOOTSTRAP_DISPLAY_NAME: Joi.string().default('Owner'),
  CORS_ORIGINS: Joi.string().allow('').default(''),
  MEDIA_UPLOAD_DIR: Joi.string().default('./uploads'),
  MEDIA_BASE_URL: Joi.string().default('http://localhost:3000/media/files'),
  MEDIA_MAX_BYTES: Joi.number().default(5_242_880),
  COOKIE_SECURE: Joi.boolean().truthy('true').falsy('false').default(false),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
});
