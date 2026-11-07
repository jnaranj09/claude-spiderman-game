#!/usr/bin/env bash
# Renders Spider-Man in the pose, framing & light of the two reference stills (_spidey.html?shot=front|back, through
# the game's own lighting, tone mapping & grade) and compares each with its still: side by side, plus the share and
# mean colour of each cel tone (lit / shadow red & blue, lens, ink) in both.
#   bash tools/spidey-compare/run.sh <front still> <back still> <out dir> [extra query, e.g. &t=midday]
# The stills: the crouching front view (1200x676) and the from-behind rooftop view (800x450) the look was matched to.
# Needs Playwright's Chromium and Python 3 with Pillow.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
FRONT="$1"; BACK="$2"; OUT="$3"; mkdir -p "$OUT"
(cd "$ROOT" && python3 -m http.server 8123 >/dev/null 2>&1 & echo $! > "$OUT/.server"); sleep 1
trap 'kill $(cat "$OUT/.server") 2>/dev/null' EXIT
node "$HERE/shoot.cjs" "$OUT" "shot=front$4" "shot=back$4" 2>&1 | grep -v deprecated || true
# Rough outlines of him in each still (his pixels, for the colour statistics)
F='[[0,505],[60,420],[130,350],[200,300],[300,280],[380,245],[440,215],[455,150],[500,85],[560,65],[640,68],[700,120],[720,190],[720,260],[790,280],[860,300],[910,330],[950,400],[965,470],[965,676],[400,676],[330,600],[240,520],[120,520],[70,580],[0,560]]'
B='[[230,450],[232,280],[245,200],[262,120],[300,95],[345,110],[360,150],[430,140],[520,140],[620,150],[700,165],[785,175],[790,195],[700,210],[620,215],[560,225],[520,240],[500,300],[560,380],[640,420],[680,450]]'
echo FRONT; python3 "$HERE/compare.py" "$FRONT" "$OUT/0.png" "$OUT/0_key.png" "$OUT/cmp_front.png" "$F"
echo BACK; python3 "$HERE/compare.py" "$BACK" "$OUT/1.png" "$OUT/1_key.png" "$OUT/cmp_back.png" "$B"
