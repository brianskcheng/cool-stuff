# The Museum of Other Hands

A first-person puzzle in four gallery rooms whose walls are glued to themselves.

Walk out through one wall and you come back in through the opposite one. Through every glued wall
you can see the room again and again, with you standing in each copy holding a red balloon. In the
twisted rooms, alternate copies are mirror images: the wall text reads backwards and your twin holds
the balloon in the other hand. Walk round the twist once and you are the mirrored one. That is
how the doors open: a left-hand print for a visitor with two right hands, and an L-shaped key in a
J-shaped lock.

Live: https://brianskcheng.github.io/cool-stuff/other-hands/

| Room | Surface | Gluing (west↔east, south↔north) | Puzzle |
| --- | --- | --- | --- |
| I · The Loop | cylinder | straight, wall | the door is behind the glass |
| II · The Torus | torus | straight, straight | the door is in the far quarter |
| III · The Twist | Möbius band | twisted, wall | a left-hand print |
| IV · The Klein Bottle | Klein bottle | straight, twisted | an L key, a J lock |
| ∞ · Free walk | your choice | any flat combination | — |

## How it is built

- **Space.** The room is a square F. You walk in its universal cover: the plane tiled by copies g·F.
  Every deck transformation is `(x, z) ↦ (±x + a, ±z + b)`, stored as four numbers (`js/group.js`).
  A copy is mirrored when the two signs differ.
- **Rendering.** The room is built once and drawn instanced, one instance per deck transformation
  near you (about 80). Mirrored instances reverse winding, so culling is off. Lighting is computed
  in each copy's own frame. Fog fades the copies into the white. WebGL2, no libraries (`js/render.js`).
- **You.** The camera is never mirrored. Your body is drawn in every copy except the one you stand
  in, at `g ∘ h⁻¹`, where `h` is your current copy.
- **Puzzles.** A hand print or keyhole seen in copy `g` has its chirality flipped when `g` is mirrored.
  A key you pick up keeps the chirality of the copy you took it from. Matching is decided in the
  cover, so it is exactly what you see.
- **Collisions.** Colliders are axis-aligned boxes in F, carried into the 3×3 copies around you.
- **Floor.** Ambient occlusion and a soft key-light shadow are baked per room, including whatever
  stands across a seam (`js/rooms.js`).
- **Sound.** Synthesised cues. A twisted seam plays its chime mirrored: falling, and swapping ears.

```sh
npx http-server .              # any static server
node tests/group.test.mjs      # the deck-group bookkeeping every room relies on
```

Controls: `WASD` walk, mouse look (click to capture), `E` use, `Shift` run. On touch: left thumb
walks, right thumb looks, and the Use button acts.

After Jeff Weeks, *The Shape of Space*, and his Torus Games.
