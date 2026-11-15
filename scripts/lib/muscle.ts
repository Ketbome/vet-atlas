/**
 * Shared building blocks of the procedural muscle builds
 * (scripts/build-<species>-muscular.ts): anatomical directions, profiles and
 * splines, slab and tube meshes with fibre direction and tendon weight per
 * vertex, and the collision passes (Obstacles: nearest-vertex push out of
 * bones and skin; Volume: voxel signed-distance push between muscles),
 * volume calibration, and fibres() for scanned or sculpted muscles.
 *
 * Frame as in scripts/lib/glb.ts: metres, Y up, animal faces -Z, left -X.
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { smoothNormals, type Geometry } from "./glb";

export type V = Vector3;
export type Profile = [number, number][];

export const vec = (x: number, y: number, z: number) => new Vector3(x, y, z);
export const AXES = {
  lat: vec(-1, 0, 0),
  med: vec(1, 0, 0),
  cra: vec(0, 0, -1),
  cau: vec(0, 0, 1),
  dor: vec(0, 1, 0),
  ven: vec(0, -1, 0),
};
export type Dir = Partial<Record<keyof typeof AXES, number>>;
// Anatomical direction on the left side, e.g. dir({ cau: 1, lat: 0.5 }).
export function dir(d: Dir) {
  const out = new Vector3();
  for (const [k, w] of Object.entries(d)) out.addScaledVector(AXES[k as keyof typeof AXES], w);
  return out.normalize();
}
export const lerp = (a: V, b: V, t: number) => a.clone().lerp(b, t);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Smooth 1D interpolation through knots [x, y] (cubic Hermite, Catmull-Rom tangents).
export function prof(p: Profile, x: number) {
  if (x <= p[0][0]) return p[0][1];
  const n = p.length - 1;
  if (x >= p[n][0]) return p[n][1];
  let k = 0;
  while (p[k + 1][0] < x) k++;
  const [x0, y0] = p[k];
  const [x1, y1] = p[k + 1];
  const h = x1 - x0;
  const m0 = k > 0 ? ((y1 - p[k - 1][1]) / (x1 - p[k - 1][0])) * h : y1 - y0;
  const m1 = k + 2 <= n ? ((p[k + 2][1] - y0) / (p[k + 2][0] - x0)) * h : y1 - y0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
}

// Catmull-Rom curve through `pts`, resampled to n points evenly spaced by arc length.
export function spline(pts: V[], n: number): V[] {
  if (pts.length === 2) return Array.from({ length: n }, (_, i) => lerp(pts[0], pts[1], i / (n - 1)));
  const ext = [
    pts[0].clone().multiplyScalar(2).sub(pts[1]),
    ...pts,
    pts[pts.length - 1]
      .clone()
      .multiplyScalar(2)
      .sub(pts[pts.length - 2]),
  ];
  const dense: V[] = [];
  for (let s = 1; s < ext.length - 2; s++) {
    const [p0, p1, p2, p3] = [ext[s - 1], ext[s], ext[s + 1], ext[s + 2]];
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push(
        new Vector3()
          .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
          .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
          .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
          .addScaledVector(p3, 0.5 * t3 - 0.5 * t2),
      );
    }
  }
  dense.push(pts[pts.length - 1].clone());
  const acc = [0];
  for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + dense[i].distanceTo(dense[i - 1]));
  const total = acc[acc.length - 1];
  const out: V[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (j < acc.length - 2 && acc[j + 1] < target) j++;
    const f = (target - acc[j]) / (acc[j + 1] - acc[j] || 1);
    out.push(lerp(dense[j], dense[j + 1], Math.min(1, Math.max(0, f))));
  }
  return out;
}


export const boxOf = (pts: V[]) => {
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  for (const p of pts) {
    min.min(p);
    max.max(p);
  }
  return { min, max, center: lerp(min, max, 0.5) };
};

// ---------------------------------------------------------------- geometry

// `fibre`: per vertex, direction of the muscle fibres; `tendon`: 0 in the
// fleshy belly, 1 where it thins into tendon or aponeurosis. `section`: vertices
// with the same id (a slab's two faces at one grid point) are pushed out
// together, so a thin sheet slides off instead of folding; tubes flatten.
// `base`: a slab's deep face, which lies on what is beneath it.
export type Mesh = { pos: V[]; tri: number[]; fibre?: V[]; tendon?: number[]; section?: number[]; base?: boolean[] };

// Closed slab over a grid of base points grid[u][v]; the outer face is pushed
// along the surface normal (oriented by `out`) by the thickness at (u, v).
export function slab(grid: V[][], thick: (u: number, v: number) => number, out: (p: V) => V): Mesh {
  const nu = grid.length;
  const nv = grid[0].length;
  const pos: V[] = [];
  const normal = (u: number, v: number) => {
    const du = grid[Math.min(u + 1, nu - 1)][v].clone().sub(grid[Math.max(u - 1, 0)][v]);
    const dv = grid[u][Math.min(v + 1, nv - 1)].clone().sub(grid[u][Math.max(v - 1, 0)]);
    const n = new Vector3().crossVectors(du, dv);
    if (n.lengthSq() < 1e-14) n.copy(out(grid[u][v]));
    n.normalize();
    if (n.dot(out(grid[u][v])) < 0) n.negate();
    return n;
  };
  let sign = 0;
  const fibre: V[] = [];
  const tendon: number[] = [];
  const section: number[] = [];
  // Tendinous where the slab thins along its length (its middle line).
  const mid = Array.from({ length: nu }, (_, u) => thick(u / (nu - 1), 0.5));
  const peak = Math.max(...mid);
  const along = (u: number, v: number) =>
    grid[Math.min(u + 1, nu - 1)][v]
      .clone()
      .sub(grid[Math.max(u - 1, 0)][v])
      .normalize();
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      const n = normal(u, v);
      const t = Math.max(thick(u / (nu - 1), v / (nv - 1)), 0.0006);
      pos.push(grid[u][v].clone().addScaledVector(n, t));
      fibre.push(along(u, v));
      tendon.push(1 - smoothstep(0.15, 0.35, mid[u] / peak));
      section.push(u * nv + v);
      if (u < nu - 1 && v < nv - 1) {
        const du = grid[u + 1][v].clone().sub(grid[u][v]);
        const dv = grid[u][v + 1].clone().sub(grid[u][v]);
        sign += new Vector3().crossVectors(du, dv).dot(n);
      }
    }
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      pos.push(grid[u][v].clone());
      fibre.push(along(u, v));
      tendon.push(1 - smoothstep(0.15, 0.35, mid[u] / peak));
      section.push(u * nv + v);
    }
  const O = (u: number, v: number) => u * nv + v;
  const I = (u: number, v: number) => nu * nv + u * nv + v;
  const tri: number[] = [];
  for (let u = 0; u < nu - 1; u++)
    for (let v = 0; v < nv - 1; v++) {
      tri.push(O(u, v), O(u + 1, v), O(u + 1, v + 1), O(u, v), O(u + 1, v + 1), O(u, v + 1));
      tri.push(I(u, v), I(u + 1, v + 1), I(u + 1, v), I(u, v), I(u, v + 1), I(u + 1, v + 1));
    }
  const loop: [number, number][] = [];
  for (let u = 0; u < nu - 1; u++) loop.push([u, 0]);
  for (let v = 0; v < nv - 1; v++) loop.push([nu - 1, v]);
  for (let u = nu - 1; u > 0; u--) loop.push([u, nv - 1]);
  for (let v = nv - 1; v > 0; v--) loop.push([0, v]);
  for (let k = 0; k < loop.length; k++) {
    const [a, b] = [loop[k], loop[(k + 1) % loop.length]];
    tri.push(O(...a), I(...a), O(...b), O(...b), I(...a), I(...b));
  }
  if (sign < 0) for (let k = 0; k < tri.length; k += 3) [tri[k + 1], tri[k + 2]] = [tri[k + 2], tri[k + 1]];
  return { pos, tri, fibre, tendon, section, base: pos.map((_, i) => i >= nu * nv) };
}

// Grid from fibres: every fibre is a list of control points (same count); each
// is splined along u, then the fibres are splined across v.
export function fibreGrid(fibres: V[][], nu: number, nv: number): V[][] {
  const along = fibres.map((f) => spline(f, nu));
  return Array.from({ length: nu }, (_, u) =>
    spline(
      along.map((f) => f[u]),
      nv,
    ),
  );
}

export type Edge = { u?: number; v?: number };
// Thickness taper toward the borders of a slab: t * (floor + (1 - floor) * ramp).
export function taper(t: (u: number, v: number) => number, edge: Edge = {}, floor = 0.3) {
  const eu = edge.u ?? 0.12;
  const ev = edge.v ?? 0.12;
  return (u: number, v: number) => {
    const r = Math.min(eu ? smoothstep(0, eu, Math.min(u, 1 - u)) : 1, ev ? smoothstep(0, ev, Math.min(v, 1 - v)) : 1);
    return t(u, v) * (floor + (1 - floor) * Math.sqrt(r));
  };
}

export type Tube = {
  pts: V[];
  w: Profile; // width (across the flat face) along s in [0, 1], metres
  t: Profile; // thickness (along `face`)
  face?: V | ((s: number) => V);
  n?: number;
  ring?: number;
  square?: number; // superellipse exponent factor, < 1 squarer
};

export function tube({ pts, w, t, face = AXES.lat, n = 40, ring = 18, square = 1 }: Tube): Mesh {
  const c = spline(pts, n);
  const pos: V[] = [];
  const tri: number[] = [];
  const fibre: V[] = [];
  const tendon: number[] = [];
  // Tendinous where the cross-section shrinks to under ~half the belly's.
  const size = (s: number) => Math.sqrt(Math.max(prof(w, s), 0.0015) * Math.max(prof(t, s), 0.0015));
  const peak = Math.max(...Array.from({ length: n }, (_, j) => size(j / (n - 1))));
  const tend = (s: number) => 1 - smoothstep(0.3, 0.6, size(s) / peak);
  let lastN: V | undefined;
  for (let j = 0; j < n; j++) {
    const s = j / (n - 1);
    const tan = c[Math.min(j + 1, n - 1)]
      .clone()
      .sub(c[Math.max(j - 1, 0)])
      .normalize();
    const f = (typeof face === "function" ? face(s) : face).clone();
    let nn = f.addScaledVector(tan, -f.dot(tan));
    if (nn.lengthSq() < 1e-8) nn = lastN!.clone();
    nn.normalize();
    lastN = nn;
    const b = new Vector3().crossVectors(tan, nn);
    const hw = Math.max(prof(w, s), 0.0015) / 2;
    const ht = Math.max(prof(t, s), 0.0015) / 2;
    for (let k = 0; k < ring; k++) {
      const phi = (2 * Math.PI * k) / ring;
      const cs = Math.cos(phi);
      const sn = Math.sin(phi);
      const e = 2 / (2 + (1 - square) * 2);
      pos.push(
        c[j]
          .clone()
          .addScaledVector(b, hw * Math.sign(cs) * Math.pow(Math.abs(cs), e))
          .addScaledVector(nn, ht * Math.sign(sn) * Math.pow(Math.abs(sn), e)),
      );
      fibre.push(tan.clone());
      tendon.push(tend(s));
    }
  }
  for (let j = 0; j < n - 1; j++)
    for (let k = 0; k < ring; k++) {
      const a = j * ring + k;
      const b = j * ring + ((k + 1) % ring);
      tri.push(a, a + ring, b, b, a + ring, b + ring);
    }
  const s0 = pos.length;
  pos.push(c[0].clone(), c[n - 1].clone());
  fibre.push(fibre[0].clone(), fibre[fibre.length - 1].clone());
  tendon.push(tend(0), tend(1));
  for (let k = 0; k < ring; k++) {
    tri.push(s0, k, (k + 1) % ring);
    tri.push(s0 + 1, (n - 1) * ring + ((k + 1) % ring), (n - 1) * ring + k);
  }
  // Orient outward.
  const mid = Math.floor(n / 2) * ring;
  const [a, b, d] = [pos[tri[mid * 6]], pos[tri[mid * 6 + 1]], pos[tri[mid * 6 + 2]]];
  const fn = new Vector3().crossVectors(b.clone().sub(a), d.clone().sub(a));
  if (fn.dot(a.clone().sub(c[Math.floor(n / 2)])) < 0) for (let k = 0; k < tri.length; k += 3) [tri[k + 1], tri[k + 2]] = [tri[k + 2], tri[k + 1]];
  return { pos, tri, fibre, tendon };
}

// ---------------------------------------------------------------- collisions

// Vertices with normals in a spatial hash, to push muscle vertices out of them.
export class Obstacles {
  constructor(public cell = 0.008) {}
  map = new Map<string, number[]>();
  p: V[] = [];
  n: V[] = [];
  owner: string[] = [];
  reach: number[] = [];
  key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(name: string, pos: ArrayLike<number>, index: ArrayLike<number>, reach?: number[]) {
    const nrm = smoothNormals(pos, index);
    for (let i = 0; i < pos.length; i += 3) {
      if (reach && reach[i / 3] < 0) continue;
      const id = this.p.length;
      this.reach.push(reach ? reach[i / 3] : Infinity);
      this.p.push(vec(pos[i], pos[i + 1], pos[i + 2]));
      this.n.push(vec(nrm[i], nrm[i + 1], nrm[i + 2]));
      this.owner.push(name);
      const k = this.key(pos[i], pos[i + 1], pos[i + 2]);
      const list = this.map.get(k);
      if (list) list.push(id);
      else this.map.set(k, [id]);
    }
  }
  nearest(p: V, skip: (owner: string) => boolean) {
    let best = -1;
    let bestD = Infinity;
    const cx = Math.floor(p.x / this.cell);
    const cy = Math.floor(p.y / this.cell);
    const cz = Math.floor(p.z / this.cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const id of list) {
            const d = this.p[id].distanceToSquared(p);
            if (d < bestD && !skip(this.owner[id])) {
              bestD = d;
              best = id;
            }
          }
        }
    return best;
  }
  // Moves points that are inside (or closer than `clear` to) the obstacle surface.
  push(pts: V[], clear: number, skip: (owner: string) => boolean = () => false) {
    let moved = 0;
    for (const p of pts) {
      const id = this.nearest(p, skip);
      if (id < 0) continue;
      const d = p.clone().sub(this.p[id]).dot(this.n[id]);
      if (d < clear && d > -this.reach[id]) {
        p.addScaledVector(this.n[id], clear - d);
        moved++;
      }
    }
    return moved;
  }
}

export function neighbours(m: Mesh) {
  const nb = m.pos.map(() => new Set<number>());
  for (let k = 0; k < m.tri.length; k += 3) {
    const [a, b, c] = [m.tri[k], m.tri[k + 1], m.tri[k + 2]];
    nb[a].add(b).add(c);
    nb[b].add(a).add(c);
    nb[c].add(a).add(b);
  }
  return nb.map((s) => [...s]);
}

// Taubin smoothing (no shrinkage).
export function relax(m: Mesh, iterations: number) {
  const nb = neighbours(m);
  for (let it = 0; it < iterations; it++)
    for (const f of [0.5, -0.53]) {
      const next = m.pos.map((p, i) => {
        const avg = new Vector3();
        for (const j of nb[i]) avg.add(m.pos[j]);
        avg.divideScalar(nb[i].length || 1);
        return p.clone().lerp(avg, f);
      });
      m.pos.forEach((p, i) => p.copy(next[i]));
    }
}

export const join = (...parts: Mesh[]): Mesh => {
  const out: Mesh = { pos: [], tri: [], fibre: [], tendon: [], section: [], base: [] };
  for (const m of parts) {
    const off = out.pos.length;
    const next = out.section!.length ? Math.max(...out.section!) + 1 : 0;
    out.section!.push(...(m.section ?? m.pos.map((_, i) => i)).map((id) => id + next));
    out.pos.push(...m.pos);
    out.tri.push(...m.tri.map((t) => t + off));
    out.fibre!.push(...(m.fibre ?? m.pos.map(() => new Vector3())));
    out.tendon!.push(...(m.tendon ?? m.pos.map(() => 0)));
    out.base!.push(...(m.base ?? m.pos.map(() => false)));
  }
  return out;
};

// Grows or shrinks a muscle along its normals until its volume is `cm3`:
// only the fleshy belly moves (tendon and aponeurosis keep their thickness),
// and a slab only on its outer face.
export function calibrate(m: Mesh, cm3: number, grow?: V) {
  const w0 = m.pos.map((_, i) => (m.base?.[i] ? 0 : 1 - (m.tendon?.[i] ?? 0)));
  for (let it = 0; it < 5; it++) {
    const vol = voxels(m).length * VOX ** 3 * 1e6;
    if (Math.abs(vol / cm3 - 1) < 0.04) break;
    const nrm = smoothNormals(toGeometry(m).position, m.tri);
    const w = w0.map((x, i) => (grow ? x * Math.max(0, grow.x * nrm[i * 3] + grow.y * nrm[i * 3 + 1] + grow.z * nrm[i * 3 + 2]) : x));
    let area = 0;
    for (let k = 0; k < m.tri.length; k += 3) {
      const [a, b, c] = [m.pos[m.tri[k]], m.pos[m.tri[k + 1]], m.pos[m.tri[k + 2]]];
      area += (new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() / 2) * ((w[m.tri[k]] + w[m.tri[k + 1]] + w[m.tri[k + 2]]) / 3);
    }
    if (area < 1e-6) break;
    const d = Math.min(0.008, Math.max(-0.002, ((cm3 - vol) * 1e-6) / area));
    m.pos.forEach((p, i) => p.add(vec(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).multiplyScalar(d * w[i])));
    relax(m, 1);
  }
}

export const toGeometry = (m: Mesh): Geometry => {
  const position = new Float32Array(m.pos.length * 3);
  m.pos.forEach((p, i) => p.toArray(position, i * 3));
  const fibre = new Float32Array(m.pos.length * 4);
  m.pos.forEach((_, i) => {
    m.fibre?.[i].toArray(fibre, i * 4);
    fibre[i * 4 + 3] = m.tendon?.[i] ?? 0;
  });
  return { position, index: new Uint32Array(m.tri), fibre };
};

// Built muscles as 1.5 mm voxels labelled by owner. A new muscle is pushed out
// along the signed distance to them, however deep it went in (a nearest-vertex
// test only sees surfaces within a cell or two).
export const VOX = 0.0015;

// Voxel keys inside a closed mesh, by ray parity along x.
export function voxels(m: Mesh) {
  const rows = new Map<number, number[]>();
  for (let k = 0; k < m.tri.length; k += 3) {
    const [a, b, c] = [m.pos[m.tri[k]], m.pos[m.tri[k + 1]], m.pos[m.tri[k + 2]]];
    const d = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
    if (Math.abs(d) < 1e-14) continue;
    const y0 = Math.ceil(Math.min(a.y, b.y, c.y) / VOX - 0.5);
    const y1 = Math.floor(Math.max(a.y, b.y, c.y) / VOX - 0.5);
    const z0 = Math.ceil(Math.min(a.z, b.z, c.z) / VOX - 0.5);
    const z1 = Math.floor(Math.max(a.z, b.z, c.z) / VOX - 0.5);
    for (let yi = y0; yi <= y1; yi++)
      for (let zi = z0; zi <= z1; zi++) {
        const [py, pz] = [(yi + 0.5) * VOX, (zi + 0.5) * VOX];
        const u = ((py - a.y) * (c.z - a.z) - (pz - a.z) * (c.y - a.y)) / d;
        const v = ((b.y - a.y) * (pz - a.z) - (b.z - a.z) * (py - a.y)) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const row = (yi + 1024) * 2048 + zi + 1024;
        const xs = rows.get(row) ?? rows.set(row, []).get(row)!;
        xs.push(a.x + u * (b.x - a.x) + v * (c.x - a.x));
      }
  }
  const out: number[] = [];
  for (const [row, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let xi = Math.ceil(xs[i] / VOX - 0.5); xi <= Math.floor(xs[i + 1] / VOX - 0.5); xi++) out.push((xi + 1024) * 2048 * 2048 + row);
  }
  return out;
}

// Squared Euclidean distance transform in voxel units (Felzenszwalb &
// Huttenlocher), in place: f is 0 at the sources and huge elsewhere.
export function edt(f: Float64Array, dims: [number, number, number]) {
  const strides = [1, dims[0], dims[0] * dims[1]];
  const n = Math.max(...dims);
  const [g, d, z] = [new Float64Array(n), new Float64Array(n), new Float64Array(n + 1)];
  const v = new Int32Array(n);
  for (let axis = 0; axis < 3; axis++) {
    const [len, s] = [dims[axis], strides[axis]];
    const [a1, a2] = [0, 1, 2].filter((a) => a !== axis);
    for (let i = 0; i < dims[a1]; i++)
      for (let j = 0; j < dims[a2]; j++) {
        const base = i * strides[a1] + j * strides[a2];
        for (let q = 0; q < len; q++) g[q] = f[base + q * s];
        let k = 0;
        v[0] = 0;
        z[0] = -Infinity;
        z[1] = Infinity;
        const cross = (q: number, r: number) => (g[q] + q * q - (g[r] + r * r)) / (2 * q - 2 * r);
        for (let q = 1; q < len; q++) {
          let sx = cross(q, v[k]);
          while (sx <= z[k]) sx = cross(q, v[--k]);
          v[++k] = q;
          z[k] = sx;
          z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < len; q++) {
          while (z[k + 1] < q) k++;
          d[q] = (q - v[k]) ** 2 + g[v[k]];
        }
        for (let q = 0; q < len; q++) f[base + q * s] = d[q];
      }
  }
}

export class Volume {
  owner = new Map<number, number>();
  names: string[] = [];
  size: number[] = [];
  shared = new Map<string, number>();
  add(name: string, m: Mesh, skip: (owner: string) => boolean) {
    const id = this.names.push(name) - 1;
    const keys = voxels(m);
    this.size.push(keys.length);
    for (const k of keys) {
      const o = this.owner.get(k);
      if (o === undefined) this.owner.set(k, id);
      else if (!skip(this.names[o])) this.shared.set(`${o} ${id}`, (this.shared.get(`${o} ${id}`) ?? 0) + 1);
    }
  }
  // Signed distance to the muscles not skipped, around the points `pts`
  // (undefined when none is near).
  private field(pts: V[], skip: (owner: string) => boolean) {
    const box = boxOf(pts);
    const pad = 16;
    const lo = [box.min.x, box.min.y, box.min.z].map((x) => Math.floor(x / VOX - 0.5) - pad);
    const hi = [box.max.x, box.max.y, box.max.z].map((x) => Math.ceil(x / VOX - 0.5) + pad);
    const dims = [0, 1, 2].map((a) => hi[a] - lo[a] + 1) as [number, number, number];
    const total = dims[0] * dims[1] * dims[2];
    const inside = new Uint8Array(total);
    const keep = this.names.map((n) => !skip(n));
    for (const [k, o] of this.owner) {
      if (!keep[o]) continue;
      const x = Math.floor(k / 2048 / 2048) - 1024 - lo[0];
      const y = (Math.floor(k / 2048) % 2048) - 1024 - lo[1];
      const z = (k % 2048) - 1024 - lo[2];
      if (x >= 0 && y >= 0 && z >= 0 && x < dims[0] && y < dims[1] && z < dims[2]) inside[x + dims[0] * (y + dims[1] * z)] = 1;
    }
    if (!inside.includes(1)) return undefined;
    const din = new Float64Array(total);
    const dout = new Float64Array(total);
    for (let i = 0; i < total; i++) [din[i], dout[i]] = inside[i] ? [1e12, 0] : [0, 1e12];
    edt(din, dims);
    edt(dout, dims);
    const sd = new Float32Array(total);
    for (let i = 0; i < total; i++) sd[i] = (inside[i] ? 0.5 - Math.sqrt(din[i]) : Math.sqrt(dout[i]) - 0.5) * VOX;
    const at = (x: number, y: number, z: number) => {
      const g = [x, y, z].map((c, a) => Math.min(dims[a] - 1.001, Math.max(0, c / VOX - 0.5 - lo[a])));
      const i = g.map(Math.floor);
      const f = g.map((c, a) => c - i[a]);
      let out = 0;
      for (let c = 0; c < 8; c++) {
        const [dx, dy, dz] = [c & 1, (c >> 1) & 1, (c >> 2) & 1];
        const w = (dx ? f[0] : 1 - f[0]) * (dy ? f[1] : 1 - f[1]) * (dz ? f[2] : 1 - f[2]);
        out += w * sd[i[0] + dx + dims[0] * (i[1] + dy + dims[1] * (i[2] + dz))];
      }
      return out;
    };
    return at;
  }
  // For scanned or sculpted muscles, whose hidden sides may run deep into
  // the muscles built before: points more than a voxel inside the muscles not
  // skipped move back along the mesh's own inner normal to where they leave
  // them, by at most `reach` and never through the muscle's own far side. The
  // muscle is thinned to lie on the deeper ones instead of being pushed
  // through or round them; shallower contacts are left as they are (thin
  // sheets would crumple on the voxel steps).
  peel(m: Mesh, skip: (owner: string) => boolean, reach = 0.02) {
    const at = this.field(m.pos, skip);
    if (!at) return;
    const g = toGeometry(m);
    const nrm = smoothNormals(g.position, m.tri);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(g.position, 3));
    geometry.setIndex(new BufferAttribute(g.index, 1));
    const self = new MeshBVH(geometry);
    const ray = new Ray();
    m.pos.forEach((p, i) => {
      if (at(p.x, p.y, p.z) >= -VOX) return;
      ray.direction.set(-nrm[i * 3], -nrm[i * 3 + 1], -nrm[i * 3 + 2]);
      ray.origin.copy(p).addScaledVector(ray.direction, 1e-4);
      const limit = Math.min(reach, (self.raycastFirst(ray, DoubleSide)?.distance ?? reach) - 0.0005);
      for (let s = VOX / 2; s <= limit; s += VOX / 2) {
        const q = p.clone().addScaledVector(ray.direction, s);
        if (at(q.x, q.y, q.z) >= 0) {
          p.copy(q);
          return;
        }
      }
    });
  }
  // Pushes points closer than `clear` to (or inside) the muscles not skipped
  // out along the gradient of the signed distance to them.
  push(m: Mesh, clear: number, skip: (owner: string) => boolean, rounds = 1) {
    const pts = m.pos;
    const at = this.field(pts, skip);
    if (!at) return;
    const section = m.section ?? pts.map((_, i) => i);
    for (let r = 0; r < rounds; r++) {
      const move = new Map<number, V>();
      const nrm = smoothNormals(toGeometry(m).position, m.tri);
      pts.forEach((p, i) => {
        const d = at(p.x, p.y, p.z);
        if (d >= clear) return;
        const grad = vec(at(p.x + VOX, p.y, p.z) - at(p.x - VOX, p.y, p.z), at(p.x, p.y + VOX, p.z) - at(p.x, p.y - VOX, p.z), at(p.x, p.y, p.z + VOX) - at(p.x, p.y, p.z - VOX));
        if (grad.lengthSq() < 1e-14) return;
        grad.normalize();
        // Dent inward (along the muscle's own inner normal) rather than slip
        // round the obstacle, which would wrap the muscle about it.
        const inward = vec(-nrm[i * 3], -nrm[i * 3 + 1], -nrm[i * 3 + 2]);
        const cos = inward.dot(grad);
        const step = cos > 0.3 ? inward.multiplyScalar((clear - d) / cos) : grad.multiplyScalar(clear - d);
        const best = move.get(section[i]);
        if (!best || step.lengthSq() > best.lengthSq()) move.set(section[i], step);
      });
      pts.forEach((p, i) => {
        const step = move.get(section[i]);
        if (step) p.add(step);
      });
    }
  }
  // Pairs still sharing more than `frac` of the smaller one's volume.
  report(frac: number) {
    const cc = VOX ** 3 * 1e6;
    return [...this.shared]
      .map(([pair, n]) => {
        const [a, b] = pair.split(" ").map(Number);
        return { a: this.names[a], b: this.names[b], cm3: n * cc, frac: n / Math.min(this.size[a], this.size[b]) };
      })
      .filter((r) => r.frac > frac)
      .sort((p, q) => q.cm3 - p.cm3);
  }
}

// ---------------------------------------------------------------- scans

// Fibres of a scanned or sculpted muscle, per vertex: direction (`dirs`, e.g.
// the muscle's long axis, laid on the surface) and a tendon weight from local
// thickness (1 where the muscle is under 15 % of its median thickness, 0 above
// 40 %).
export function fibres(position: Float32Array<ArrayBuffer>, index: Uint32Array<ArrayBuffer>, dirs: Float32Array) {
  const count = position.length / 3;
  const normal = smoothNormals(position, index);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const tree = new MeshBVH(geometry);
  const ray = new Ray();
  const thick = new Float32Array(count);
  const [p, n, d] = [new Vector3(), new Vector3(), new Vector3()];
  for (let v = 0; v < count; v++) {
    n.fromArray(normal, v * 3);
    ray.origin.fromArray(position, v * 3).addScaledVector(n, -1e-4);
    ray.direction.copy(n).negate();
    thick[v] = tree.raycastFirst(ray, DoubleSide)?.distance ?? 0;
  }
  const median = Float32Array.from(thick).sort()[Math.floor(count / 2)];
  const fibre = new Float32Array(count * 4);
  for (let v = 0; v < count; v++) {
    n.fromArray(normal, v * 3);
    d.fromArray(dirs, v * 3);
    p.copy(d).addScaledVector(n, -d.dot(n));
    (p.lengthSq() > 1e-12 ? p.normalize() : p.copy(d)).toArray(fibre, v * 4);
    fibre[v * 4 + 3] = Math.min(1, Math.max(0, (0.4 * median - thick[v]) / (0.25 * median)));
  }
  return fibre;
}
