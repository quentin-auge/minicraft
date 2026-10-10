# ARCHITECTURE.md

Agent guide to the MiniCraft static rewrite: what lives where, how data is
stored, how it flows, and how each system works. Read this before changing code.

## Extension pattern

Every variant family follows the same shape — new variants are registry
entries, never framework forks:

- One exported registry array of spec objects, each with a `key` (e.g.
  future tree-type or hook-kind tables).
- Shared properties live once in a module-local `*_DEFAULTS` object;
  entries spread it first and override only what differs.
- Differing numbers are entry properties; differing behavior is a
  capability flag the framework branches on (`pull`, `blastMode`,
  `locomotion`) or an optional function prop (`grow`, `filter`, `tick`).
  Framework code never switches on kind names — it dispatches through
  the spec.
- Spec keys are stable strings, never array indices, so a future save
  format survives reordering.
- Cosmetic variants follow the recipe: weighted options table →
  deterministic hash picker → baked geometries + shared material.

Single-anatomy numbers stay plain constants: world dimensions, body
physics, render budgets. Single-spec systems become registries only when
a second variant arrives.

Specified, code-free: mobs (locomotion/perch/water/hookability axes),
`PORTAL_TYPES` (frame block, sizes, fill material, sealed-when rule,
arrival mapper, mob policy), `DIMENSIONS` (generator, env preset, spawn,
cleared flag + respawn policy, fly band, hazards, hotbar),
`BOSS_SPECS` (anchor dim, hp-as-hits, path builder, hit palette, weapon
interface, bar binding, death/cleared flag).
