# Contributing to Umbra

Thanks for helping make eclipse planning clearer and more dependable.

## Before you start

- Search the existing issues before opening a new one.
- For a substantial feature or interface change, open an issue first so the user journey and scope can be agreed before implementation.
- Read [DESIGN.md](DESIGN.md). The map is the product; new controls should earn their place and work well on a small touchscreen.

## Local setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

No API keys are required. `NEXT_PUBLIC_SITE_URL` is used for canonical metadata and the geocoding request identity.

## Making a change

1. Create a focused branch from `main`.
2. Keep changes small enough to review and avoid unrelated formatting churn.
3. Preserve keyboard access, visible focus, reduced-motion behavior, and touch targets.
4. For calculation or catalogue changes, include the source and a reproducible example.
5. For interface changes, include screenshots at a mobile and desktop width.
6. Run the checks below before opening a pull request.

```bash
pnpm lint
pnpm build
```

By participating, you agree to be respectful, specific, and constructive. Harassment, discrimination, and personal attacks are not welcome.
