# Hear the Shape

An instrument for Mark Kac's 1966 question: *can you hear the shape of a drum?*

Draw any closed outline. A soap film stretches across it, the browser solves for every note
that outline can ring, and you play it. Strike it anywhere: the sound changes with where you hit.
Hold one mode and sprinkle dust to watch it gather into that shape's Chladni figure. Sing, and the
modes near your pitch answer. Then press **Two drums**: two different shapes with identical spectra.

Live: https://brianskcheng.github.io/cool-stuff/hear-the-shape/

## What runs in the page

| Stage | How |
| --- | --- |
| Outline → unknowns | Rasterised to a grid ~60 cells across; every interior node is an unknown (1.5k–4k). |
| Operator | Five-point Dirichlet Laplacian: sparse, symmetric positive definite. |
| Eigen-solve | Banded Cholesky (bandwidth ≈ one grid row), then block Lanczos (block 3) on A⁻¹ with full re-orthogonalisation and Rayleigh–Ritz. Lowest ~90 converged modes, in a Web Worker, typically < 1 s. |
| Sound | One resonator per mode in an AudioWorklet. Strike weights φₖ(p): the Green's function. Skin uses f ∝ √λ; steel and glass reuse the same modes with the plate law f ∝ λ (an approximation). |
| Picture | WebGL2 height field u = Σ aₖ φₖ e^(−t/τₖ) sin Ωₖt, slowed ~100×, shaded as thin-film interference over 8 wavelengths. |
| Dust | Grains random-walk with step ∝ local RMS displacement, so they settle on nodal lines. |
| What you *can* hear | Weyl's law N(λ) ≈ Aλ/4π − P√λ/4π + c, fitted to the spectrum, recovers area and perimeter. |
| What you can't | The Gordon–Webb–Wolpert pair (1992). Here it is found from scratch: of all 318 shapes made of seven half-squares, exactly one pair shares a spectrum on the grid, agreeing to ~10⁻¹¹. |

No dependencies, no build step. Plain ES modules: `index.html`, `app.js`, `gl.js`, `audio.js`,
`bank.js` (worklet), `solver.js` (worker), `geom.js`, `shapes.js`.

## Run and check

```sh
npx http-server .            # any static server; workers and worklets need http(s), not file://
node tests/check.mjs         # exact square spectrum, isospectral twins, Weyl recovery, audio levels
node tests/heptaboloes.mjs   # enumerate the 318 heptaboloes and find the isospectral pair
```

Keys: `D` draw · `T` two drums · `S` dust · `1`–`9` hold a mode · `Space` strike · `Esc` release.
