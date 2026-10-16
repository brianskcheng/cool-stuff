# Eigendrum

**Can you hear the shape of a drum?** Draw any shape and it becomes a playable drum. This page solves the wave equation on your outline in about a second, in plain JavaScript in your browser, and gives you every resonant mode. You can see each mode, hear it, and check how much of the shape the sound gives away.

Open `index.html` through any static server (modules, a Web Worker and an AudioWorklet need `http(s)://`, not `file://`).

## What you can do

- **Draw a drum.** Drag outside the current drum to draw a new one. With the Draw tool, a loop drawn *inside* the drum cuts a hole and a loop drawn outside adds another membrane.
- **Play it.** Tap to strike. Drag across the head to rub it. Striking near the rim sounds brighter than striking the centre, as on a real drum.
- **See the modes.** Tap any line in the spectrum strip, or use ← →, to show a single mode. The bright lines are its nodes.
- **Chladni sand.** Sprinkle sand. While a mode is held, the grains walk onto its nodal lines.
- **Hear the geometry.** The panel fits Weyl's law to the 64 frequencies and recovers the drum's area and rim length from the sound alone.
- **Two drums, one voice.** This is the Gordon–Webb–Wolpert isospectral pair: two different shapes with identical spectra. They are solved on lattice-aligned grids, so even the discrete problems are exactly isospectral. All 64 frequencies agree to about 10⁻¹⁴. There's a blind listening test.
- **Tune it like a tabla.** Paint mass onto the head. *Harmonize* runs a Gauss–Newton optimiser on the mass distribution, using ∂λ/∂ρ = −λφ², to pull the overtones onto the harmonic series. This is the effect C. V. Raman studied in the tabla.
- **Share.** The URL encodes your outline, so a link reproduces your exact drum.

## How it works

| Piece | File | Notes |
|---|---|---|
| Eigen-solver | `js/solver.js` | Grid discretisation of −∇²u = λρu with u = 0 on the rim. The boundary is placed at the true distance from each grid point to the curve, so accuracy is roughly second order. Envelope Cholesky of the 5-point Laplacian, then shift-and-invert block Lanczos with full reorthogonalisation; the block start resolves repeated eigenvalues. Runs in a Web Worker. |
| Sound | `js/worklet.js`, `js/audio.js` | One damped complex resonator per mode in an AudioWorklet. Strikes, rubbing and held tones inject energy, so polyphony is free. Above the 64 computed modes, about 140 more are drawn from Weyl-law statistics to restore the attack's brightness. These are audio only; nothing on screen uses them. |
| Rendering | `js/gl.js` | WebGL2. The mode sum is uploaded as an RG16F field, smoothed with a bicubic B-spline, lit like a lacquered head, and drawn with analytic nodal lines. |
| Spectrum | `js/spectrum.js` | Log-frequency staff with the harmonic series of the fundamental drawn as ghost ticks. |
| Shapes | `js/shapes.js` | Presets, stroke smoothing, URL encoding. |
| App | `js/app.js` | State, input, sand, Weyl fit, harmonize optimiser, UI. |

Accuracy checks (run in Node against `js/solver.js`):

- **Unit square:** matches the exact discrete eigenvalues to about 10⁻¹⁰.
- **Disc:** within 0.1% of the Bessel zeros at about 8,000 grid points.
- **GWW pair:** the two drums' first 64 eigenvalues agree to 2×10⁻¹⁴.

## Keys

`Space` strike · `←` `→` step modes · `Esc` release · `1`–`9` presets · `0` random · `P` `D` `M` tools · `S` sand · `I` isospectral pair
