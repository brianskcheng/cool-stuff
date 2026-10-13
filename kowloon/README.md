# 九龍城寨 · Accretion

The Kowloon Walled City, grown from a seed in your browser. Each lot lives through squatter hut, low concrete block and fourteen-storey tower, then evacuation, demolition and the 1995 garden. Nothing is modelled by hand: the plan, the alleys, every window, sign, antenna, wire and water tank are generated, and every seed grows a different city.

## Run it

It is a static page with ES modules, so it needs to be served over HTTP:

```sh
npx serve kowloon        # or: python3 -m http.server -d kowloon
```

Then open the printed URL. three.js r160 is loaded from jsDelivr; fonts come from Google Fonts.

## What to do

| | |
|---|---|
| **Grow it from 1947** | Time-lapse to 1996. Captions mark the documented milestones. |
| **Click a block** | Address, who is on that floor, year built, and hours of direct sun today on its best face. |
| **Rooftop** | Stand on the tower nearest the approach path and watch the jets come over. |
| **Alley** | Walk the lanes at 1.65 m. Drag to look around. |
| **Fly IGS 13** | Ride an arrival: east towards the checkerboard, 45° right turn, low over Kowloon City onto runway 13. |
| Keys | `Space` play, `←/→` a year, `1–4` camera, `N` time of day, `R` weather, `M` sound, `G` regrow |

## How it works

- **Plan** (`js/city.js`). A binary space partition of the site's bounding box; cuts near the root leave 2.6–3.6 m streets, deeper cuts leave 1–2 m alleys or nothing (a party wall). Lots outside a jittered outline of the real site are dropped and the yamen's courtyard is kept clear. Each lot side is classified as party wall, alley (with its width) or street.
- **Lives of the lots.** Every lot gets a hut generation (1947–57), maybe a 3–7 storey concrete block (1956–69) and usually a tower (peaking around 1973) capped at 14 storeys by the Kai Tak approach. Towers cantilever over alleys up to half the gap. Demolition sweeps across the site from March 1993 to April 1994. Population is gross floor area times occupancy, calibrated so the peak lands at about 33,000.
- **Light.** The current city is rasterised into a 1 m height field. Each facade samples it to find the obstruction across its alley, and the shader turns that into a sky-view factor: alley windows go dark, and their tubes stay on all day. Sun hours (card and stats) march rays toward the real sun position for Hong Kong's latitude and the simulated day of the year.
- **Facades** (`js/facade.js`). One instanced box per podium, tower and roof shack, drawn in a single `MeshStandardMaterial` patched with `onBeforeCompile`: window grid per building, fluorescent / tungsten / TV / red altar-lamp interiors, shopfronts with goods and roller shutters, burglar cages, tile mosaic, rain streaks that deepen with age.
- **Kai Tak** (`js/plane.js`). The approach is a leg on 088°, a 650 m radius 45° right turn and a straight final to the runway 13 threshold, crossing the city about 30 m above the roofs. The aircraft type follows the year (piston, narrow-body jet, jumbo). Landing lights are real spotlights that sweep the rooftops at night; the lead-in strobes chase towards the runway.
- **Sound** (`js/audio.js`). All synthesised with Web Audio: rain, a 100 Hz transformer hum, mahjong tiles being washed, drips, bamboo-scaffold hammering, demolition thuds, park birds, thunder, and a spatial (HRTF) jet with Doppler shift.

## Accuracy

The history captions stick to well-documented facts (walls quarried in the occupation, the height cap from the flight path, ~33,000 residents on ~2.6 ha, the 1987 decision, demolition 1993–94, the park in 1995). Everything else (lot shapes, who lives where, street numbers) is procedural fiction in the city's vocabulary.
