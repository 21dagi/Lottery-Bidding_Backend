# links.et integration notes

> Condensed from https://links.et/agents.md for this repo.

- Base URL: `https://links.et`
- Auth: `x-api-key: $LINKS_ET_API_KEY` (server-only, never browser)
- Endpoints: `POST /api/verify`, `POST /api/verify-image`
- Switch on `receipt.source`, not host
- Amounts may be numbers or strings — parse per source
- Receipt URLs are credentials — do not log them
- On verifier errors / mismatches → admin manual queue (never invent success)
- Successful credits store a row in `verified_payment_receipts` (unique per provider + reference)

Pay-to accounts used for destination matching:

- telebirr: `0961155660`
- cbe: `1000442979395`
- boa (`abyssinia`): `132319348`
