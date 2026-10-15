"""Builds the itch.io upload: python itch/build.py  ->  itch/bocage-itch.zip
Pack of the battle viewer as a self-contained HTML5 game (index.html at the root of the zip).
Run `npm run viewer:build` in squad/ first so squad/viewer/dist/viewer.js is current."""
import io, os, re, zipfile

here = os.path.dirname(os.path.abspath(__file__))
viewer = os.path.join(here, "..", "squad", "viewer")
out = os.path.join(here, "bocage-itch.zip")

html = io.open(os.path.join(viewer, "index.html"), encoding="utf-8").read()
# Inside itch's frame "/" is itch's own origin: send Home to the real site, and say where this came from.
html = html.replace('href="/" title="Back to the simulation list">&#8962; Home</a>',
                    'href="https://sim.shaykas.com/?utm_source=itch" target="_blank" rel="noopener" title="More simulations">&#8962; sim.shaykas.com</a>')
# Link previews and canonical belong to the real page, not to an itch frame.
html = re.sub(r'<link rel="canonical"[^>]*>\n?', "", html)
assert "dist/viewer.js" in html

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.writestr("index.html", html)
    z.write(os.path.join(viewer, "favicon.svg"), "favicon.svg")
    z.write(os.path.join(viewer, "dist", "viewer.js"), "dist/viewer.js")
    audio = os.path.join(viewer, "audio")
    for name in sorted(os.listdir(audio)):
        z.write(os.path.join(audio, name), f"audio/{name}")
print(out, round(os.path.getsize(out) / 1e6, 1), "MB")
