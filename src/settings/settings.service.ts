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
  { method: 'telebirr', label: 'Telebirr', value: '0961155660', enabled: true },
  { method: 'cbe', label: 'CBE', value: '1000442979395', enabled: true },
  { method: 'abyssinia', label: 'Bank of Abyssinia', value: '132319348', enabled: true },
  { method: 'mpesa', label: 'M-Pesa', value: '', enabled: false },
  { method: 'awash', label: 'Awash Bank', value: '', enabled: false },
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
          'Transfer the exact amount to the account shown, then submit your transaction ID or receipt screenshot for verification.',
        paymentAccounts: DEFAULT_PAYMENT_ACCOUNTS,
      },
      update: {},
    });
  }

  /** Force-sync live pay-to accounts (used by seed / ops). */
  async syncPaymentAccounts() {
    return this.prisma.appSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        botUsername: '',
        supportContact: '',
        paymentInstructions:
          'Transfer the exact amount to the account shown, then submit your transaction ID or receipt screenshot for verification.',
        paymentAccounts: DEFAULT_PAYMENT_ACCOUNTS,
      },
      update: {
        paymentAccounts: DEFAULT_PAYMENT_ACCOUNTS,
        paymentInstructions:
          'Transfer the exact amount to the account shown, then submit your transaction ID or receipt screenshot for verification.',
      },
    });
  }
}
