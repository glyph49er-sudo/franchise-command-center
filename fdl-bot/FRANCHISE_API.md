# Franchise Hub read API

`franchise-api.js` is an optional read-only JSON API that lets a separately hosted Franchise Hub read exports from the bot's EA connection. EA access/refresh tokens stay in `data/ea-connection.json` on the bot host and are never included in responses.

## Run it

From `fdl-bot/`, run `npm install` once, configure the same `.env` used by the bot, then start the bot and API as separate processes:

```sh
npm start
npm run start:api
```

The API binds to `127.0.0.1:8787` by default. It requires the bot to have already completed `/ea-connect`. Use a TLS reverse proxy with authentication/access controls to make it reachable outside the bot host. Do not bind it to `0.0.0.0` directly on a public server.

Environment settings:

```dotenv
FRANCHISE_API_HOST=127.0.0.1
FRANCHISE_API_PORT=8787
FRANCHISE_API_ORIGINS=https://your-franchise-hub.example
```

Set `FRANCHISE_API_ORIGINS` to a comma-separated allowlist of browser origins. CORS is not authentication; protect externally reachable deployments at the reverse proxy. The service only accepts GET and OPTIONS, limits supported stage/week inputs, caches exports for up to 60 seconds, and has no endpoint that mutates franchise data.

## Endpoints

- `GET /health` — reports whether a saved EA connection exists, without credential fields.
- `GET /api/teams`
- `GET /api/standings`
- `GET /api/schedule?week=0&stage=1`
- `GET /api/roster?teamId=123&teamIndex=0`
- `GET /api/free-agents`
- `GET /api/leaders?week=0&stage=1` — raw passing/rushing/receiving/defense export groups for the UI to rank.
- `GET /api/league-info`

Week/stage defaults are `0`/`1`; the correct week index depends on the Madden franchise export. Confirm it against your league before relying on displayed results. The EA API is unofficial and its response schema may change.

## Verify

```sh
npm test
```
