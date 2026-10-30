# Spider-Man · Slop New York

Web-swing through Manhattan on your phone. This is [Slop New York](https://github.com/mrdoob/slop-newyork) by
mrdoob (a three.js / WebGPU simulation of the whole island) with its pedestrian replaced by Spider-Man and a
web-swinging controller built for one thumb.

It's a static site with no build step: serve the folder over HTTP (for example `python3 -m http.server`) and open
`index.html`, or publish it with GitHub Pages.

## Controls

| | Touch | Keyboard | Gamepad |
|---|---|---|---|
| Swing from the left / right hand (hold), let go (release) | **L** / **R** buttons | Q / E | LT / RT |
| Double web (both hands) | both at once (or a thumb on the seam between them) | Q + E | LT + RT |
| Automatic web (picks the side for you) | | Space | A |
| Zip forward (quick tap) | tap **L** or **R** | tap Q, E or Space | tap a trigger or A |
| Run / steer (relative to the camera: up is away from it) | left stick | W A S D / arrows | left stick |
| Dive (in the air) | tap the stick | X | click the left stick |
| Slingshot (on the ground or a roof) | **L** + **R**, pull the stick down, let go | Q + E, S, let go | LT + RT, stick down, let go |
| Glide on / off (in the air) | **Glide** | G | B |
| Whip round a corner / turning zip | stick hard to the side + hold / tap **L** or **R** | A/D + hold / tap Q or E | stick to the side + hold / tap a trigger |
| Look around | drag the screen | drag | right stick |

Press and hold **L** or **R** and Spider-Man jumps and fires a web from that hand, at a building on that side of him
(his left and right as he heads where the stick points, or down the street he's on: never the camera's). One press is one web: he stays on it as long as you hold, swinging to and fro like a pendulum. Steer with the
stick. Let go (best on the way up the far side) to fly on, and press again to catch the next building.

A web from one hand swings him out towards its side of the street, so **alternating L and R zigzags** down it:
finish a swing out to the left, web to the right, and back again. Each swing ends a few metres short of the facade
and never reaches more than ~9 m across, so in a narrow street the zigzag goes from side to side, and in a wide
avenue it stays a weave down the middle. Choose a side that fights where you're going and the swing shows it.
**Both hands at once** fire a **double web**, one to each side, for a dead-straight swing down the middle of the
street and a harder fling when you let go. (The keyboard's Space and the gamepad's A keep the automatic web, which
picks the near side and keeps the swing down the middle for you.) Webs suit his height: low down there's no room for a long arc, so he throws short ones, steeply up and only a
little ahead, to climb; high up, long ones far ahead and low, for long arcs; and everything in between.
From the ground a press always jumps first (a tap there is just a jump). **Tap** a web button in the air to zip a web at the
building ahead (preferring walls and rooftops; a roof only a few metres below is fine, and a street light is the fallback) (aimed well up when he's low, to help him climb; level higher up) for a smooth push forward and a hop up that keeps your direction (three in a row, then you need to land, swing or touch a wall). Webs only ever leave his wrist when they will hit something: with
nothing in reach (over a park or a river) no web is thrown.

Hitting a wall fast makes him **run along it** (or straight up it, head-on), keeping his speed. The stick steers the
run across the wall's face and keeps it going (relative to the camera, as everywhere: along the wall runs that way,
into it runs up it, away from it runs down it, and back against the run brakes); let go of it and he slows to a
stop and clings on. Holding a web button kicks off and swings on; running up to the top launches him over the
roof. Touching a wall slowly makes him **cling**.
Then the stick crawls him: up climbs head-first with long alternating reaches, down goes head-first down the
wall, slower and splayed, and the sides crawl sideways. Let go of the stick and he holds still. Climbing to the
top vaults onto the roof and crawling down to the street stands him up. A web button while crawling, with the
stick the way he's crawling (or facing), shoots a web along the wall that pulls him on, much faster than he
crawls; with the stick the other way he jumps off the building, out into the street; with the stick centred he
kicks off and carries on.

**Fast turns:** push the stick well off the way he's going (into a side street, or back the way he came) and press
a web button.
- **Hold it** to **whip round the corner** on that side: the web goes to the edge of the block he's coming up to (or
  has just passed), where the street opens up beyond it, and he swings round it level, like a tetherball round a
  pole, at the radius he was across from it, keeping all his speed (the web only pulls in towards the corner, square
  to his motion, so it turns him without slowing him). He lets go once he's heading where the stick pointed as he
  threw the web (pull the stick right back for a U-turn) and is flung on into the new street. The camera locks on
  close behind him and turns round the corner with him, just a touch late (normally it lags well behind a change of
  direction), and his body stretches out along the web, feet first away from the corner, as the turn flings him out.
  The camera locks on the same way as he climbs over the top of a wall onto the roof, and as he crawls round a
  corner onto the next face of a building. Why one web and not
  two: what turns you is a pull towards the inside of the turn, and two webs to opposite sides cancel each other's
  sideways pull, which is exactly why the double web and the slingshot go dead straight. With no corner in reach
  (mid-block), it's an ordinary swing web.
- **Tap it** for a **turning zip**: the zip goes to a building that way and turns his flight up to ~45 degrees
  towards it, at a little of his speed. Two zips turn a corner.

**Slingshot:** standing anywhere (the street, a roof), press **both** web buttons together. He shoots a web from each
hand at something ahead, one either side (a wall or a taller building; on an open roof, the roof itself). Pull the
stick down and he backs away from them in a squat, still facing them, stretching the webs (ever more slowly as they
tighten, up to ~7 m back); its sideways part turns his aim. Let go of either button and he's flung forward, from
~16 m/s barely drawn up to ~46 m/s fully drawn, and up at the angle of the webs. Let go before drawing back and the
webs just drop. (One web button alone on the ground waits ~0.1 s for the other before it jumps.)

**Glide:** in the air (or on a web: he lets go first), the glide button spreads the web wings under his arms. They
hold his fall to a slow ~3.4 m/s sink at ~19 m/s, banking round with the stick (faster than he can turn falling);
pushed on he dips the nose and flies faster, pulled back he flares. A fast fall (or a dive) is pulled out of over a
second or two and most of its speed carries on forwards, like a wingsuit: dive, then glide, for the fastest way across
a park or a river. Press glide again to fold the wings, or fire a web: a swing web or a zip that sticks to something
folds them (one with nothing to hit leaves him gliding). Landing or touching a wall folds them too.

**Dive:** in the air, click the stick to dive head-first, falling fast. Click again, fire a web or land to stop. A
web fired out of a dive turns that speed into a big swing. **Swing Cam** (next to 3rd-Person Chase in the camera
menu) rides the arc with him: it leans gently with the swing and looks where he's flying.

The other vehicles (taxi, bike, helicopter) are still in the mode bar, and the time-of-day, teleport and map
controls work as in the original.

## How the swing works

All of the swinging lives in [`js/spiderman.js`](js/spiderman.js).

**1. The web sticks to real buildings.** Every building in the city has a box collider (some are rotated to follow
Broadway and other off-grid streets). Pressing a web button casts a fan of rays (ahead, upward, left and right) against
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
synthetic avenue, landing, wall climbing and crawling, wall runs, tap zips, corner whips and turning zips, the slingshot, gliding, rooftop spawning
and camera clipping.

## Credits and license

City, renderer and everything except the Spider-Man mode: [mrdoob/slop-newyork](https://github.com/mrdoob/slop-newyork)
(MIT, see [LICENSE](LICENSE)). Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
(ODbL). Third-party data and dependencies keep their own licenses.

Spider-Man is a trademark of Marvel. This is an unofficial fan project, not affiliated with or endorsed by Marvel
or Sony.
