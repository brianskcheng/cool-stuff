# 九龍城寨 · Kowloon Walled City

A generative, real-time 3D model of the Kowloon Walled City, grown year by year from
post-war squatter huts (1945) into the 14-storey monolith of the 1980s, then demolished
(1993–94) and replaced by a park. Kai Tak arrivals cross it on short final to runway 13.

Single file, no build step: `index.html` (three.js r169 from jsDelivr, fonts from Google Fonts).

## Run it

Open `index.html` in a current browser (it needs WebGL 2 and an internet connection for the
two CDNs), or serve the folder:

```sh
npx serve walled-city
```

## What you can do

| Control | What it does |
| --- | --- |
| Timeline / ▶ | Scrub or play 1945 → 1998. Captions follow the history. |
| Time | Time of day. Windows, shops and neon light up after dusk. |
| Orbit | Free camera around the city. |
| Ride the approach | Chase camera behind an arrival: the IGS lead-in, the right turn at Checkerboard Hill, then final over the rooftops. |
| Walk the alleys | First person at street level. WASD/arrows (or the touch pad), drag to look, Esc to leave. |
| Flight-path limit | Shows the obstacle surface and glide path that capped the city's height. |
| Sound | Synthesised with Web Audio: jet roar and turbine whine with Doppler shift, mahjong tiles behind the windows, dripping pipes in the lanes. |

## How it works

- **Lots and lanes.** The 2.6 ha footprint is split by recursive subdivision. Shallow splits leave
  2–3 m lanes, deeper ones mostly leave party walls, so the result is about 350 buildings,
  close to the real count.
- **Accretion.** One pass per year, where each lot reads only last year's state. Huts appear
  sooner next to settled neighbours. From the late 1950s huts get replaced by towers, and
  towers add storeys faster when their neighbours are taller. Everything stops in 1987.
- **Height cap.** Each lot's cap comes from a simplified runway 13 approach surface
  (3.1° glide path, 1:7 sides), which gives 12–14 storeys. The surrounding Kowloon City
  blocks are held under the same surface.
- **Bridges.** Upper floors bridge the lanes once both neighbours are tall enough, which turns
  the lanes into tunnels over time.
- **Facades.** A single instanced mesh with an injected shader draws every facade from its
  local coordinates: storeys, bays, anti-aliased window cages, shutters, open shops, rain
  streaks and repainted patches. It also decides which rooms have their lights on.
- **Roof and facade clutter.** Antennas, water tanks, rooftop shacks, cages, AC units and
  downpipes read each building's current height from a 1×N float texture. Growing the city
  costs one tiny texture upload per frame, not thousands of matrix updates.
- **Population.** Estimated from floor area, calibrated so 1987 matches the government
  survey's ~33,000. Huts are counted at higher occupancy per m² than towers.

## Model vs history

This is a generative model, not a survey. The outline is approximate. The building layout and
growth are procedural, and the sign text is made up in period style: dentists, clinics,
fish-ball and noodle workshops. The dated events in the captions and the headline figures
come from the historical record: 2.6 ha, about 33,000 residents in 1987, the 14-storey limit,
demolition in 1993–94, the park opening in 1995 and Kai Tak closing on 6 July 1998. The
approach geometry is simplified.

Append `?debug` to the URL to expose a small `window.__kwc` handle for poking at the scene.
