# SaaS Fundamentals - Company Playbook

## North-star metrics

- Users: total registered accounts
- MRR: monthly recurring revenue
- Retention: users active 7/30 days after signup
- Uptime: target 99.9% for paid products

## Build order for a new product

1. Landing page with email capture — validate demand first
2. Minimum lovable product — one core workflow done well, not ten half-done
3. Onboarding that reaches first value in under 5 minutes
4. Instrumentation: signup events, activation events, churn signals
5. Pricing only after repeated usage is proven

## Decision rules

- Ship weekly; no feature lives longer than one sprint
- Prefer free tiers that demonstrate value over paywalled discovery
- Kill features with <5% adoption after 30 days
- Every release needs a rollback path before it ships

## Common failure modes to avoid

- Building features nobody asked for
- Optimizing conversion before retention
- Deploying without health checks or rollback
- Scaling infrastructure before product-market fit
