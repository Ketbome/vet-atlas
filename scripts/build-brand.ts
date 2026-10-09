/**
 * Builds the brand mark from the atlas's own scanned dog skull: the lateral
 * silhouette of skull + mandible (public/models/dog/skeletal.glb), traced
 * into one SVG path. Writes components/atlas/mark-path.ts (path data used by
 * the logo) and app/icon.svg + app/apple-icon.png.
 *
 * Run after `pnpm models:dog`: `pnpm brand`.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { readAtlas } from "./lib/glb";

const GRID = 640;
const VIEW = 100;

const bones = await readAtlas(path.join(process.cwd(), "public", "models", "dog", "skeletal.glb"));
const parts = ["dog_skeletal_skull", "dog_skeletal_mandible"].map((n) => bones.get(n)!);

// Lateral-left projection: cranial (-Z) to the left, dorsal (+Y) up, turned
// so the skull's long axis (principal axis of its vertices) is level; the
// Massey head is raised.
let mu = 0, mv = 0, n = 0;
for (let i = 0; i < parts[0].position.length; i += 3) {
  mu += parts[0].position[i + 2];
  mv += parts[0].position[i + 1];
  n++;
}
mu /= n;
mv /= n;
let suu = 0, svv = 0, suv = 0;
for (let i = 0; i < parts[0].position.length; i += 3) {
  const du = parts[0].position[i + 2] - mu, dv = parts[0].position[i + 1] - mv;
  suu += du * du;
  svv += dv * dv;
  suv += du * dv;
}
const angle = 0.5 * Math.atan2(2 * suv, suu - svv);
const [cos, sin] = [Math.cos(-angle), Math.sin(-angle)];
for (const g of parts)
  for (let i = 0; i < g.position.length; i += 3) {
    const du = g.position[i + 2] - mu, dv = g.position[i + 1] - mv;
    g.position[i + 2] = mu + du * cos - dv * sin;
    g.position[i + 1] = mv + du * sin + dv * cos;
  }

let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
for (const g of parts)
  for (let i = 0; i < g.position.length; i += 3) {
    minU = Math.min(minU, g.position[i + 2]);
    maxU = Math.max(maxU, g.position[i + 2]);
    minV = Math.min(minV, g.position[i + 1]);
    maxV = Math.max(maxV, g.position[i + 1]);
  }
const span = Math.max(maxU - minU, maxV - minV);
const pad = GRID * 0.04;
const scale = (GRID - pad * 2) / span;
const offU = pad + ((GRID - pad * 2) - (maxU - minU) * scale) / 2;
const offV = pad + ((GRID - pad * 2) - (maxV - minV) * scale) / 2;
const px = (u: number) => offU + (u - minU) * scale;
const py = (v: number) => offV + (maxV - v) * scale;

// Fill every triangle into a mask.
const mask = new Uint8Array(GRID * GRID);
for (const g of parts) {
  for (let t = 0; t < g.index.length; t += 3) {
    const p = [0, 1, 2].map((k) => {
      const i = g.index[t + k] * 3;
      return [px(g.position[i + 2]), py(g.position[i + 1])];
    });
    const x0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])));
    const x1 = Math.min(GRID - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const y0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])));
    const y1 = Math.min(GRID - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const w0 = ((p[1][0] - x - 0.5) * (p[2][1] - y - 0.5) - (p[2][0] - x - 0.5) * (p[1][1] - y - 0.5)) / area;
        const w1 = ((p[2][0] - x - 0.5) * (p[0][1] - y - 0.5) - (p[0][0] - x - 0.5) * (p[2][1] - y - 0.5)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) mask[y * GRID + x] = 1;
      }
  }
}

// Close pinholes (foramina, the gap between the teeth) so the mark reads as
// one solid shape at favicon size: dilate then erode.
function morph(src: Uint8Array, r: number, dilate: boolean) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) {
      let hit = !dilate;
      for (let dy = -r; dy <= r && hit !== dilate; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const xx = x + dx, yy = y + dy;
          const v = xx >= 0 && yy >= 0 && xx < GRID && yy < GRID ? src[yy * GRID + xx] : 0;
          if (dilate ? v : !v) {
            hit = dilate;
            break;
          }
        }
      out[y * GRID + x] = hit ? 1 : 0;
    }
  return out;
}
const solid = morph(morph(mask, 6, true), 6, false);

// Fill interior holes: anything not reachable from the border is inside.
const outside = new Uint8Array(GRID * GRID);
const stack = [0];
outside[0] = 1;
while (stack.length) {
  const k = stack.pop()!;
  const x = k % GRID, y = (k / GRID) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= GRID || yy >= GRID) continue;
    const kk = yy * GRID + xx;
    if (outside[kk] || solid[kk]) continue;
    outside[kk] = 1;
    stack.push(kk);
  }
}
const filled = Uint8Array.from(outside, (o) => (o ? 0 : 1));

// Trace the outer boundary (Moore neighbour tracing) of the largest blob.
const start = filled.findIndex((v) => v === 1);
const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < GRID && y < GRID ? filled[y * GRID + x] : 0);
const contour: [number, number][] = [];
let cx = start % GRID, cy = (start / GRID) | 0, dir = 6;
const sx = cx, sy = cy;
do {
  contour.push([cx, cy]);
  let found = false;
  for (let i = 0; i < 8; i++) {
    const d = (dir + 6 + i) % 8;
    const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
    if (at(nx, ny)) {
      cx = nx;
      cy = ny;
      dir = d;
      found = true;
      break;
    }
  }
  if (!found) break;
} while ((cx !== sx || cy !== sy) && contour.length < GRID * 16);

// Douglas-Peucker to a few dozen points, then smooth with quadratic curves.
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    const d = Math.abs((b[1] - a[1]) * x - (b[0] - a[0]) * y + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    if (d > best) [best, at] = [d, i];
  }
  if (best <= eps) return [a, b];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}
const half = contour.length >> 1;
const pts = [...simplify(contour.slice(0, half + 1), 2.2).slice(0, -1), ...simplify([...contour.slice(half), contour[0]], 2.2).slice(0, -1)];
const k = VIEW / GRID;
const f = (n: number) => +(n * k).toFixed(2);
const mid = (p: [number, number], q: [number, number]): [number, number] => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
let d = `M${f(mid(pts[pts.length - 1], pts[0])[0])} ${f(mid(pts[pts.length - 1], pts[0])[1])}`;
for (let i = 0; i < pts.length; i++) {
  const m = mid(pts[i], pts[(i + 1) % pts.length]);
  d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`;
}
d += "Z";

fs.writeFileSync(
  path.join(process.cwd(), "components", "atlas", "mark-path.ts"),
  `// Generated by scripts/build-brand.ts from the scanned dog skull. Do not edit.\nexport const MARK_PATH = "${d}";\n`,
);

// App icon: ink plate with the bone-coloured skull.
const INK = "#332217";
const BONE = "#E9DFCB";
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="${INK}"/><g transform="translate(9 9) scale(0.82)"><path d="${d}" fill="${BONE}"/></g></svg>\n`;
fs.writeFileSync(path.join(process.cwd(), "app", "icon.svg"), icon);

// apple-icon.png (180px): rasterize the same composition.
const S = 180;
const img = new Uint8Array(S * S * 3);
const ink = [0x33, 0x22, 0x17];
const bone = [0xe9, 0xdf, 0xcb];
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    // Sample the mask at the icon's inner transform (supersampled 3x3).
    let cover = 0;
    for (let sy = 0; sy < 3; sy++)
      for (let sx = 0; sx < 3; sx++) {
        const u = ((x + (sx + 0.5) / 3) / S) * 100;
        const v = ((y + (sy + 0.5) / 3) / S) * 100;
        const gx = Math.floor((((u - 9) / 0.82) / VIEW) * GRID);
        const gy = Math.floor((((v - 9) / 0.82) / VIEW) * GRID);
        if (at(gx, gy)) cover++;
      }
    const a = cover / 9;
    for (let c = 0; c < 3; c++) img[(y * S + x) * 3 + c] = Math.round(ink[c] * (1 - a) + bone[c] * a);
  }
const raw = Buffer.alloc((S * 3 + 1) * S);
for (let y = 0; y < S; y++) Buffer.from(img.buffer, y * S * 3, S * 3).copy(raw, y * (S * 3 + 1) + 1);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
fs.writeFileSync(
  path.join(process.cwd(), "app", "apple-icon.png"),
  Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
);
console.log(`mark: ${pts.length} points; wrote components/atlas/mark-path.ts, app/icon.svg, app/apple-icon.png`);
