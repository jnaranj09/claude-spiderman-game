# Spider-Man · Slop New York

Web-swing through Manhattan on your phone. This is [Slop New York](https://github.com/mrdoob/slop-newyork) by
mrdoob (a three.js / WebGPU simulation of the whole island) with its pedestrian replaced by Spider-Man and a
web-swinging controller built for one thumb.

It's a static site with no build step: serve the folder over HTTP (for example `python3 -m http.server`) and open
`index.html`, or publish it with GitHub Pages.

## Controls

| | Touch | Keyboard | Gamepad |
|---|---|---|---|
| Swing (hold) / let go (release) | big red **WEB** button | Space | A or RT |
| Steer, pump the swing, run | left stick | W A S D / arrows | left stick |
| Look around | drag the screen | drag | right stick |

Hold **WEB** and Spider-Man jumps, fires a web at the nearest building and keeps chaining swings on his own. Steer
with the stick. Let go to fly, and press again to catch the next building. If you fly into a wall he sticks to it:
let go to climb, and he vaults onto the roof at the top. Hold WEB on a wall to kick off it and swing on.

The other vehicles (taxi, bike, helicopter) are still in the mode bar, and the time-of-day, teleport and map
controls work as in the original.

## How the swing works

All of the swinging lives in [`js/spiderman.js`](js/spiderman.js).

**1. The web sticks to real buildings.** Every building in the city has a box collider (some are rotated to follow
Broadway and other off-grid streets). Pressing WEB casts a fan of rays (ahead, upward, left and right) against
those boxes with a slab test. Each hit is scored on distance, height, how far ahead it is, which hand's turn it
is, and how low the resulting arc would dip. The winner is a point *on an actual facade*, with that face's
normal, so the white strand ends exactly on the wall and a web splat is stuck flat onto it.

**2. The pivot isn't quite where the web is (the visual trick).** If the pendulum really pivoted on a facade 20 m
to your side, gravity would swing you sideways into that wall. So the physics pivot is the anchor pulled 95% of
the way back over your line of travel, and eased toward the middle of the street (found with two sideways rays).
The strand is still drawn to the facade and the body hangs toward it, so it reads as a web stuck to the building
while you swing straight down the avenue. Alternating hands put the anchors left, right, left, right, the way it
looks in the films.

**3. The pendulum is real.** Gravity (a snappy 22 m/s²) pulls you down. The web is an inextensible rope: whenever
you're farther from the pivot than its length, you're projected back onto the sphere and the outward part of your
velocity is removed. That one constraint is what makes a natural arc, fast at the bottom and slow at the ends. A
gentle reel-in keeps the bottom of the arc ~4.5 m above the street.

**4. Easy mode is built in.** While WEB is held, each swing lets go on its own about 45° up the far side (where
there's still speed to carry), adds a small forward and upward fling, and fires the next web. The upward fling
fades out above ~55 m so chains stay among the buildings instead of climbing over them. With no steering input,
momentum within 25° of an avenue eases onto it (the city's axes follow Manhattan's grid).

There's also wall clinging and climbing, rooftop landings, release flips, a camera that won't pass through
buildings, a speed-based field-of-view kick, and a synthesized *thwip*.

Add `?debug` to the URL to expose the simulation as `window.spiderDebug` (the play tests use it).

## Tests

```sh
node --test tests/*.cjs tests/*.mjs
```

`tests/spiderman.test.cjs` covers the ray casts, anchor choice, the rope constraint, chained swinging down a
synthetic avenue, landing, wall climbing, rooftop spawning and camera clipping.

## Credits and license

City, renderer and everything except the Spider-Man mode: [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork)
(MIT, see [LICENSE](LICENSE)). Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
(ODbL). Third-party data and dependencies keep their own licenses.

Spider-Man is a trademark of Marvel. This is an unofficial fan project, not affiliated with or endorsed by Marvel
or Sony.
