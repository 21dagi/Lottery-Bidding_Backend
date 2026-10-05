import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PaymentAccount = {
  method: string;
  label: string;
  value: string;
  enabled: boolean;
};

export type SettingsDto = {
  botUsername: string;
  supportContact: string;
  paymentInstructions: string;
  paymentAccounts: PaymentAccount[];
};

export const DEFAULT_PAYMENT_ACCOUNTS: PaymentAccount[] = [
  { method: 'telebirr', label: 'Telebirr', value: '09xxxxxxxx', enabled: true },
  { method: 'cbe', label: 'CBE Birr', value: '1000xxxxxxxx', enabled: true },
  { method: 'mpesa', label: 'M-Pesa', value: '07xxxxxxxx', enabled: true },
  { method: 'awash', label: 'Awash Bank', value: '', enabled: false },
  { method: 'abyssinia', label: 'Bank of Abyssinia', value: '', enabled: false },
  { method: 'amole', label: 'Amole', value: '', enabled: false },
];

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SettingsDto> {
    const row = await this.ensureDefaults();
    return {
      botUsername: row.botUsername,
      supportContact: row.supportContact,
      paymentInstructions: row.paymentInstructions,
      paymentAccounts: row.paymentAccounts as PaymentAccount[],
    };
  }

  async update(dto: SettingsDto): Promise<SettingsDto> {
    const row = await this.prisma.appSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        botUsername: dto.botUsername,
        supportContact: dto.supportContact,
        paymentInstructions: dto.paymentInstructions,
        paymentAccounts: dto.paymentAccounts,
      },
      update: {
        botUsername: dto.botUsername,
        supportContact: dto.supportContact,
        paymentInstructions: dto.paymentInstructions,
        paymentAccounts: dto.paymentAccounts,
      },
    });
    return {
      botUsername: row.botUsername,
      supportContact: row.supportContact,
      paymentInstructions: row.paymentInstructions,
      paymentAccounts: row.paymentAccounts as PaymentAccount[],
    };
  }

  async getPublicPaymentMethods() {
    const settings = await this.get();
    return {
      paymentInstructions: settings.paymentInstructions,
      methods: settings.paymentAccounts
        .filter((a) => a.enabled)
        .map((a) => ({
          method: a.method,
          label: a.label,
          value: a.value,
          enabled: a.enabled,
        })),
    };
  }

  async ensureDefaults() {
    return this.prisma.appSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        botUsername: '',
        supportContact: '',
        paymentInstructions:
          'Transfer the exact amount, then upload your payment screenshot.',
        paymentAccounts: DEFAULT_PAYMENT_ACCOUNTS,
      },
      update: {},
    });
  }
}
