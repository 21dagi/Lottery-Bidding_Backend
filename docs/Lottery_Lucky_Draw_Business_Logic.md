# Lottery & Lucky Draw Platform
## Business Logic & Product Specification

**Document Type:** Business Logic Specification  
**Current Product:** Telegram Mini App Lottery / Lucky Draw Platform  
**Primary Operator:** Owner / Admin  
**User Interface:** Telegram Mini App  
**Owner Interface:** Separate Owner/Admin Panel  
**Document Scope:** Business rules, workflows, states, permissions, financial rules, ticket rules, winner rules, notifications, and operational requirements.

---

# 1. Product Overview

The platform is a paid lottery / lucky-draw system operated by one business owner.

Customers access the platform through a **Telegram Mini App**.

The owner operates the business through a completely separate **Owner/Admin Panel**.

The platform allows the owner to:

- Create lotteries
- Configure ticket quantities
- Set ticket prices
- Add one or multiple prizes
- Add cash or product prizes
- Publish lottery information
- Monitor ticket sales
- Manage users
- Manage user wallets
- Verify deposits
- Review payment screenshots
- Manually adjust wallet balances
- Lock and finish lotteries
- Run draws
- Manage winners
- Pay winners externally
- Upload payout evidence
- Manage product-prize delivery
- Manage referral rewards
- View transactions
- View complete activity/audit history

Customers can:

- Enter through Telegram
- Maintain a wallet
- Deposit money
- Submit payment proof
- Purchase multiple lottery tickets
- Reserve tickets temporarily
- View ticket ownership
- View ticket history, including unsuccessful/failed transactions
- View active and completed lotteries
- View prizes
- View winners
- Receive referral rewards
- View wallet transactions
- Receive system notifications

---

# 2. High-Level System Structure

```text
                         LOTTERY PLATFORM
                               │
                     ┌─────────┴─────────┐
                     │                   │
                USER SIDE            OWNER SIDE
                     │                   │
             Telegram Mini App       Owner Panel
                     │                   │
                     └─────────┬─────────┘
                               │
                         Same Business
                           Platform
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
     Lotteries              Wallets               Users
        │                      │                      │
     Tickets               Deposits              Referrals
        │                      │                      │
     Winners              Payments              Notifications
        │                      │                      │
      Prizes               Transactions           Audit
```

The user-facing application and owner-facing application are separate interfaces.

A customer must never receive access to owner functionality.

The owner has full operational control.

---

# 3. Actors

## 3.1 Owner / Admin

There is currently one owner/admin.

The owner has full access to all business operations.

The owner can:

- Create lotteries
- Edit lotteries
- Start lotteries
- Lock lotteries
- Finish lotteries
- Cancel lotteries
- Manage prizes
- Manage users
- Ban users
- Manage wallets
- Approve/reject deposits
- Manually increase/decrease wallet balances
- Manage referral rewards
- View transactions
- View payment evidence
- Manage winners
- Record winner payments
- Upload payment proof
- Manage product-prize fulfillment
- View audit history

The system should be designed so delegated administrative roles can be introduced later, but this is not part of the current operational model.

## 3.2 Customer / User

A customer is a Telegram user using the Mini App.

The user can:

- Create/use their platform account
- Provide a required phone number
- View lotteries
- Select tickets
- Reserve tickets
- Purchase tickets
- View wallet
- Deposit money
- Submit payment evidence
- View transaction history
- Receive referral rewards
- View purchased tickets
- View ticket ownership/history
- View winners
- View completed lottery information

Users cannot:

- Modify wallet balances
- Approve their own deposits
- Modify ticket ownership
- Change purchased tickets
- Transfer purchased tickets
- Modify lottery configuration
- Select winners
- Mark their own payments as approved
- Access owner functions

---

# 4. User Identity

Telegram is the primary user identity.

Telegram information is obtained automatically from the Telegram Mini App.

The platform should maintain available Telegram identity information such as:

- Telegram user identifier
- Telegram username, when available
- Telegram display name
- Other relevant Telegram identity information

A phone number is also required.

```text
Telegram Identity
       +
Required Phone Number
       =
Platform User
```

The user cannot access normal purchasing functionality without completing required account information.

---

# 5. User Access

A normal user can access the Telegram Mini App.

A banned user cannot use the platform normally.

```text
User
  ↓
Attempts to access Mini App
  ↓
System identifies banned account
  ↓
Access denied
  ↓
User cannot perform normal platform actions
```

A ban is controlled by the owner.

The owner should be able to see the reason for the ban.

---

# 6. Owner Panel

The owner panel is completely separate from the Telegram Mini App.

The owner panel should provide comprehensive operational control.

```text
Owner Panel
│
├── Dashboard
├── Users
├── Wallets
├── Deposits
├── Transactions
├── Lotteries
├── Tickets
├── Prizes
├── Winners
├── Referral System
├── Media / Evidence
├── Notifications
├── Audit History
└── Settings
```

---

# 7. Owner Dashboard

The dashboard should provide an operational overview:

- Active lotteries
- Upcoming lotteries
- Completed lotteries
- Cancelled lotteries
- Total registered users
- Active users
- Banned users
- Pending deposits
- Approved deposits
- Rejected deposits
- Wallet balances
- Ticket sales
- Available tickets
- Reserved tickets
- Pending payments
- Sold tickets
- Winners
- Pending winner payouts
- Completed winner payouts
- Referral rewards
- Recent transactions
- Recent administrative activity

---

# 8. Lottery / Campaign Concept

The current product focuses on **lottery-style campaigns**.

A lottery contains:

- Lottery name
- Description
- Cover/banner media
- Promotional media
- Ticket quantity
- Ticket price
- Start state
- Deadline
- Lock behavior
- One or more prizes
- Lottery status
- Ticket inventory
- Winner information after the draw
- Optional evidence/media

The platform should remain extensible so other campaign types such as auctions or giveaways can be introduced later.

Those campaign types are not part of the current business rules.

---

# 9. Lottery Creation

The owner creates a lottery by defining its commercial and operational information.

Required business information includes:

- Name
- Description
- Ticket quantity
- Ticket price
- Deadline or relevant timing
- Prize information
- Lock configuration
- Public media where applicable

The owner can add one or multiple prizes.

Example:

```text
Lottery
│
├── Ticket Count: 1,000
├── Ticket Price: 100 ETB
├── Deadline: 30 September
│
└── Prizes
     ├── Prize 1: 100,000 ETB
     ├── Prize 2: Smartphone
     └── Prize 3: Voucher
```

There is no required minimum number of tickets that must be sold before the lottery can be completed.

---

# 10. Ticket Quantity

The owner determines the total number of tickets.

Examples:

- 100
- 500
- 1,000
- 10,000

Each ticket has a unique number within that lottery.

---

# 11. Ticket Price

The owner defines the ticket price.

Users see the current ticket price clearly.

A user can purchase multiple tickets in one purchase.

Historical transactions must retain the amount actually charged at the time of purchase even if the current ticket price later changes.

---

# 12. Ticket Quantity Changes

Once ticket sales have started, the total ticket quantity cannot be reduced.

The system must never allow already sold ticket numbers to become invalid.

Therefore:

```text
Total Tickets
      ↓
Sales Start
      ↓
Inventory cannot be reduced
```

---

# 13. Prize System

A lottery can contain:

- One prize
- Two prizes
- Three prizes
- Ten prizes
- Any reasonable number of prizes

A prize may be:

- Cash
- Physical product
- Voucher
- Other business-defined prize

---

# 14. Cash Prize

A cash prize can contain:

- Prize name
- Amount
- Description
- Optional supporting media

Cash winnings are paid by the owner outside the platform wallet.

---

# 15. Product Prize

A product prize can contain:

- Product name
- Description
- Specifications
- Images
- Supporting documents
- Optional PDF documentation
- Additional relevant information

---

# 16. Product Prize Lifecycle

```text
Winner Selected
      ↓
Winner Contact Information Available
      ↓
Owner Contacts Winner
      ↓
Winner Claims Prize
      ↓
Delivery / Pickup Arranged
      ↓
Prize Delivered
      ↓
Owner Records Completion
      ↓
Optional Delivery Evidence
```

---

# 17. Multiple Prizes

Each prize is independently associated with a winning ticket.

The same user is allowed to win multiple prizes if they own multiple eligible tickets.

Example:

```text
User A owns:
101
205
777

Draw:
101 → Prize 1
777 → Prize 3

Result:
User A wins two prizes.
```

There is no rule requiring different users for different prizes.

---

# 18. Ticket Status System

Tickets should have clear business states:

```text
AVAILABLE
SELECTED
RESERVED
PAYMENT_PENDING
SOLD
WINNER
CANCELLED / INVALID
```

The visual representation is handled by the interface, but the business state must remain unambiguous.

---

# 19. Ticket Visual System

Tickets are displayed as a grid, not a simple vertical list.

A visible legend explains ticket states.

```text
┌──────────────────────────────────────┐
│ AVAILABLE  SELECTED  RESERVED       │
│ PENDING    SOLD      WINNER          │
└──────────────────────────────────────┘

[001] [002] [003] [004] [005]
[006] [007] [008] [009] [010]
[011] [012] [013] [014] [015]
...
```

---

# 20. Ticket Selection

Users can select multiple tickets in one session.

Example:

```text
Selected:
102
205
311
488
701

Selected Tickets: 5
Total: 500 ETB
```

A persistent selection summary should show:

- Number of selected tickets
- Total cost
- Purchase action

---

# 21. Ticket Reservation

Selected tickets can be temporarily reserved for **10 minutes**.

```text
Select
  ↓
Reserve
  ↓
10-minute countdown
  ↓
Purchase completed OR reservation expires
```

Other users cannot purchase an actively reserved ticket.

---

# 22. Reservation Countdown

The user should see remaining reservation time.

Example:

```text
Your tickets are reserved.

Time remaining:
08:42
```

Other users should see the ticket as reserved.

---

# 23. Reservation Expiration

If the user does not complete the purchase before expiration:

```text
Reservation expires
      ↓
Ticket released
      ↓
AVAILABLE
```

The expired reservation must not permanently block inventory.

---

# 24. Ticket Purchase

A user may purchase multiple tickets in one transaction.

```text
Select Tickets
      ↓
Reserve Tickets
      ↓
Review Selection
      ↓
Confirm Purchase
      ↓
Check Wallet Balance
      ↓
Deduct Required Amount
      ↓
Tickets Become SOLD
      ↓
Transaction Recorded
```

A successful purchase permanently associates the purchased tickets with the user.

---

# 25. Purchased Ticket Immutability

After successful purchase:

- User cannot change the ticket.
- User cannot swap the ticket.
- User cannot cancel the ticket.
- User cannot transfer the ticket.

The owner must preserve historical ownership.

---

# 26. Wallet System

Every user has an internal wallet.

The wallet is used to purchase lottery tickets.

The wallet contains:

- Current available balance
- Deposit history
- Purchase history
- Referral rewards
- Owner adjustments
- Other financial transactions

The wallet should be treated as a financial ledger, not merely an editable balance.

---

# 27. Wallet Balance

Example:

```text
Wallet Balance

Available:
2,500 ETB
```

The displayed balance must reflect recorded financial transactions.

---

# 28. Deposits

Users add money through the business's external payment process.

```text
User
 ↓
Chooses Deposit
 ↓
Receives Payment Instructions
 ↓
Pays Externally
 ↓
Uploads Payment Screenshot
 ↓
Deposit becomes PENDING
 ↓
Owner Reviews
```

---

# 29. Payment Screenshot

A payment screenshot is evidence submitted by the user.

Deposit statuses:

```text
PENDING
APPROVED
REJECTED
```

---

# 30. Deposit Approval

```text
Deposit
   ↓
APPROVED
   ↓
Wallet Balance Increased
   ↓
User Notified
```

The approved amount must be recorded as a wallet transaction.

---

# 31. Deposit Rejection

```text
Deposit
   ↓
REJECTED
   ↓
Wallet Not Increased
   ↓
Rejection Recorded
   ↓
User Notified
```

The owner should be able to record a rejection reason.

---

# 32. Deposit Audit

Every deposit review must retain:

- User
- Amount
- Submission time
- Payment evidence
- Status
- Review time
- Owner action
- Rejection reason where applicable

Approved and rejected payment attempts must both remain historically visible to authorized operators.

---

# 33. Owner Wallet Adjustment

The owner can manually increase or decrease a user's wallet balance.

Users can never perform this action themselves.

Every adjustment must include:

- Amount
- Direction: increase/decrease
- Reason
- Owner identity
- Timestamp
- Resulting transaction
- Confirmation before execution

Example:

```text
Owner
 ↓
Select User
 ↓
Adjust Wallet
 ↓
+500 ETB
 ↓
Reason:
"Manual correction for verified payment"
 ↓
Confirm
 ↓
Wallet updated
 ↓
Audit record created
```

A manual wallet adjustment must never be invisible.

---

# 34. Wallet Withdrawal

Users cannot withdraw their wallet balance through the platform.

The internal wallet is primarily for purchases and applicable rewards.

There is no user wallet withdrawal functionality in the current scope.

---

# 35. Winner Money

Lottery winnings are paid **outside the platform wallet**.

The owner is responsible for paying the winner.

```text
Winner selected
      ↓
Owner contacts winner
      ↓
Owner pays winner externally
      ↓
Owner records payout
      ↓
Optional payment evidence
      ↓
Payout marked completed
```

Winner cash is not automatically credited to the platform wallet.

---

# 36. Winner Payout Evidence

The owner can attach:

- Payment screenshot
- Photo
- Video
- Other supporting evidence

Evidence is optional.

---

# 37. Lottery Deadline

A lottery can have a deadline.

Users should see the remaining time.

```text
Lottery closes in:
2 Days
05 Hours
21 Minutes
```

---

# 38. Lottery Lock Options

The owner can use:

### Manual Lock
Owner decides when the lottery is locked.

### Deadline Lock
Lottery locks when the configured deadline is reached.

### Full Ticket Lock
Lottery can lock when all tickets are sold.

### Recommended Full Lock
The system can notify/recommend that the owner lock the lottery when inventory is full.

The owner retains operational control.

---

# 39. Early Finish

A lottery does not have to remain open until the deadline.

The owner can manually lock/finish it before the deadline.

```text
Deadline:
30 September

All tickets sold:
25 September

Owner:
Lock Lottery

Result:
Lottery closes on 25 September.
```

---

# 40. No Minimum Sales Requirement

There is no required minimum number of tickets that must be sold before the owner can finish the lottery.

---

# 41. Lottery Lifecycle

```text
DRAFT
  ↓
READY / PUBLISHED
  ↓
OPEN
  ↓
LOCKED
  ↓
DRAW
  ↓
COMPLETED
```

Alternative terminal state:

```text
OPEN
  ↓
CANCELLED
```

---

# 42. Lottery States

## Draft
Being prepared. Users cannot participate.

## Open
Users can view, reserve, and purchase tickets.

## Locked
Ticket sales are closed. Eligible tickets are frozen.

## Draw
Winner selection is performed.

## Completed
Winners are determined and results are available.

## Cancelled
Owner cancelled the lottery.

---

# 43. Lottery Cancellation

Only the owner can cancel a lottery.

Cancellation requires explicit confirmation.

```text
Owner clicks:
Cancel Lottery

System:
"Are you sure?"

Owner confirms

↓
Lottery becomes CANCELLED
```

The cancellation must be recorded in the audit history.

Refund handling remains a separate business rule because the exact refund policy has not been finalized.

---

# 44. Lottery Editing

The owner can manage lottery information while operating the campaign.

The ticket price can be changed according to owner permissions.

Historical purchases must remain historically accurate.

Example:

```text
Old ticket price:
100 ETB

Historical purchase:
5 tickets = 500 ETB

Owner later changes current price:
150 ETB

Historical transaction:
Remains 500 ETB
```

The total ticket quantity cannot be reduced after sales have started.

---

# 45. Draw Eligibility

When the lottery is locked:

```text
Sales stop
   ↓
Ticket set is frozen
   ↓
Eligible tickets determined
   ↓
Draw performed
```

The owner cannot manually choose a preferred winner.

---

# 46. Draw Fairness Rule

Winner selection must be based on the eligible tickets recorded by the platform.

Once locked, the eligible ticket set is final for that draw.

The result must be permanently recorded.

The owner should not be able to silently replace a winning ticket after the draw.

Any exceptional administrative correction must create an explicit audit record.

---

# 47. Multiple Winner Selection

```text
Eligible Tickets
       ↓
Winner Selection
       ↓
Prize 1 → Winning Ticket
Prize 2 → Winning Ticket
Prize 3 → Winning Ticket
...
```

The same user may win multiple prizes.

---

# 48. Winner Record

A winner record should contain:

- Lottery
- Prize
- Winning ticket number
- Winning user
- Winner status
- Payout/fulfillment status
- Relevant evidence
- Important timestamps

---

# 49. Winner Information Visible to Users

Users should be able to view completed lottery results:

- Winning ticket number
- Winner
- Prize
- Optional draw evidence
- Optional payout evidence
- Other public result information

---

# 50. Ticket Ownership Transparency

Users can see which user purchased a particular ticket.

This includes relevant historical activity, including failed/unsuccessful purchase attempts where a business record exists.

Example:

```text
Ticket 482

Purchased by:
@username

Status:
SOLD
```

Failed purchase attempt:

```text
Ticket 731

User:
@username

Attempt:
PAYMENT FAILED

Current Ticket Status:
AVAILABLE
```

A failed purchase does not make the user the owner.

---

# 51. Ticket Information Modal

Clicking a ticket opens a detailed modal.

```text
┌──────────────────────────────┐
│ Ticket #482                  │
│                              │
│ Status: SOLD                 │
│                              │
│ Purchased by: @username      │
│                              │
│ Purchase history             │
│ ───────────────────────────  │
│ User A - failed              │
│ User B - expired reservation │
│ User C - purchased           │
└──────────────────────────────┘
```

The exact public identity presentation uses available Telegram identity information.

---

# 52. Ticket History

Meaningful ticket events should be preserved:

```text
Ticket Created
Ticket Selected
Ticket Reserved
Reservation Expired
Payment Attempted
Payment Failed
Ticket Purchased
Ticket Became Winner
```

---

# 53. Referral System

The platform supports referral rewards.

Users can refer other users.

The owner defines the referral reward structure.

Example:

```text
Referral Target:
10 eligible referrals

Reward:
1,000 ETB
```

The threshold and reward amount are configurable by the owner.

---

# 54. Referral Reward

A reward is earned when the configured referral condition is satisfied.

Example:

```text
User refers 10 eligible users
             ↓
Referral target reached
             ↓
Reward:
1,000 ETB
             ↓
Reward added to wallet
```

Referral rewards appear as identifiable wallet transactions.

---

# 55. Referral Transparency

Users should see:

- Referral count
- Required referral count
- Progress
- Earned rewards
- Reward transaction

Example:

```text
Your Referrals

8 / 10

2 more referrals to receive:
1,000 ETB
```

---

# 56. Notifications

Supported notifications include:

### Deposit
- Deposit submitted
- Deposit approved
- Deposit rejected

### Tickets
- Ticket purchased
- Reservation created
- Reservation expiring
- Reservation expired

### Lottery
- Lottery started
- Lottery almost full
- Lottery locked
- Lottery completed
- Lottery cancelled

### Winner
- User won
- Winner payout sent
- Prize fulfillment update where applicable

### Financial
- Referral reward received
- Wallet adjustment where appropriate
- Refund when applicable

---

# 57. Media System

The platform supports:

- Images
- Videos
- PDFs

Media can be used for:

- Lottery banners
- Lottery galleries
- Product images
- Prize information
- Promotional content
- Product specifications
- Payment evidence
- Draw evidence
- Winner payout evidence
- Delivery evidence
- Supporting documents

---

# 58. Public vs Private Media

Public media may be displayed to users:

- Lottery images
- Prize images
- Product specification documents
- Promotional videos
- Draw evidence
- Public winner evidence

Payment evidence should remain controlled and visible only to authorized owner operations unless explicitly intended as public evidence.

---

# 59. User Uploads

Users can upload payment evidence through the designated upload process.

Business states:

```text
Uploaded
 ↓
Associated with Deposit
 ↓
Pending Review
 ↓
Approved / Rejected
```

The upload infrastructure itself is outside this business-logic document.

---

# 60. Owner Payment Verification

The owner reviews:

- Submitted amount
- User
- Payment evidence
- Submission time
- Relevant transaction information

Then chooses:

```text
APPROVE
or
REJECT
```

---

# 61. Financial Transaction History

Financial transaction types can include:

```text
DEPOSIT
TICKET_PURCHASE
REFERRAL_REWARD
OWNER_WALLET_ADJUSTMENT
REFUND
OTHER_SUPPORTED_ADJUSTMENT
```

Each transaction should contain:

- User
- Amount
- Type
- Status
- Time
- Related business event
- Reason where applicable

Historical financial records must not be silently overwritten.

---

# 62. Failed Transactions

Failed actions are not successful purchases.

Example:

```text
User selects Ticket 500
      ↓
Purchase attempt
      ↓
Payment fails
      ↓
Ticket is NOT SOLD
```

The failed attempt can remain in history for transparency and audit.

---

# 63. Reservation vs Ownership

A reservation does not equal ownership.

```text
RESERVED
   ≠
SOLD
```

Ownership begins only when purchase is successfully completed.

---

# 64. Concurrent Ticket Selection

Two users may attempt to select the same ticket.

Only one can successfully obtain it.

```text
User A ──┐
         ├── Ticket #500
User B ──┘

Only one successful ownership result.
```

A failed attempt must not overwrite a successful purchase.

---

# 65. Lottery Deadline Race Condition

If a user attempts a purchase around the deadline, the transaction must be accepted only if the lottery is still operationally open.

Once locked:

```text
No new purchases.
```

An already completed purchase remains valid.

---

# 66. Reservation Race Condition

If Ticket A is reserved by User A:

```text
User A → RESERVED
```

User B cannot successfully reserve the same ticket while User A's reservation remains active.

When it expires:

```text
User A → Reservation expired
Ticket → AVAILABLE
```

Another user may then reserve it.

---

# 67. Financial Consistency

The platform must not create inconsistent states such as:

```text
Ticket says SOLD
but no successful purchase exists
```

or:

```text
Wallet increased
but no corresponding financial transaction exists
```

or:

```text
Deposit says APPROVED
but wallet was not updated
```

Financial events must remain traceable.

---

# 68. Historical Accuracy

Historical records describe what actually happened.

Example:

```text
Current Ticket Price:
150 ETB

Historical Purchase:
100 ETB

Historical transaction remains:
100 ETB
```

Current configuration must never rewrite historical transactions.

---

# 69. Owner Confirmation for Important Actions

Important actions should require confirmation.

Examples:

- Cancel lottery
- Ban user
- Manual wallet adjustment
- Lock lottery
- Finish lottery
- Important financial actions

The owner should clearly see the action before confirming.

---

# 70. User Mini App Main Areas

```text
Home
├── Active Lotteries
├── Upcoming / Available Lotteries
├── Completed Lotteries
└── Winners

Wallet
├── Balance
├── Deposit
└── Transactions

Tickets
├── My Tickets
└── Ticket History

Referrals
├── Referral Link
├── Referral Progress
└── Rewards

Profile
├── Telegram Information
├── Phone Number
└── Account Status
```

---

# 71. Lottery Detail Page

Should show:

- Lottery name
- Description
- Banner
- Images/videos
- Ticket price
- Total ticket count
- Available tickets
- Deadline
- Countdown
- Prize information
- Prize images
- Product specifications
- Lottery status
- Ticket grid
- Ticket legend
- Selected tickets
- Purchase summary

---

# 72. Prize Display

Each prize should be clearly visible.

Example:

```text
PRIZES

🥇 Prize 1
100,000 ETB

🥈 Prize 2
iPhone

🥉 Prize 3
10,000 ETB
```

Product prizes should have detailed information available.

---

# 73. User Ticket History

Users can see:

- Purchased tickets
- Lottery
- Purchase amount
- Purchase date
- Ticket status
- Winning status

---

# 74. Completed Lottery Page

```text
Lottery
   ↓
Prizes
   ↓
Winning Tickets
   ↓
Winners
   ↓
Optional Evidence
```

---

# 75. Referral Page

```text
Your Referral Progress

Current:
7

Required:
10

Remaining:
3

Reward:
1,000 ETB
```

After completion:

```text
Reward Earned:
1,000 ETB
```

---

# 76. Owner Lottery Management

The owner can:

- Create lottery
- Edit lottery
- Publish lottery
- Start lottery
- Monitor lottery
- Change permitted settings
- Change ticket price
- Manage prizes
- Lock lottery
- Finish lottery
- Cancel lottery
- View ticket inventory
- View participants
- View transactions
- View winners
- Attach evidence

---

# 77. Owner Prize Management

For each prize, the owner can manage:

```text
Prize
├── Type
├── Name
├── Description
├── Value / Amount
├── Images
├── Specifications
├── Supporting Documents
└── Fulfillment Information
```

---

# 78. Owner User Management

The owner can:

- Search users
- View users
- View Telegram identity
- View phone number
- View wallet balance
- View transaction history
- View lottery participation
- View purchased tickets
- View referral activity
- View deposits
- View payment submissions
- Ban users
- Review activity

---

# 79. Owner Deposit Management

The owner should have a dedicated deposit review area.

Example:

```text
Deposits
│
├── Pending
├── Approved
└── Rejected
```

Pending deposits should be easy to identify and review.

---

# 80. Owner Ticket Management

The owner should be able to inspect:

- All tickets
- Ticket status
- Ticket owner
- Reservation history
- Purchase history
- Failed purchase attempts
- Winning tickets
- Related transactions

---

# 81. Owner Winner Management

The owner should be able to:

- View winners
- View winning ticket
- View prize
- Contact winner
- Record cash payout
- Upload payout evidence
- Track product fulfillment
- Record delivery/pickup completion

---

# 82. Owner Referral Management

The owner can configure:

- Referral requirement
- Reward amount
- Referral program status
- Applicable reward rules

The owner can also inspect referral activity and earned rewards.

---

# 83. Owner Notification Management

The owner should be able to manage operational notification settings.

Notification events include:

- Deposits
- Purchases
- Reservations
- Lottery state changes
- Winners
- Payouts
- Referral rewards
- Other important business events

---

# 84. Audit Log

Important owner and financial operations must be recorded.

Examples:

- Lottery creation
- Lottery modification
- Lottery lock
- Lottery completion
- Lottery cancellation
- Prize changes
- Ticket configuration changes
- Deposit approval
- Deposit rejection
- Wallet adjustment
- User ban
- Winner processing
- Winner payout
- Evidence upload
- Referral configuration changes

Every payment screenshot approval/rejection must be auditable.

---

# 85. Audit Example

```text
Action:
Deposit Approved

User:
@username

Amount:
2,000 ETB

Owner:
Admin

Time:
2026-09-22 10:42

Previous Status:
PENDING

New Status:
APPROVED
```

---

# 86. Owner Transaction Review

Transactions should be filterable by:

- User
- Transaction type
- Status
- Date
- Amount
- Lottery
- Deposit
- Ticket purchase
- Referral reward
- Wallet adjustment

---

# 87. Active Lottery Monitoring

The owner should be able to monitor:

- Total tickets
- Available tickets
- Reserved tickets
- Pending tickets
- Sold tickets
- Sales amount
- Time remaining
- Number of participants
- Recent purchases
- Recent failed attempts

---

# 88. Completed Lottery

A completed lottery preserves its historical state.

Users can view:

- Lottery information
- Prize information
- Winning tickets
- Winners
- Optional draw evidence
- Optional payout evidence
- Relevant ticket ownership information

The owner can review the complete history.

---

# 89. Evidence

Evidence is optional.

Possible evidence:

- Draw video
- Draw images
- Payment proof
- Winner payout proof
- Product delivery proof

Evidence must be associated with the correct business event.

---

# 90. Draw Evidence

If available, the owner can attach draw evidence to the completed lottery.

```text
Completed Lottery
       │
       ├── Winning Tickets
       ├── Winners
       └── Draw Evidence
             ├── Video
             └── Images
```

---

# 91. Winner Contact

After a winner is selected, the owner must have enough information to contact them.

Available information may include:

- Telegram identity
- Telegram username when available
- Phone number
- Relevant profile information

The owner can arrange:

- Cash payment
- Product pickup
- Product delivery
- Other prize fulfillment

---

# 92. Cash Winner Lifecycle

```text
Winner Selected
      ↓
Winner Contacted
      ↓
Payment Arranged
      ↓
Owner Pays Externally
      ↓
Payment Recorded
      ↓
Optional Proof Uploaded
      ↓
Payout Completed
```

---

# 93. Product Winner Lifecycle

```text
Winner Selected
      ↓
Winner Contacted
      ↓
Claim / Contact Confirmed
      ↓
Pickup or Delivery Arranged
      ↓
Product Delivered
      ↓
Fulfillment Completed
      ↓
Optional Evidence
```

---

# 94. Terms and Conditions

The platform operates under business terms and conditions.

A mandatory age restriction is not currently defined.

The system does not require a separate terms-acceptance step before every purchase.

The business rules govern:

- Ticket purchases
- Ticket reservations
- Lottery deadlines
- Lottery locking
- Winner selection
- Winner payouts
- Product fulfillment
- Deposits
- Wallet usage
- Referral rewards
- User bans
- Cancellation

The owner should maintain appropriate business/legal terms separately.

---

# 95. Purchase Protection Rules

### Insufficient Balance

```text
Required:
1,000 ETB

Wallet:
700 ETB

Result:
Purchase rejected
```

### Ticket Already Sold

```text
User attempts:
Ticket #100

Ticket:
Already SOLD

Result:
Purchase rejected
```

### Reservation Expired

```text
Reservation:
Expired

Result:
Ticket must be re-selected
```

---

# 96. Business Invariants

The following rules must always remain true:

1. A user cannot modify their own wallet balance.
2. A user cannot approve their own deposit.
3. A sold ticket cannot be sold to another user.
4. A reservation is not ownership.
5. An expired reservation releases the ticket.
6. A failed purchase does not create ticket ownership.
7. A user may own multiple tickets.
8. A user may win multiple prizes.
9. Winner payouts occur outside the platform wallet.
10. Historical transactions retain their original amounts.
11. Ticket quantity cannot be reduced below already-established inventory after sales begin.
12. Once a lottery is locked, new ticket purchases are not allowed.
13. Once the draw eligibility set is frozen, it cannot silently change.
14. Owner wallet adjustments require a reason and audit record.
15. Important owner actions require confirmation.
16. Banned users cannot normally operate the Mini App.
17. Deposit approval/rejection must remain auditable.
18. Payment evidence must remain associated with its deposit.
19. Public ticket ownership must distinguish current ownership from failed/expired activity.
20. Owner actions must be traceable through audit history.

---

# 97. Complete User Journey

```text
User opens Telegram
        ↓
Telegram identity retrieved
        ↓
Phone number provided
        ↓
Account ready
        ↓
User views lotteries
        ↓
Opens lottery
        ↓
Views prizes
        ↓
Views ticket grid
        ↓
Selects multiple tickets
        ↓
Tickets reserved for 10 minutes
        ↓
Checks wallet
        ↓
If insufficient:
    Deposit money
        ↓
    External payment
        ↓
    Upload screenshot
        ↓
    Owner verifies
        ↓
    Wallet credited
        ↓
Return to purchase
        ↓
Confirm purchase
        ↓
Tickets become SOLD
        ↓
User receives confirmation
        ↓
Lottery eventually locks
        ↓
Draw occurs
        ↓
If user wins:
    User notified
        ↓
    Owner contacts user
        ↓
    Prize paid/delivered externally
```

---

# 98. Complete Owner Journey

```text
Owner opens Owner Panel
        ↓
Creates lottery
        ↓
Adds ticket configuration
        ↓
Adds prizes
        ↓
Adds media
        ↓
Publishes lottery
        ↓
Users begin purchasing
        ↓
Owner monitors sales
        ↓
Owner reviews deposits
        ↓
Owner approves/rejects payments
        ↓
Owner manages users
        ↓
Lottery becomes full OR deadline reached
        ↓
Owner locks lottery
        ↓
Eligible tickets frozen
        ↓
Draw performed
        ↓
Winners recorded
        ↓
Owner contacts winners
        ↓
Cash prizes paid externally
OR
Product prizes delivered
        ↓
Optional evidence uploaded
        ↓
Lottery marked completed
```

---

# 99. Complete Deposit Journey

```text
User
 ↓
Select Deposit
 ↓
Enter amount
 ↓
Pay externally
 ↓
Upload screenshot
 ↓
Deposit = PENDING
 ↓
Owner reviews
 ├───────────────┐
 ↓               ↓
APPROVED       REJECTED
 ↓               ↓
Wallet +        Wallet unchanged
 ↓               ↓
Notify user     Notify user
```

---

# 100. Complete Ticket Journey

```text
AVAILABLE
    ↓
SELECTED
    ↓
RESERVED
    │
    ├── Purchase succeeds ──→ SOLD
    │                              ↓
    │                            WINNER
    │
    └── 10 minutes expire ──→ AVAILABLE
```

Failed payment attempts remain historical activity but do not create ownership.

---

# 101. Complete Lottery Journey

```text
DRAFT
  ↓
PUBLISHED
  ↓
OPEN
  ↓
Tickets being sold
  ↓
┌───────────────────────────────┐
│                               │
│ Deadline reached              │
│ OR                            │
│ Owner manually locks          │
│ OR                            │
│ Full inventory condition      │
│                               │
└───────────────┬───────────────┘
                ↓
             LOCKED
                ↓
        Eligible tickets frozen
                ↓
              DRAW
                ↓
            WINNERS
                ↓
           COMPLETED
```

Alternative:

```text
OPEN
  ↓
OWNER CANCELS
  ↓
CANCELLED
```

---

# 102. Business Glossary

| Term | Meaning |
|---|---|
| User | Customer using the Telegram Mini App |
| Owner | Business owner/admin with full control |
| Lottery | A paid ticket-based lucky draw |
| Ticket | A numbered entry in a lottery |
| Reservation | Temporary hold on a ticket |
| Sold | Successfully purchased ticket |
| Winner | User whose eligible ticket is selected |
| Prize | Reward associated with a lottery |
| Wallet | Internal user balance used for platform purchases |
| Deposit | Money added through external payment and owner verification |
| Payment Evidence | Screenshot or other proof submitted for a deposit |
| Referral | User acquisition relationship that may generate a reward |
| Lock | Closing ticket sales |
| Draw | Winner-selection event |
| Payout | Owner's external payment to a winner |
| Evidence | Optional proof such as images/videos/screenshots |
| Audit Log | Historical record of important system/owner actions |

---

# 103. Current Scope Summary

The first version of the platform is focused on:

```text
Telegram Users
      ↓
Wallet
      ↓
Deposits
      ↓
Owner Verification
      ↓
Lottery Tickets
      ↓
10-Minute Reservations
      ↓
Ticket Purchases
      ↓
Lottery Lock
      ↓
Random Draw
      ↓
Winner
      ↓
External Prize Payment / Delivery
```

The owner has complete business control through a separate owner panel.

The platform is designed to provide:

- Clear ticket states
- Multi-ticket purchases
- Transparent ticket ownership/history
- Internal wallet accounting
- Manual deposit verification
- Referral rewards
- Flexible prizes
- Multiple winners
- Multiple prizes
- External winner payouts
- Product-prize fulfillment
- Optional evidence
- Complete operational auditing
- User banning
- Comprehensive owner controls

---

# 104. Future Extensibility

The current product is a lottery platform.

The business model should remain extensible for future campaign types such as:

- Giveaway
- Real auction
- Other promotional campaigns

Future campaign types should have their own rules rather than forcing lottery rules onto them.

The current implementation should therefore treat the lottery as the first supported campaign type while keeping the overall business concept extensible.

---

# 105. Final Business Principle

The platform should prioritize four business properties:

```text
             TRUST
              │
       ┌──────┼──────┐
       │      │      │
 TRANSPARENCY ACCURACY CONTROL
       │      │      │
       └──────┼──────┘
              │
           AUDITABILITY
```

The owner has operational control, while users must be able to clearly understand:

- What lottery they are entering
- What each ticket costs
- Which tickets are available
- Which tickets are reserved
- Which tickets are sold
- Who owns tickets
- What prizes exist
- When the lottery closes
- Who won
- What evidence is available
- What happened to their money
- What happened to their tickets

This document defines the current business logic and operational behavior of the lottery platform. Technical implementation details are intentionally excluded.
