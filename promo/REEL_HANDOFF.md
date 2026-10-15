# Handoff: a short vertical reel for Bocage

You are picking this up cold. This document is everything you need to cut a 15–30 second vertical video (Instagram Reel, and reusable for TikTok and YouTube Shorts) announcing that **Bocage** is on itch.io. Read it top to bottom once, then work from the checklists.

## 1. The goal

Announce that Bocage, a free browser WW2 battle simulator, is now on itch.io, and get people to tap through and play. The reel should make a stranger understand in about two seconds that this is a real battle where every soldier is simulated, then show them the thing that sells it: calling in artillery and watching a house fall in.

**One call to action:** play it free in your browser at `shaykas.itch.io/bocage`.

Audience: indie-game and wargame fans scrolling with the sound often off. Tone is quiet and confident, not hype. It should read as a person showing something they made, not an ad.

## 2. Facts you may use (and what not to claim)

Safe, verified claims:
- Free, runs entirely in the browser, no install, no account.
- Procedurally generated: ground, weather and forces come from a seed number; the same seed always gives the same battle.
- Every soldier is simulated one second at a time. Squads bound, pin, flank and assault.
- Most shots miss; suppression and morale matter; medics treat wounded under fire.
- Wounds are tracked per body part and followed for 30 days afterwards.
- Houses can be shelled until they collapse.
- One button calls in a barrage; you can tap a soldier to see who he is; there is a "skip to result" button and a "battle of the day".
- Set in the Normandy hedgerows (bocage), June 1944. A US rifle platoon attacks a German position.

Do **not** claim:
- That it is historically accurate or a reconstruction of a real action. It simulates the *kind* of fight.
- Anything about AI, or how it was built. Do not mention Claude or any AI tool.
- Numbers about players or reviews. There is no social proof to quote yet.
- That there is a mobile app. It is a web page.

## 3. Brand

| | |
|---|---|
| Wordmark | `BOCAGE`, uppercase, letter-spaced, pixel font |
| Heading font | Silkscreen (Google Fonts) |
| Body font | VT323 (Google Fonts) |
| Background | `#0c0e08` (near-black olive), the game page uses `#16180f` |
| Text | `#ece6cc` (warm off-white) |
| Accent | `#e8c84a` (gold) |
| Barrage red | `#7a2a14` with border `#ff9a40` |
| Secondary blue | `#1c3a58` with border `#6ab0f0` |
| Muted | `#a8a888` / `#9c978b` |

Keep the look the same as the existing story image (`promo/bocage-itch-story.png`). Pixels stay crisp: scale footage with nearest-neighbour (`flags=neighbor`), never smooth it.

## 4. Source material already on disk

Repo root: `C:\Users\S K\Documents\Worldbuild`. Everything below is relative to it.

### Footage (landscape, 1920x1080, 60 fps, 48 s, has audio)
| File | What it is |
|---|---|
| `promo/battle-mode-promo-notext.mp4` | **Use this one.** Same battle with no captions, no report, no end card. |
| `promo/battle-mode-promo.mp4` | Same footage with captions ("EVERY SOLDIER SIMULATED", "CALL IN A BARRAGE", ...), an after-action report near 41–45 s and an end card. Only useful as a reference. |

Approximate beats in the footage (scrub to find exact frames, they drift by a second or two):
- 0–8 s: opening firefight, camera following the fighting.
- ~9–15 s: first barrage lands; explosions, smoke, men diving for cover.
- ~17–22 s: squads flank and assault along hedgerows.
- ~23.5–30 s: camera on a building; barrage drops; **the house collapses** into rubble and dust. This is the best single moment.
- ~34–38 s: third barrage.

The footage contains the game's real UI (clock, buttons, small alert cards). That is fine and even good, because it shows what the player gets. If a shot is cluttered, crop into the action rather than hiding the UI.

### GIFs (560x315, short loops)
- `itch/barrage.gif`: about 4 s of a barrage.
- `itch/collapse.gif`: about 4.5 s of a house falling in.

### Stills
- `promo/bocage-itch-story.png`: the 1080x1920 story image. Match its look.
- `itch/banner.png` (1920x500), `itch/cover.png` (630x500), `itch/shot1.png`..`shot5.png` (1280x720 game screens: opening, barrage, unit card, full control, after-action report).

### Audio
The footage has the game's own sound (gunfire, whistles, explosions, shouts). No music exists. See section 7.

## 5. Output spec

- **Format:** MP4, H.264, AAC audio.
- **Size:** 1080 x 1920 (9:16).
- **Frame rate:** 30 fps is fine; 60 fps looks smoother for the pan if the file stays small.
- **Length:** 15–25 seconds. Hard maximum 30.
- **File size:** under 100 MB; aim for under 40 MB.
- **Safe zones:** keep all text and the key action inside the middle of the frame. Roughly the top 250 px and the bottom 340 px are covered by Instagram's interface. Put nothing important there.
- **Captions:** the reel must make sense with the sound off. Burn in short captions.
- **Save to:** `promo/bocage-itch-reel.mp4`. Also export a still of the first frame to `promo/bocage-itch-reel-cover.png` (the reel cover image).

## 6. Suggested cut (about 20 s)

Treat the timings as a starting point. The first second matters most.

| Time | Visual | Caption (burned in) |
|---|---|---|
| 0.0–1.5 | Hard open on the barrage at its most dramatic: smoke, explosions, men diving. No logo first. | `NOW ON ITCH.IO` |
| 1.5–5 | Continue the barrage, pushed in tight on the impact. | `Every soldier simulated.` |
| 5–9 | Squads along the hedges, flanking. | `Squads pin, flank and assault.` |
| 9–15 | Camera on a house; barrage lands; it collapses. Let this play uncut. | `Call in the artillery.` |
| 15–18 | Quick cut to `itch/shot5.png` (the after-action report) or the unit card. | `Every wound tracked for 30 days.` |
| 18–20 | Title card: wordmark, tagline, link. Hold 2 s. | `BOCAGE` / `Free in your browser` / `shaykas.itch.io/bocage` |

Notes:
- The source is landscape. For a 9:16 frame, crop a vertical slice (about 608 px wide of the 1080 px height) and scale it up. Pan the crop window slowly to follow the action so it never feels static. Do not letterbox with big black bars; if you must show the whole 16:9 frame, place it in the upper-middle with the caption block below and the background from the story image.
- Cut on the explosions. Match the cut to the sound.
- Avoid more than about 5 shots in 20 seconds.

## 7. Audio

- Keep the game's real sound: it is the selling point. Mix so explosions peak near -3 dBFS, and use a gentle limiter.
- Optionally fade the audio in over 0.3 s and out over 0.5 s.
- Do not add licensed music. If you add any, it must be royalty-free for commercial social use, and you must record where it came from in the handoff note.

## 8. Useful commands

ffmpeg is installed (`ffmpeg`, `ffprobe` on PATH on this machine).

Crop a vertical slice centred on x=1100, scale to 1080x1920 with crisp pixels, no pan:
```bash
ffmpeg -y -ss 9 -t 6 -i promo/battle-mode-promo-notext.mp4 \
  -vf "crop=608:1080:796:0,scale=1080:1920:flags=neighbor,fps=30,format=yuv420p" \
  -c:v libx264 -crf 20 -preset slow -c:a aac -b:a 192k shot_barrage.mp4
```
(`crop=W:H:X:Y`, here X is the left edge of the slice.)

Slow pan across the footage (crop window moves from x=600 to x=1100 over 6 s):
```bash
ffmpeg -y -ss 9 -t 6 -i promo/battle-mode-promo-notext.mp4 \
  -vf "crop=608:1080:'600+(500*t/6)':0,scale=1080:1920:flags=neighbor,fps=30,format=yuv420p" \
  -c:v libx264 -crf 20 -preset slow -an shot_pan.mp4
```

Join clips and burn captions: build the captions as transparent PNGs or use `drawtext`. Silkscreen and VT323 are not installed system-wide; download them from Google Fonts, or render the text in a browser (Playwright is in `squad/` and the scratch scripts use `playwright-core`) and overlay the PNGs, which is how `bocage-itch-story.png` was made.

### Regenerating footage (only if the existing clips are not enough)
The footage is recorded from the live viewer with a frame-exact capture. Scripts: `promo/shoot.mjs` (captures frames and audio) and `promo/build.mjs` (encodes). They need the viewer running at `http://localhost:5174` (`node --no-warnings squad/viewer/serve.ts 5174` after `npm run viewer:build` in `squad/`), `playwright-core` installed, and a Chromium. Seed 19 was used. Re-recording takes about 3 to 7 minutes and is rarely necessary.

## 9. Links

- Play page: `https://shaykas.itch.io/bocage`
- Full-size site: `https://sim.shaykas.com`
- For anywhere a link can be clicked, use `https://shaykas.itch.io/bocage` (no tracking parameter needed). On Instagram, attach it with a **link sticker**; the caption text itself cannot be clicked.

## 10. Caption and copy for the post itself

Instagram caption (short):
> Bocage is now on itch.io. A free WW2 battle simulator that runs in your browser: every soldier simulated, and you can call in the artillery. Link in my story.

Hashtags (keep to 5 or fewer): `#indiegame #gamedev #wwii #simulation #pixelart`

## 11. QA checklist before you hand back

- [ ] 1080x1920, plays correctly, under 30 s.
- [ ] The first frame is striking on its own and works as the cover.
- [ ] Every caption readable with the sound off, and inside the safe zones.
- [ ] No claim from the "do not claim" list.
- [ ] Pixels are crisp (no blur from smooth scaling).
- [ ] Audio does not clip; no silent gaps at cuts.
- [ ] Link and name are spelled correctly: `shaykas.itch.io/bocage`, `BOCAGE`.
- [ ] Saved to `promo/bocage-itch-reel.mp4`, with the cover still beside it.
- [ ] A one-paragraph note saying what you changed and anything you could not do.

## 12. Open questions for the owner

Ask Shay if any of these block you; otherwise use the defaults.
- Music or no music? Default: none, game audio only.
- Do you want a version with the gameplay UI cropped out? Default: leave the UI in.
- Should the reel end on the link card or on the collapse? Default: link card, 2 seconds.
