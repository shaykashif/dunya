# dunya

Two deterministic simulations that run in the browser, served from sim.shaykas.com:

| Path | What | Source |
| --- | --- | --- |
| `/` | Chooser page (Battle first, Civilization second) | `site/` |
| `/squad/` | Normandy 1944 squad combat | `squad/` |
| `/civ/` | The village simulation | `village/` |

`node --no-warnings site/serve.ts` mirrors that layout locally on http://localhost:5175 (build each viewer first with `npm run viewer:build` in `squad/` and `village/`).
Link-preview (Open Graph / Twitter) images live in `site/og*.png`. `og.png` is drawn by `node --no-warnings site/og.ts`; `og-squad.png` and `og-civ.png` are real screenshots of each sim, made by `node site/og-shots.mjs` (needs Playwright and `node --no-warnings site/serve.ts 5175` running).
nginx config: `village/deploy/sim.shaykas.com.conf`.
