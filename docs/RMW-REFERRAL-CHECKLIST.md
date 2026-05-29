# RMW Referral Checklist

This repository only proxies referral data and records analytics events. RMW remains the source of truth for point balances, eligibility, billing webhooks, and redemption.

Before enabling or changing referral rewards in RMW, verify these server-side invariants:

- Credit referral points only when the referrer has an active paid tariff at the exact reward event time.
- Do not backfill skipped referral rewards after the referrer's tariff becomes active again.
- Reject self-referrals where the referrer UUID and referred user UUID are the same.
- Prevent duplicate rewards for the same referred user and same reward trigger, including registration and first paid tariff events.
- Treat billing webhooks idempotently so retries cannot create duplicate referral points.
- Award payment points only for confirmed successful subscription tariff payments, not checkout creation, traffic top-ups, failed payments, or refunded payments.
- Revoke or compensate referral points when a qualifying payment is refunded, charged back, or otherwise cancelled.
- Store enough audit metadata for each referral point entry: referrer UUID, referred user UUID, trigger, tariff key, payment ID, idempotency key, eligibility decision, and reason for skipped credit.
- Enforce all point redemption and balance checks server-side. Never trust client-provided balance, cost, or reward type.
- Keep `/v1/users/{uuid}/referral-points` eligibility aligned with the same active paid tariff rule used when crediting points.
