# cool-stuff

## [Inversum](https://brianskcheng.github.io/cool-stuff/inversum/)

*Ut pendet continuum flexile, sic stabit contiguum rigidum inversum.* (Robert Hooke, 1675)

Hang a cloth from a ceiling board and gravity pulls it into pure tension. Flip it and the same form stands as a concrete shell in pure compression. This is the method of Gaudí's hanging chain models and Heinz Isler's frozen-fabric shells, running live in the browser.

- About 2,500 nodes and 10,000 tension-only links, simulated with XPBD (extended position-based dynamics). Force flow is drawn on the net.
- Click the cloth to hook it to the ceiling, drag a hook to move it, click a hook to let go. The form re-finds its equilibrium in real time, hanging or standing.
- Six starting forms: four-point pillow, tripod, six-point lotus, barrel vault, ring dome, and a twelve-support grove.
- Live engineering readouts: crown, footprint, covered area, concrete volume and mass, a virial estimate of membrane stress under self-weight, and the share of concrete strength used. It also tells you how much thinner than an eggshell the shell is, proportionally.
- Real sun path for London or Hong Kong on today's date. At dusk, lanterns light up under the shell.
- Export the shell as STL (metres, Z up) or PNG, or copy a link that encodes the design.

Source: [`inversum/index.html`](inversum/index.html). It is a single file that loads three.js from jsDelivr.
