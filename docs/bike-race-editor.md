# Bike Race level editor

Developer notes for the level editor in [Bike Race](bike-race.md). Players build a track from ready-made pieces,
ride it, and save it on the phone.

## Track pieces

`public/js/bike-race-pieces.js` (`window.BikeRacePieces` in the page, `require` in Node) has the pieces, the
edits the editor makes to them, and `buildCustomLevel`, which turns a saved level into a level the simulation in
`bike-race-core.js` can ride. It has no DOM code.

| Piece | Shape |
|---|---|
| Short, medium, long line | straight, 4, 8 and 16 m |
| Small, medium, big ramp | arcs turning up 20°, 30° and 40° (radius 9, 10 and 11 m; 0.5, 1.3 and 2.6 m high) |
| Quarter, half, 3/4 loop | arcs of 90°, 180° and 270°, all radius `LOOP_R` (3.4 m) |

Every piece starts at its own origin heading right and curves up (anticlockwise), so a bike rides on the inside
of the curve. The loop pieces share one radius so they close into full loops: a 3/4 loop then a quarter loop, or
two half loops. 3.4 m leaves the rider's head (about 1.9 m above the track) well clear of the far side, and at
normal gravity every bike gets round a full loop even straight off the start pad. Ramps launch a bike at top
speed about 10, 15 and 20 m.

### Levels

A saved level is plain JSON:

```js
{ v: 1, name: 'My level',
  pieces: [{ t: 'ramp2', x: 25, y: 0, a: 0, m: false }, ...],
  finish: { x: 40, y: 2.5, d: 1 } }
```

- `t` is the piece type (`line1` to `line3`, `ramp1` to `ramp3`, `loop1` to `loop3`), `x, y` where the piece's
  origin is, `a` its rotation in degrees (anticlockwise) and `m` whether it is mirrored across its own direction
  of travel (so it curves down instead of up). The world shape is origin + rotate(a) × (x, m ? −y : y).
- Every level has a start pad and a finish pad, flat 12 m lines. The start pad never moves: it runs from x = −3
  to 9 at y = 0 and the bike starts at x = 0. The finish pad stands on its near end at `finish.x, y`, facing right
  (`d` 1) or left (−1), with the flag 3 m along it.
- `sanitize` cleans up a level read from storage: unknown pieces dropped, numbers clamped to ±5000 m, at most
  400 pieces, a name of at most 24 characters.
- `trackKey(level)` is a short hash of the track (not the name), so a best time can be dropped when the track
  changes.

### Edits

The editor numbers everything the way `allPieces(level)` lists it: 0 is the start pad, then the pieces, then
the finish pad. Two ends closer than 2 cm are joined.

- `append(level, type, cursor)` adds a piece whose origin sits on the cursor `{ x, y, dx, dy }`, heading along
  `dx, dy`. If the finish pad stood on that spot, it moves on to the new piece's far end, so the track grows
  towards the finish.
- `rotate(level, i, degrees)` turns a piece about the end it hangs from: the joined end whose neighbour comes
  first. A piece joined to nothing turns about its middle.
- `flip(level, i, 'h' | 'v')` mirrors a piece left to right or upside down. A piece that hangs from an end stays on
  it, joined by whichever of its ends carries on most smoothly from the neighbour: a ramp flipped left to right
  becomes a slope down that levels out, flipped upside down a rounded drop. The finish pad only turns round.
- `moveTo(level, i, from, dx, dy, snap)` is where a dragged piece lands: on a free end of another piece when one
  of its ends is within `snap` metres of it, otherwise with its origin on the half metre grid. `commitMove` puts
  it there.
- `remove(level, i)` deletes a piece. The start and finish pads can't be removed.
- The finish pad keeps to the end of the piece it stands on when that piece is turned, flipped or moved, and goes
  back to where a removed piece hung from.

### Tracks that cross themselves

The track of a built-in level is one line that only goes right, and its loops are special pieces with two halves
in collision groups (see "Loops use collision groups" in the Bike Race notes). An editor track can go anywhere,
and a closed loop comes back down onto the track it started from: the way out of the loop lies on the way in.

`buildCustomLevel` works out the order a rider meets the pieces in (`ridingOrder`: from the start pad, carry on
along the joined piece that continues most nearly straight on, then the one curving up; after a gap, the nearest
end not yet ridden) and each segment's distance along the track. Two segments less than `GHOST_NEAR` (3 m) apart
in space but more than `GHOST_APART` (4.5 m) apart along the track take turns: each gets its own collision group
and is solid only while the bike is on its side of the halfway point between them. In a closed loop that point is
near the top, so the bike rides in over the way out, goes round, and rides out over the way in. Two pieces joined
end to end with nothing else at that spot are always solid near their joint.

In the core this is small:

- `Terrain` takes an optional `s` per segment (distance along the track) and keeps it in `T.s`.
- Each wheel remembers the segment it last touched (`W.seg`), and `Bike.updateGhosts` (called from
  `updateLoops`) sets `bike.pathS` from it, then switches the groups when the bike moves past a halfway point.
  It only runs for levels with `level.ghosts`.
- `level.startTop` makes the bike start on the start pad even if track passes above it.
- `level.finishY` and `level.finishDir`: the bike finishes by crossing the flag's line going the flag's way,
  within a few metres of its height (`Sim.crossedFinish`). Built-in levels don't set them and finish as before.

Built-in levels set none of these, and `node tools/check-bike-levels.js` gives exactly the same times as before.

## Checking

```sh
node tools/check-bike-pieces.js            # about a second
node tools/check-bike-pieces.js --verbose  # lists every check
```

It checks each piece's shape, the edits (adding at the finish, rotating about the joint, flips, snapping, the
grid, removing, cleaning up a stored level), and rides tracks made of pieces with every bike, both with the
computer rider and with gas held and no lean: full loops (3/4 + quarter, two halves, two loops in a row, a loop
straight off the start pad) must be finished going over the top with the rider's head at least 0.8 m from solid
track (it stays about 1.2 m clear), and each ramp must clear a gap (5, 9 and 12 m) and land. It also checks that
the loop can't be ridden without the pass-through, and that a finish turned round is crossed going left.
