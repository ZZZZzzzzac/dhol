# DHGC Realtime Backend

Cloudflare Worker + Durable Objects backend for room creation, room joining, WebSocket synchronization, and room export.

## Local Development

Dependencies are declared but not installed in this repository yet.

```powershell
npm install
npm run realtime:dev
```

The production candidate exposes only Room V2 room operations:

- `POST /api/v2/rooms`
- `POST /api/v2/rooms/join`
- `POST /api/v2/rooms/restore`
- `GET /api/v2/rooms/:inviteCode/snapshot`
- `GET /api/v2/rooms/:inviteCode/export`
- `GET /api/v2/rooms/:inviteCode/ws?token=...`
- `POST /api/v2/rooms/:sixCharacterCode/characters` (requires `Idempotency-Key`)

Every `/api/rooms` legacy route, including subpaths and WebSocket attempts, now
returns HTTP 410 with `LEGACY_ROOMS_RETIRED`. It does not open a Durable Object.
Other unknown API routes return HTTP 404.

Browser character delivery uses the six-character Room V2 code. Configure its
comma-separated browser origin allowlist with `CHARACTER_INGEST_ORIGINS`; this
CORS setting is separate from `ALLOWED_ORIGIN` and is not an authentication
mechanism. The production configuration includes the hosted character builder
at `https://dhsheet.top`.

The candidate keeps only the `ROOMS_V2` binding. Wrangler migration history is
append-only: `v1` created the legacy class, `v2-json-desktop` created Room V2,
and `v3-retire-legacy-rooms` declares deletion of the legacy class. This
repository change does not deploy that deletion to Cloudflare.
