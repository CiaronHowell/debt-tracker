# Debt Tracker

A local-first debt snowball planner built with SvelteKit and TypeScript.

The implementation contract is documented in [TECHNICAL_SPEC.md](./TECHNICAL_SPEC.md).

## Development

```sh
pnpm install
pnpm dev
```

## Quality checks

```sh
pnpm quality
pnpm test:e2e
```

All financial data remains in the browser. The application has no backend, analytics, or third-party runtime requests.
