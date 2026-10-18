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

Import the repository into Vercel and keep the detected SvelteKit defaults. `@sveltejs/adapter-vercel` serves every page as prerendered static output; only the owner-sync endpoints under `/api` run as Node.js 24 functions.

For everyone else, all financial data remains in the browser: the app makes no backend, analytics, or third-party runtime requests unless a device has opted in to owner sync on `/account`.

### Owner-only cloud sync

One GitHub account (the owner) can sign in on `/account` to sync an end-to-end encrypted copy of the data between devices. The server only ever stores AES-256-GCM ciphertext produced in the browser from the owner's sync passphrase. That passphrase is never sent to the server. It is only kept on a device if the owner chooses **Remember this device**, and then only encrypted with a browser key that can't be extracted.

1. Create a GitHub OAuth app with the callback URL `https://<your-domain>/api/auth/callback`. Create a second OAuth app for local development with the callback `http://localhost:5173/api/auth/callback`.
2. In Vercel, create a **private** Blob store and connect it to the project. This sets `BLOB_READ_WRITE_TOKEN`.
3. Set the remaining environment variables (see `.env.example`):
   - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`: from the OAuth app.
   - `GITHUB_ALLOWED_USER_ID`: your **numeric** GitHub user id (`curl https://api.github.com/users/<login>`).
   - `SESSION_SECRET`: at least 32 random characters (`openssl rand -base64 48`).

Without these variables the public app works unchanged and `/account` reports that sync is not configured.
