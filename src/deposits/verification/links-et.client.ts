import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BASE_URL = 'https://links.et';

export type LinksEtVerifyBody =
  | { url: string; waitMs?: number }
  | { reference: string; waitMs?: number };

@Injectable()
export class LinksEtClient {
  private readonly logger = new Logger(LinksEtClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('LINKS_ET_API_KEY')?.trim());
  }

  private apiKey(): string {
    const key = this.config.get<string>('LINKS_ET_API_KEY')?.trim();
    if (!key) {
      throw new Error('LINKS_ET_API_KEY is not configured');
    }
    return key;
  }

  async verify(
    body: LinksEtVerifyBody,
    idempotencyKey: string,
  ): Promise<{ httpStatus: number; data: Record<string, unknown> }> {
    return this.requestJson('/api/verify', body, idempotencyKey);
  }

  async verifyImage(
    imageBase64: string,
    idempotencyKey: string,
  ): Promise<{ httpStatus: number; data: Record<string, unknown> }> {
    return this.requestJson(
      '/api/verify-image',
      { imageBase64 },
      idempotencyKey,
    );
  }

  async getVerifyStatus(
    requestId: string,
  ): Promise<{ httpStatus: number; data: Record<string, unknown> }> {
    const res = await fetch(`${BASE_URL}/api/verify/${requestId}`, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey(),
        accept: 'application/json',
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    return { httpStatus: res.status, data };
  }

  /**
   * Short-wait verify with poll follow-up for 202 responses.
   */
  async verifyUntilResolved(
    body: LinksEtVerifyBody,
    idempotencyKey: string,
    opts?: { waitMs?: number; maxPolls?: number },
  ): Promise<{ httpStatus: number; data: Record<string, unknown> }> {
    const waitMs = opts?.waitMs ?? 8_000;
    const payload =
      'url' in body
        ? { url: body.url, waitMs }
        : { reference: body.reference, waitMs };

    let result = await this.verify(payload, idempotencyKey);
    if (result.httpStatus !== 202) return result;

    const requestId = String(result.data.requestId ?? '');
    if (!requestId) return result;

    const maxPolls = opts?.maxPolls ?? 20;
    for (let i = 0; i < maxPolls; i++) {
      await sleep(2_000);
      result = await this.getVerifyStatus(requestId);
      const status = String(result.data.processingStatus ?? '');
      if (status === 'completed' || status === 'failed') {
        return result;
      }
      if (result.httpStatus === 200 || result.httpStatus === 502) {
        return result;
      }
    }
    return result;
  }

  private async requestJson(
    path: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<{ httpStatus: number; data: Record<string, unknown> }> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey(),
        'content-type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      this.logger.warn(
        `links.et rate/quota path=${path} status=429 retryAfter=${retryAfter}`,
      );
    }

    return { httpStatus: res.status, data };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
