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
| Zip forward (quick tap) | tap **WEB** | tap Space | tap A |
| Run / steer (relative to the camera: up is away from it) | left stick | W A S D / arrows | left stick |
| Dive (in the air) | tap the stick | X | click the left stick |
| Look around | drag the screen | drag | right stick |

Press and hold **WEB** and Spider-Man jumps and fires a web at the nearest building. One press is one web: he stays
on it as long as you hold, swinging to and fro like a pendulum. Steer with the stick. Let go (best on the way up the
far side) to fly on, and press again to catch the next building. **Tap** WEB to zip a web at the
building ahead (preferring walls and rooftops; a roof only a few metres below is fine, and a street light is the fallback) for a smooth push forward and a small hop up that keeps your direction (three in a row, then you need to land, swing or touch a wall). Webs only ever leave his wrist when they will hit something: with
nothing in reach (over a park or a river) no web is thrown.

Hitting a wall fast makes him **run along it** (or straight up it, head-on), keeping his speed. Holding WEB kicks
off and swings on; running up to the top launches him over the roof. Touching a wall slowly makes him **cling**.
Then the stick crawls him: up climbs head-first with long alternating reaches, down goes head-first down the
wall, slower and splayed, and the sides crawl sideways. Let go of the stick and he holds still. Climbing to the
top vaults onto the roof, crawling down to the street stands him up, and pressing WEB kicks off.

**Dive:** in the air, click the stick to dive head-first, falling fast. Click again, fire a web or land to stop. A
web fired out of a dive turns that speed into a big swing. **Swing Cam** (next to 3rd-Person Chase in the camera
menu) rides the arc with him: it leans gently with the swing and looks where he's flying.

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
velocity is removed. That one constraint is what makes a natural arc, fast at the bottom and slow at the ends.
The web never hangs slack (moving in towards the anchor, it's taken in), so it can't snap tight again halfway down
the arc. And the catch is soft: for its first half second the web is a damped spring that firms up, so a fast fall eases
onto the arc instead of kinking into it in one frame. Hang on past the top and he swings back, turning round only
once he's really moving the other way, and the swing slowly dies down. A
gentle reel-in keeps the bottom of the arc ~4.5 m above the street.

**4. Easy mode is built in.** Letting go on the way up adds a small forward and upward fling, and each new web is
aimed along your line of travel. The upward fling fades out above ~55 m so chains stay among the buildings instead of climbing over them. With no steering input,
momentum within 25° of an avenue eases onto it (the city's axes follow Manhattan's grid).

**5. The body is the city's pedestrian, in a suit.** Spider-Man is the same skinned, lofted person the sidewalks
are full of (`js/pedestrians.js`). He wears a costume shader painted from the bind-pose position: red and blue
panels, raised webbing, lenses and a chest spider. His 15 bones are posed by forward kinematics from joint
angles that each move (swing, run, crawl up, crawl down, zip, flip) eases between.

There's also rooftop landings, release flips and zip corkscrews, a camera that orbits around him and won't pass
through buildings, a speed-based field-of-view kick, and a synthesized *thwip*.

Add `?debug` to the URL to expose the simulation as `window.spiderDebug` (the play tests use it).

## Tests

```sh
node --test tests/*.cjs tests/*.mjs
```

`tests/spiderman.test.cjs` covers the ray casts, anchor choice, the rope constraint, press-by-press swinging down a
synthetic avenue, landing, wall climbing and crawling, wall runs, tap zips, rooftop spawning and camera
clipping.

## Credits and license

City, renderer and everything except the Spider-Man mode: [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork)
(MIT, see [LICENSE](LICENSE)). Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
(ODbL). Third-party data and dependencies keep their own licenses.

Spider-Man is a trademark of Marvel. This is an unofficial fan project, not affiliated with or endorsed by Marvel
or Sony.
