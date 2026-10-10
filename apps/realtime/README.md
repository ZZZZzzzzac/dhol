# DHGC Realtime Backend

Cloudflare Worker + Durable Objects backend for room creation, room joining, WebSocket synchronization, and room export.

## Local Development

Dependencies are declared but not installed in this repository yet.

```powershell
npm install
npm run realtime:dev
```

The Worker exposes:

- `GET /api/health`
- `POST /api/rooms`
- `POST /api/rooms/join`
- `GET /api/rooms/:inviteCode/export/dhroom`
- `GET /api/rooms/:inviteCode/ws?token=...`
- `GET /api/admin/rooms/:inviteCode`
- `PATCH /api/admin/rooms/:inviteCode`
- `POST /api/v2/rooms/:sixCharacterCode/characters` (requires `Idempotency-Key`)

Browser character delivery uses the six-character Room V2 code. Configure its
comma-separated browser origin allowlist with `CHARACTER_INGEST_ORIGINS`; this
CORS setting is separate from `ALLOWED_ORIGIN` and is not an authentication
mechanism. The production configuration includes the hosted character builder
at `https://dhsheet.top`.

## Room administration

Set the management key as a Worker secret:

```powershell
npx wrangler secret put ADMIN_SECRET
```

Then open `/admin` on the frontend. The key is sent as a Bearer token and is
kept only in the page's memory. The admin API can query a room by invite code
and reset its expiry to 1-365 days from the time of the request.

## D1

`schema.sql` contains the planned D1 persistence schema. The current MVP stores authoritative room snapshots in Durable Object storage first, so realtime development can begin before D1 is provisioned.
