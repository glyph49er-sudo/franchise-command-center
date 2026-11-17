# Franchise Command Center

This repo contains two working layers:

- `fdl-bot/` runs the Discord bot and owns the EA franchise connection.
- `src/` is the browser dashboard for the franchise hub, team directory, and league status.

## Local setup

1. Install Node dependencies in the repo root and the bot folder.
2. Copy `fdl-bot/.env.example` to `fdl-bot/.env` and fill in the Discord credentials.
3. Start the bot:

   ```bash
   cd fdl-bot
   npm install
   npm start
   ```

4. Start the read-only API when you want the web dashboard to read franchise data:

   ```bash
   cd fdl-bot
   npm run start:api
   ```

5. Run the web app from the repo root:

   ```bash
   npm install
   npm run dev
   ```

## Project status

- Static dashboard shell completed.
- Team directory and Franchise Hub layout completed.
- Read-only API for real franchise exports completed.
- Additional bot-side EA and claim progress work remains to be connected to live runtime data as the exact league setup is configured.
