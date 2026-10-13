# Pixel art prompts

Prompts for every sprite the viewer currently draws in code (`viewer/src/sprites.ts`, `viewer/src/render.ts`). The tile grid is 16×16 px.

Prepend the shared style line to every prompt so the whole set matches. Generate at the size given, or at 2× or 4× and downscale with nearest-neighbour. Ask for transparent backgrounds wherever you can.

Finished PNGs go in `viewer/assets/`; the code drawings will then be switched over to them.

## Shared style (prepend to every prompt)

> **Style:** 16-bit pixel art, top-down three-quarter view like Worldbox and Stardew Valley, crisp hard pixels, no anti-aliasing, no gradients, limited earthy palette (moss greens, warm browns, slate greys, muted golds), 1px dark outline, light from the top-left, transparent background, Nordic medieval village setting.

## 1. Terrain tiles (16×16, seamless)

1. `16x16 seamless grass tile, short varied grass with a few darker tufts, 4 variations in a row` (repeat with **spring:** bright green / **summer:** deep green / **autumn:** olive and yellowed / **winter:** snow-covered with grass peeking through)
2. `16x16 seamless forest floor tile, dark mossy ground with fallen leaves and needles` (× 4 seasons)
3. `16x16 seamless dirt road tile set: straight horizontal, straight vertical, 4 corners, T-junction, crossroads, packed earth with pebbles` (then a snowy version)
4. `16x16 tilled farm field tiles in a row: bare soil furrows, small green sprouts, tall green crop, golden ripe wheat, harvested stubble, snow-covered furrows`
5. `16x16 river water tile, 4-frame animation sprite sheet, blue with soft white ripple lines, seamless` (plus `icy frozen variant, pale blue with cracks`)
6. `16x16 wooden plank bridge tile over water, horizontal and vertical versions`
7. `16x16 wooden plank floor tile, warm brown boards, seamless`
8. `16x16 grey flagstone floor tile, seamless, for a courthouse interior`
9. `16x16 timber wall tile, dark log wall, seamless, horizontal and vertical`
10. `16x16 grey stone block wall tile, seamless`
11. `16x16 wooden door tile in a log wall, iron handle, seen from above`
12. `16x16 stone well, round grey stone ring with dark water inside and a small wooden crank frame` (plus `dry well with no water`)
13. `16x16 wooden fence tile set: horizontal, vertical, 4 corners, gate`

## 2. Trees (16×16, may overlap upward)

14. `16x16 deciduous tree sprite, round canopy and short trunk, 3 variations` (× **spring:** fresh green / **summer:** deep green / **autumn:** orange and gold / **winter:** bare branches dusted with snow)
15. `16x16 pine tree sprite, triangular layered branches, 3 variations` (plus `snow-laden pine, 3 variations`)

## 3. Buildings

16. `top-down pixel art roof of a Nordic family longhouse, 176x128 px, wooden shingles in rows, central ridge line, red-painted shingles, small stone chimney near the back` (repeat in **blue**, **green**, **purple**, **amber**, and a **snow-covered** version)
17. `strip of a log house front wall seen from the front, 176x16 px, wooden door in the middle and two small windows` (two versions: windows dark / windows glowing warm yellow)
18. `small stone chimney with grey smoke puff animation, 8x24 px, 4 frames`
19. `top-down pixel art village courthouse, 240x144 px, grey slate roof, stone columns across the front, wide stone steps, red banner on a wooden pole` (plus a `snow-covered roof` version and a `glowing golden bell indicator, 2 frames`)
20. `top-down pixel art village grain store, 112x96 px, brown plank roof with a painted grain-sack emblem`
21. `16x16 stone hearth seen from above, 3 sprites: cold ashes, small fire frame 1, small fire frame 2`
22. `16x16 burlap grain sack, slightly lumpy, tied at the top`
23. `wooden council table and benches seen from above, sprite pieces on a 16px grid`

## 4. People (8×12; generate at 32×48 and downscale)

24. `tiny medieval villager man, 8x12 px, front-facing, simple tunic, sprite sheet: idle, walk frame 1, walk frame 2, lying asleep` (make the tunic a solid **magenta placeholder colour** so it can be recoloured per house)
25. `tiny medieval villager woman, 8x12 px, long dress and long hair, sprite sheet: idle, walk 1, walk 2, lying asleep` (same magenta placeholder)
26. `tiny medieval child, 8x8 px, sprite sheet: idle, walk 1, walk 2, asleep`
27. `tiny swaddled baby held in arms, 6x5 px`
28. `tiny elderly villager with white hair and a slight stoop, 8x12 px, idle and walk frames`
29. `villager riding a brown horse, 14x14 px, side view, 2-frame trot`

Overlays (tiny, transparent):

30. `tiny wood axe held in hand, 3x8 px` / `same axe with a red bloody blade`
31. `tiny flintlock musket held upright, 2x10 px`
32. `tiny red blood stains overlay for a 8x12 character's clothes`
33. `pixel selection ring, yellow ellipse, 14x4 px`
34. `pixel prison bars overlay, 10x14 px, dark iron`

## 5. Animals (facing right; generate at 4× and downscale)

35. `tiny white woolly sheep, 10x7 px, side view, sprite sheet: idle, walk 1, walk 2`
36. `tiny black-and-white dairy cow, 12x8 px, side view, idle, walk 1, walk 2`
37. `tiny white chicken with red comb, 6x6 px, sprite sheet: idle, peck, walk`
38. `tiny brown horse with dark mane, 12x9 px, side view, idle, walk 1, walk 2, saddled variant`
39. `tiny grey wolf, 12x6 px, side view, sprite sheet: idle, run 1, run 2, lunge attack, and a hunting variant with glowing red eyes`
40. `16x16 dead animal carcass lying on its side with a small blood pool`

## 6. Activity icons (7×7 bubble icons; generate at 28×28 and downscale)

> **Prefix for each icon:** `tiny 7x7 pixel icon, bold readable silhouette, 1px outline, transparent background:`

41. `bread loaf` (eat)
42. `blue water drop` (drink)
43. `Zzz` (sleep)
44. `red berries` (forage)
45. `wood axe` (gather wood)
46. `small campfire flame` (tend fire)
47. `wheat stalk` (harvest)
48. `green sprout in soil` (plant)
49. `hammer` (repair)
50. `wooden crate` (store goods)
51. `hunting musket` (hunt)
52. `butcher knife` (slaughter)
53. `baby face` (tend children)
54. `sheep head` (tend animals)
55. `speech bubble` (socialize)
56. `wrapped gift` (give)
57. `outstretched open hand` (request food)
58. `small pink heart` (comfort)
59. `red heart` (court)
60. `heart and gold ring` (propose)
61. `broken heart` (break up)
62. `heart pierced by an arrow` (elope)
63. `black thief mask` (steal)
64. `short sword` (attack)
65. `rolled scroll` (plot)
66. `pair of watching eyes` (stalk)
67. `eyes peering from a bush` (lie in wait)
68. `burning torch` (raid)
69. `running stick figure` (flee)
70. `red exclamation mark` (chase)
71. `magnifying glass` (examine)
72. `question mark speech bubble` (interview)
73. `pointing finger` (accuse)
74. `raised hand swearing an oath` (testify)
75. `wooden gavel` (judge)
76. `wooden stocks` (punish)
77. `round wooden shield` (defend)
78. `ear with sound waves` (investigate gunshot)
79. `water drop with red streak` (wash blood)
80. `grabbing hand` (kidnap)
81. `glowing lantern` (search)
82. `small pine tree` (hide)
83. `purple spiral` (mad)
84. `coiled rope` (captive)

## 7. Traces and objects (16×16, transparent)

85. `muddy footprints, two prints` (plus `footprints pressed in snow`)
86. `dark red blood splatter, 2 variations`
87. `villager body lying face down, 16x8 px, muted colours`
88. `small stone grave marker with a mound of earth, 8x8 px` (plus `wooden cross grave`)
89. `folded cloth lying on the ground, 6x4 px`
90. `small red exclamation mark marker, 4x8 px`
91. `wolf den: dark hollow under rocks and tree roots, 32x24 px`

## 8. Effects (short animations)

92. `musket muzzle flash and grey smoke puff, 16x16, 4-frame animation`
93. `hit spark, white and yellow star burst, 8x8, 3 frames`
94. `expanding yellow scream ripple ring, 32x32, 4 frames`
95. `raindrop streak 1x4 px and snowflake 2x2 px particles`
96. `soft warm orange light glow, 64x64, transparent edges, for a hearth at night` (one place where a smooth gradient is fine)

## 9. Interface icons (12×12)

> **Prefix:** `12x12 pixel art UI icon, 1px outline, transparent:`

97. `crossed swords` (fight)
98. `skull` (death)
99. `scales of justice` (council)
100. `flame` (raid)
101. `purple swirl` (madness)
102. `iron chain links` (kidnapping)
103. `wolf head` (wolf attack)
104. `heart with an arrow` (elopement)
105. `broken heart` (marriage forbidden)
106. `sprout`, `sun`, `orange leaf`, `snowflake` (seasons)
107. `sun`, `cloud`, `rain cloud`, `storm cloud with lightning`, `snow cloud` (weather)
108. `bread`, `wheat sheaf`, `sheep`, `crossed swords` (stats)
109. `magnifying glass`, `lightning bolt`, `purple spiral` (powers)
110. `9-slice UI panel frame, dark brown wood with gold corner studs, 24x24` (plus a `button`, normal and pressed, 24x12)

## Tips

- **Recolouring per house:** keep shirts, roofs and banners a flat placeholder colour (magenta works) so the code can recolour them into the five house colours.
- **Sprite sheets:** asking for a horizontal sheet with frames evenly spaced on a fixed grid (16 px, or the sprite's width) makes slicing trivial.
- **Consistency:** generate one tile or character first, then feed it back as a reference image for the rest, if your generator supports that.
- **Facing:** generate animals facing right only; the code mirrors them.
