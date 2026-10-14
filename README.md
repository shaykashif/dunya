# dunya

Two deterministic simulations that run in the browser, served from sim.shaykas.com:

| Path | What | Source |
| --- | --- | --- |
| `/` | Chooser page (Battle first, Civilization second) | `site/` |
| `/squad/` | Normandy 1944 squad combat | `squad/` |
| `/civ/` | The village simulation | `village/` |

`node --no-warnings site/serve.ts` mirrors that layout locally on http://localhost:5175 (build each viewer first with `npm run viewer:build` in `squad/` and `village/`).
Link-preview (Open Graph / Twitter) images live in `site/og*.png`; regenerate them with `node --no-warnings site/og.ts`.
nginx config: `village/deploy/sim.shaykas.com.conf`.
