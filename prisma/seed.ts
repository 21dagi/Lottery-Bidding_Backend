import { PrismaClient, LotteryStatus, PrizeKind, TicketStatus, DepositStatus, PaymentMethod, NotificationChannel, NotificationStatus, PayoutStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { createHash, randomBytes } from 'crypto';

function loadEnvFile() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();

const DEFAULT_PAYMENT_ACCOUNTS = [
  { method: 'telebirr', label: 'Telebirr', value: '0961155660', enabled: true },
  { method: 'cbe', label: 'CBE', value: '1000442979395', enabled: true },
  { method: 'abyssinia', label: 'Bank of Abyssinia', value: '132319348', enabled: true },
  { method: 'mpesa', label: 'M-Pesa', value: '', enabled: false },
  { method: 'awash', label: 'Awash Bank', value: '', enabled: false },
  { method: 'amole', label: 'Amole', value: '', enabled: false },
];

const prisma = new PrismaClient();

function sha256Hex(input: string) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

async function main() {
  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'owner';
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || 'ChangeMeOwner!123';
  const displayName = process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME || 'Owner';
  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.adminUser.upsert({
    where: { username },
    create: { username, passwordHash, displayName, role: 'OWNER' },
    update: { passwordHash, displayName },
  });

  await prisma.appSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      botUsername: process.env.TELEGRAM_BOT_USERNAME || 'lottery_dev_bot',
      supportContact: '@lottery_support',
      paymentInstructions:
        'Transfer the exact amount to the selected account, then upload your payment screenshot. Min 50 ETB.',
      paymentAccounts: DEFAULT_PAYMENT_ACCOUNTS,
    },
    update: {
      botUsername: process.env.TELEGRAM_BOT_USERNAME || 'lottery_dev_bot',
      supportContact: '@lottery_support',
      paymentInstructions:
        'Transfer the exact amount to the selected account, then upload your payment screenshot. Min 50 ETB.',
      paymentAccounts: DEFAULT_PAYMENT_ACCOUNTS,
    },
  });

  await prisma.referralRule.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      enabled: true,
      purchasePercent: 5,
      depositFlatEtb: 10,
    },
    update: { enabled: true, purchasePercent: 5, depositFlatEtb: 10 },
  });

  // Demo users
  async function upsertDemoUser(input: {
    telegramId: string;
    username: string;
    displayName: string;
    phone: string;
    balance: number;
  }) {
    const user = await prisma.user.upsert({
      where: { telegramId: input.telegramId },
      create: {
        telegramId: input.telegramId,
        telegramUsername: input.username,
        displayName: input.displayName,
        phoneNumber: input.phone,
      },
      update: {
        telegramUsername: input.username,
        displayName: input.displayName,
        phoneNumber: input.phone,
        isBanned: false,
        banReason: null,
      },
    });
    const wallet = await prisma.wallet.upsert({
      where: { userId: user.id },
      create: { userId: user.id, cachedBalance: input.balance },
      update: { cachedBalance: input.balance },
    });
    // Reset ledger for demo determinism
    await prisma.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
    if (input.balance > 0) {
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'DEPOSIT',
          amount: input.balance,
          balanceAfter: input.balance,
          referenceType: 'seed',
          referenceId: 'demo-opening',
          reason: 'Demo opening balance',
        },
      });
    }
    return user;
  }

  const ada = await upsertDemoUser({
    telegramId: '100001',
    username: 'ada_demo',
    displayName: 'Ada Demo',
    phone: '+251911000001',
    balance: 2500,
  });
  const belay = await upsertDemoUser({
    telegramId: '100002',
    username: 'belay_demo',
    displayName: 'Belay Demo',
    phone: '+251911000002',
    balance: 800,
  });
  const chala = await upsertDemoUser({
    telegramId: '100003',
    username: 'chala_demo',
    displayName: 'Chala Demo',
    phone: '+251911000003',
    balance: 150,
  });

  await prisma.referral.upsert({
    where: { referredUserId: belay.id },
    create: { referrerUserId: ada.id, referredUserId: belay.id },
    update: {},
  });
  await prisma.user.update({
    where: { id: belay.id },
    data: { referredByUserId: ada.id },
  });

  // Wipe prior demo lotteries (by series label) for re-seed
  const old = await prisma.lottery.findMany({
    where: { seriesLabel: { in: ['DEMO-LIVE', 'DEMO-DONE'] } },
    select: { id: true },
  });
  for (const l of old) {
    await prisma.lottery.delete({ where: { id: l.id } });
  }

  // Placeholder media rows (external URLs — no binary upload required for demo)
  const coverLive = await prisma.media.create({
    data: {
      url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=800',
      mimeType: 'image/jpeg',
      sizeBytes: 0,
      uploadedByType: 'ADMIN',
      uploadedById: admin.id,
    },
  });
  const coverDone = await prisma.media.create({
    data: {
      url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800',
      mimeType: 'image/jpeg',
      sizeBytes: 0,
      uploadedByType: 'ADMIN',
      uploadedById: admin.id,
    },
  });
  const productImg = await prisma.media.create({
    data: {
      url: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600',
      mimeType: 'image/jpeg',
      sizeBytes: 0,
      uploadedByType: 'ADMIN',
      uploadedById: admin.id,
    },
  });
  const depositShot = await prisma.media.create({
    data: {
      url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400',
      mimeType: 'image/jpeg',
      sizeBytes: 0,
      uploadedByType: 'USER',
      uploadedById: chala.id,
    },
  });

  const closesAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const live = await prisma.lottery.create({
    data: {
      title: 'Grand Obsidian Draw',
      seriesLabel: 'DEMO-LIVE',
      description: 'Demo live lottery — reserve and purchase with Ada (balance 2500 ETB).',
      coverMediaId: coverLive.id,
      ticketQuantity: 50,
      ticketPrice: 100,
      status: LotteryStatus.OPEN,
      deadlineAt: closesAt,
      createdByAdminId: admin.id,
      prizes: {
        create: [
          {
            place: 1,
            kind: PrizeKind.money,
            title: '100,000 ETB',
            subtitle: 'Bank transfer payout',
            detail: 'Winner receives cash payout outside the wallet.',
            amountEtb: 100000,
          },
          {
            place: 2,
            kind: PrizeKind.product,
            title: 'Smartphone',
            subtitle: 'Flagship handset',
            detail: 'Hand delivery in Addis Ababa.',
            imageMediaId: productImg.id,
            specs: [
              { label: 'Storage', value: '256 GB' },
              { label: 'Delivery', value: 'Addis Ababa' },
            ],
          },
          {
            place: 3,
            kind: PrizeKind.money,
            title: '10,000 ETB',
            subtitle: 'Cash prize',
            detail: 'Third place cash award.',
            amountEtb: 10000,
          },
        ],
      },
      history: {
        create: [
          {
            title: 'Published',
            detail: 'Demo lottery opened for sales.',
            tone: 'accent',
          },
        ],
      },
    },
  });

  await prisma.ticket.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      lotteryId: live.id,
      ticketNumber: i + 1,
      status: TicketStatus.AVAILABLE,
    })),
  });

  // Sell a few tickets to Ada & Belay
  const soldNums = [7, 14, 22, 33];
  for (const n of soldNums) {
    const owner = n === 33 ? belay.id : ada.id;
    await prisma.ticket.update({
      where: {
        lotteryId_ticketNumber: { lotteryId: live.id, ticketNumber: n },
      },
      data: {
        status: TicketStatus.SOLD,
        ownerUserId: owner,
        soldPrice: 100,
        soldAt: new Date(),
      },
    });
  }

  // Finished lottery with draw + winners
  const done = await prisma.lottery.create({
    data: {
      title: 'Neon Pulse Raffle',
      seriesLabel: 'DEMO-DONE',
      description: 'Completed demo draw for archive UI.',
      coverMediaId: coverDone.id,
      ticketQuantity: 20,
      ticketPrice: 50,
      status: LotteryStatus.COMPLETED,
      deadlineAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      createdByAdminId: admin.id,
      prizes: {
        create: [
          {
            place: 1,
            kind: PrizeKind.money,
            title: '5,000 ETB',
            subtitle: 'Cash',
            detail: 'Finished demo first prize',
            amountEtb: 5000,
          },
        ],
      },
      history: {
        create: [
          { title: 'Published', detail: 'Opened', tone: 'accent' },
          { title: 'Locked', detail: 'Sales closed', tone: 'accent' },
          { title: 'Draw completed', detail: 'Winners selected', tone: 'success' },
        ],
      },
    },
  });

  await prisma.ticket.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      lotteryId: done.id,
      ticketNumber: i + 1,
      status: i < 10 ? TicketStatus.SOLD : TicketStatus.AVAILABLE,
      ownerUserId: i < 10 ? (i % 2 === 0 ? ada.id : belay.id) : null,
      soldPrice: i < 10 ? 50 : null,
      soldAt: i < 10 ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) : null,
    })),
  });

  const soldTickets = await prisma.ticket.findMany({
    where: { lotteryId: done.id, status: TicketStatus.SOLD },
    orderBy: { ticketNumber: 'asc' },
  });
  const seedHex = randomBytes(32).toString('hex');
  const prize = await prisma.prize.findFirstOrThrow({
    where: { lotteryId: done.id, place: 1 },
  });
  const winningTicket = soldTickets[0];

  const draw = await prisma.draw.create({
    data: {
      lotteryId: done.id,
      eligibleTicketSnapshot: soldTickets.map((t) => t.id),
      seedCommitHash: sha256Hex(seedHex),
      seedReveal: seedHex,
      rngAlgorithm: 'sha256-fisher-yates',
      executedByAdminId: admin.id,
      executedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.ticket.update({
    where: { id: winningTicket.id },
    data: { status: TicketStatus.WINNER },
  });

  await prisma.winner.create({
    data: {
      drawId: draw.id,
      lotteryId: done.id,
      prizeId: prize.id,
      ticketId: winningTicket.id,
      userId: winningTicket.ownerUserId!,
      payoutStatus: PayoutStatus.PAID,
      updatedByAdminId: admin.id,
    },
  });

  // Pending deposit for Chala
  await prisma.deposit.create({
    data: {
      userId: chala.id,
      amount: 200,
      method: PaymentMethod.telebirr,
      status: DepositStatus.PENDING,
      mediaId: depositShot.id,
    },
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: ada.id,
        channel: NotificationChannel.IN_APP,
        type: 'system.welcome',
        payload: {
          title: 'Welcome Ada',
          body: 'Demo account ready — try the live Obsidian draw.',
          kind: 'system',
        },
        status: NotificationStatus.SENT,
      },
      {
        userId: ada.id,
        channel: NotificationChannel.IN_APP,
        type: 'ticket.purchased',
        payload: {
          title: 'Tickets purchased',
          body: 'You own tickets #7, #14, #22 on Grand Obsidian.',
          kind: 'ticket',
        },
        status: NotificationStatus.SENT,
      },
    ],
  });

  // eslint-disable-next-line no-console
  console.log(`
Seed complete.
  Admin: ${username} / ${password}
  Demo users (use POST /auth/dev/login in development):
    telegramId 100001 Ada   balance 2500  (owns live tickets)
    telegramId 100002 Belay balance 800
    telegramId 100003 Chala balance 150   (pending deposit)
  Live lottery:  ${live.id}  (${live.title})
  Finished lottery: ${done.id} (${done.title})
`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
