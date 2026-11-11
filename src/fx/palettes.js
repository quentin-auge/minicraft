// Shared colour roles: the palettes more than one effect family paints with.
//
// Three-free data only. The TNT blasts and the rocket FX both burn the same
// orange, so the palette lives here once — a copy in each module is a copy
// that drifts.
//
// A palette entry holds roles, not free-form names: `flash` is the shell
// colour of a blast, `embers` the additive palette a fire layer picks per
// particle, `dust` the grey of a soft cloud.
export const PALETTES = {
  // The TNT orange: the shell of a blast and the embers it throws.
  fire: {
    flash: 0xff7a1a,
    embers: [[1, 0.8, 0.1], [1, 0.45, 0.05], [0.9, 0.1, 0.02]],
  },
};
