# Debt Tracker

A local-first debt snowball planner built with SvelteKit and TypeScript.

## Development disclosure

This project was developed solely through Kiro Crew using GPT-5.6-sol, as a test of Kiro Crew's capabilities.

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

## Deploying to Vercel

Import the repository into Vercel. The included `vercel.json` runs `pnpm build` and deploys the generated `build` directory as static assets; no environment variables are required.

All financial data remains in the browser. The application has no backend, analytics, or third-party runtime requests.
