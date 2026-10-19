/**
 * The one picture Hypothec uses: a vault, drawn as the contour lines of something shielded.
 *
 * Rings of a squircle (the vault's door), each slightly warped like a topographic line, close
 * in on a keyhole. Four key holders sit on the outer ring; three are joined, the three of
 * four that can sign, and one is marked in the accent colour. Drawn in currentColor, so it
 * follows the theme, and kept faint by the CSS: it is texture behind the work, not a
 * picture to look at. Deterministic, so every build draws the same lines.
 */

const TAU = Math.PI * 2

/* A squircle ring of radius r, warped by a few slow waves (phase k varies per ring). */
function ring(cx, cy, r, k, points) {
  const n = 4 // squircle exponent: a vault door, not a circle
  let d = ''
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * TAU
    const c = Math.cos(t)
    const s = Math.sin(t)
    const warp = 1 + 0.022 * Math.sin(3 * t + k) + 0.014 * Math.sin(5 * t + 1.7 * k) + 0.008 * Math.sin(9 * t + 0.6 * k)
    const x = cx + r * warp * Math.sign(c) * Math.abs(c) ** (2 / n)
    const y = cy + r * warp * Math.sign(s) * Math.abs(s) ** (2 / n)
    d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return `<path d="${d}Z"/>`
}

/**
 * The vault, as an inline SVG. `size` is the drawing's box; `rings` how many contours.
 * `cls` places it (CSS); it is decorative, so hidden from assistive technology.
 */
export function vaultLines({ cls = '', size = 1000, rings = 18, points = 140 } = {}) {
  const c = size / 2
  const outer = size * 0.46
  const inner = size * 0.07
  const step = (outer - inner) / (rings - 1)
  const lines = []
  for (let i = 0; i < rings; i++) lines.push(ring(c, c, inner + i * step, i * 0.9, points))

  // The keyhole at the centre.
  const kr = size * 0.022
  const keyhole = `<circle cx="${c}" cy="${(c - kr * 0.6).toFixed(1)}" r="${kr.toFixed(1)}"/><path d="M${(c - kr * 0.55).toFixed(1)} ${(c - kr * 0.2).toFixed(1)}L${(c - kr * 0.9).toFixed(1)} ${(c + kr * 1.9).toFixed(1)}L${(c + kr * 0.9).toFixed(1)} ${(c + kr * 1.9).toFixed(1)}L${(c + kr * 0.55).toFixed(1)} ${(c - kr * 0.2).toFixed(1)}Z"/>`

  // Four key holders on the outer ring's corners; three of them joined.
  const at = (deg) => {
    const t = (deg * Math.PI) / 180
    const r = outer * 0.93
    return [c + r * Math.sign(Math.cos(t)) * Math.abs(Math.cos(t)) ** 0.5, c + r * Math.sign(Math.sin(t)) * Math.abs(Math.sin(t)) ** 0.5]
  }
  const keys = [at(-45), at(45), at(135), at(225)]
  const [a, b, d] = [keys[0], keys[1], keys[3]]
  const quorum = `<path class="art-quorum" d="M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}L${d[0].toFixed(1)} ${d[1].toFixed(1)}Z"/>`
  const nodes = keys
    .map(([x, y], i) => `<circle class="${i === 0 ? 'art-key art-key-accent' : 'art-key'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(size * 0.011).toFixed(1)}"/>`)
    .join('')

  return `<svg class="art ${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false"><g class="art-lines">${lines.join('')}</g><g class="art-keyhole">${keyhole}</g>${quorum}${nodes}</svg>`
}
