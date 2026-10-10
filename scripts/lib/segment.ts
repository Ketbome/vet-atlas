/**
 * Cutting a fused scan into parts (used by scripts/build-cow-*.ts): a seeded
 * geodesic watershed over the surface. Every part gets a few seeds and grows
 * along the surface; an edge across a concave crease costs `crease` times its
 * length, so neighbouring parts meet in the grooves between them (the joints
 * of a mounted skeleton, the folds between the compartments of a stomach).
 */
import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { MeshoptSimplifier } from "meshoptimizer";
import { bounds, components, merge, smoothNormals, type Geometry } from "./glb";

type V = Vector3;

// A pick on a render of the surface: L/R lateral views (u = z for L and -z for
// R, v = y), D dorsal (u = x, v = -z), V ventral (u = -x, v = -z), C from -z
// (u = x, v = y), K from +z (u = -x, v = y); or a point.
// `only` keeps candidates passing a coordinate test such as "x<0".
export type Pick = [view: "L" | "R" | "D" | "V" | "C" | "K", u: number, v: number, only?: string] | [x: number, y: number, z: number];

const views = {
  L: { dir: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  R: { dir: [-1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  D: { dir: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  V: { dir: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, -1] },
  C: { dir: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  K: { dir: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
} as const;

// Welds vertices at the same position and simplifies to about `tris`
// triangles with meshopt (relative error `error`).
export function weldSimplify(g: Geometry, tris: number, error = 0.0005): Geometry {
  const ids = new Map<string, number>();
  const weld = new Uint32Array(g.position.length / 3);
  const pos: number[] = [];
  for (let i = 0; i < weld.length; i++) {
    const p = [g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]];
    const key = p.map((x) => x.toFixed(6)).join();
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      pos.push(...p);
    }
    weld[i] = id;
  }
  const index = Uint32Array.from(g.index, (v) => weld[v]);
  const position = new Float32Array(pos);
  const [simple] = MeshoptSimplifier.simplify(index, position, 3, Math.min(index.length, tris * 3), error, ["LockBorder"]);
  const remap = new Map<number, number>();
  const out = Uint32Array.from(simple, (v) => {
    if (!remap.has(v)) remap.set(v, remap.size);
    return remap.get(v)!;
  });
  const compact = new Float32Array(remap.size * 3);
  for (const [v, j] of remap) compact.set(position.subarray(v * 3, v * 3 + 3), j * 3);
  return { position: compact, index: out };
}

// Variance of a point set off its main axis: as a fraction of the total, or
// in m² (the squared radius of a tube along that axis).
export function offAxis(ps: V[], absolute = false) {
  const m = ps.reduce((a, p) => a.add(p), new Vector3()).divideScalar(ps.length);
  const c = [0, 1, 2].map((i) => [0, 1, 2].map((j) => ps.reduce((s, p) => s + (p.getComponent(i) - m.getComponent(i)) * (p.getComponent(j) - m.getComponent(j)), 0) / ps.length));
  let e = [1, 1, 1];
  for (let it = 0; it < 30; it++) {
    const ne = [0, 1, 2].map((i) => c[i][0] * e[0] + c[i][1] * e[1] + c[i][2] * e[2]);
    const l = Math.hypot(...ne) || 1;
    e = ne.map((x) => x / l);
  }
  const main = [0, 1, 2].reduce((s, i) => s + e[i] * (c[i][0] * e[0] + c[i][1] * e[1] + c[i][2] * e[2]), 0);
  const total = c[0][0] + c[1][1] + c[2][2];
  if (absolute) return total - main;
  return total > 0 ? (total - main) / total : 0;
}

export class Surface {
  readonly P: Float32Array;
  readonly I: Uint32Array;
  readonly N: Float32Array;
  readonly nv: number;
  readonly bvh: MeshBVH;
  private readonly start: Uint32Array;
  private readonly adj: Uint32Array;
  private _thickness?: Float32Array;

  constructor(g: Geometry) {
    this.P = g.position;
    this.I = g.index;
    this.nv = g.position.length / 3;
    this.N = smoothNormals(this.P, this.I);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.P, 3));
    geometry.setIndex(new BufferAttribute(this.I, 1));
    this.bvh = new MeshBVH(geometry);
    // Vertex adjacency (CSR).
    this.start = new Uint32Array(this.nv + 1);
    for (const v of this.I) this.start[v + 1] += 2;
    for (let i = 0; i < this.nv; i++) this.start[i + 1] += this.start[i];
    this.adj = new Uint32Array(this.start[this.nv]);
    const fill = this.start.slice(0, this.nv);
    for (let t = 0; t < this.I.length; t += 3)
      for (let k = 0; k < 3; k++) {
        const a = this.I[t + k];
        this.adj[fill[a]++] = this.I[t + ((k + 1) % 3)];
        this.adj[fill[a]++] = this.I[t + ((k + 2) % 3)];
      }
  }

  at(v: number) {
    return new Vector3(this.P[v * 3], this.P[v * 3 + 1], this.P[v * 3 + 2]);
  }

  neighbours(v: number) {
    return this.adj.subarray(this.start[v], this.start[v + 1]);
  }

  // Wall thickness at each vertex: distance to the opposite surface inwards.
  get thickness() {
    if (!this._thickness) {
      const { P, N } = this;
      const t = new Float32Array(this.nv);
      const ray = new Ray();
      for (let v = 0; v < this.nv; v++) {
        ray.origin.set(P[v * 3] - N[v * 3] * 1e-4, P[v * 3 + 1] - N[v * 3 + 1] * 1e-4, P[v * 3 + 2] - N[v * 3 + 2] * 1e-4);
        ray.direction.set(-N[v * 3], -N[v * 3 + 1], -N[v * 3 + 2]);
        t[v] = this.bvh.raycastFirst(ray, DoubleSide, 0, 0.05)?.distance ?? 0.05;
      }
      this._thickness = t;
    }
    return this._thickness;
  }

  // Connected runs of the vertices passing `test`, as vertex lists.
  runs(test: (v: number) => boolean) {
    const seen = new Uint8Array(this.nv);
    const out: number[][] = [];
    for (let v = 0; v < this.nv; v++) {
      if (seen[v] || !test(v)) continue;
      const run = [v];
      seen[v] = 1;
      for (let q = 0; q < run.length; q++)
        for (const w of this.neighbours(run[q]))
          if (!seen[w] && test(w)) {
            seen[w] = 1;
            run.push(w);
          }
      out.push(run);
    }
    return out;
  }

  extent(vs: number[]) {
    return bounds({ position: Float32Array.from(vs.flatMap((v) => [this.P[v * 3], this.P[v * 3 + 1], this.P[v * 3 + 2]])), index: new Uint32Array() });
  }

  // The vertex nearest the camera within 12 mm of the pick ray (picks are
  // read off renders), or the vertex nearest a point.
  pick(s: Pick): number {
    let best = -1;
    if (typeof s[0] === "number") {
      const q = new Vector3(s[0], s[1] as number, s[2] as number);
      for (let v = 0, d = Infinity; v < this.nv; v++) if (this.at(v).distanceToSquared(q) < d) [best, d] = [v, this.at(v).distanceToSquared(q)];
      return best;
    }
    const [view, u, w, only] = s;
    const { dir, u: du, v: dv } = views[view];
    const d = new Vector3(...dir);
    const origin = new Vector3(...du).multiplyScalar(u).addScaledVector(new Vector3(...dv), w).addScaledVector(d, -3);
    const m = only?.match(/^([xyz])([<>])(-?[\d.]+)$/);
    for (let v = 0, score = Infinity; v < this.nv; v++) {
      const p = this.at(v);
      if (m && (m[2] === "<" ? p[m[1] as "x"] >= +m[3] : p[m[1] as "x"] <= +m[3])) continue;
      const o = p.sub(origin);
      const t = o.dot(d);
      const perp = Math.sqrt(Math.max(0, o.lengthSq() - t * t));
      if (perp <= 0.012 && t + 4 * perp < score) [best, score] = [v, t + 4 * perp];
    }
    if (best < 0) throw new Error(`pick ${JSON.stringify(s)}: nothing under it`);
    return best;
  }

  // Geodesic distance along the mesh edges from the `from` vertices.
  geodesic(from: number[]) {
    const label = this.watershed(new Map(from.map((v) => [v, 0])), 0);
    return { dist: this.lastDist!, reached: label };
  }

  private lastDist?: Float64Array;

  // Labels grown from `seeded` (vertex -> label); -1 where nothing reached.
  watershed(seeded: Map<number, number>, crease: number, allowed: (v: number) => boolean = () => true) {
    const { P, N } = this;
    const label = new Int32Array(this.nv).fill(-1);
    const dist = new Float64Array(this.nv).fill(Infinity);
    const heap: number[] = [];
    const push = (v: number) => {
      heap.push(v);
      for (let i = heap.length - 1; i > 0; ) {
        const p = (i - 1) >> 1;
        if (dist[heap[p]] <= dist[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          let m = i;
          if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
          if (l + 1 < heap.length && dist[heap[l + 1]] < dist[heap[m]]) m = l + 1;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const [v, l] of seeded) {
      label[v] = l;
      dist[v] = 0;
      push(v);
    }
    const d = new Vector3();
    const dn = new Vector3();
    while (heap.length) {
      const v = pop();
      for (const w of this.neighbours(v)) {
        if (!allowed(w)) continue;
        d.set(P[w * 3] - P[v * 3], P[w * 3 + 1] - P[v * 3 + 1], P[w * 3 + 2] - P[v * 3 + 2]);
        dn.set(N[w * 3] - N[v * 3], N[w * 3 + 1] - N[v * 3 + 1], N[w * 3 + 2] - N[v * 3 + 2]);
        const len = d.length() || 1e-9;
        // Normals converge across a concave crease.
        const nd = dist[v] + len * (1 + crease * Math.max(0, -dn.dot(d) / len));
        if (nd < dist[w]) {
          dist[w] = nd;
          label[w] = label[v];
          push(w);
        }
      }
    }
    this.lastDist = dist;
    return label;
  }

  // The triangles whose label passes `keep` (a triangle goes with the label
  // most of its vertices carry) and none of whose vertices is dropped, less
  // loose islands under `islands` of the largest piece.
  extract(label: Int32Array, keep: (l: number) => boolean, drop?: Uint8Array, islands = 0.02): Geometry {
    const { P, I } = this;
    const remap = new Map<number, number>();
    const index: number[] = [];
    for (let t = 0; t < I.length; t += 3) {
      const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
      const own = label[a] === label[b] || label[a] === label[c] ? label[a] : label[b] === label[c] ? label[b] : label[a];
      if (!keep(own) || drop?.[a] || drop?.[b] || drop?.[c]) continue;
      for (const v of [a, b, c]) {
        if (!remap.has(v)) remap.set(v, remap.size);
        index.push(remap.get(v)!);
      }
    }
    const position = new Float32Array(remap.size * 3);
    for (const [v, j] of remap) position.set(P.subarray(v * 3, v * 3 + 3), j * 3);
    const pieces = components({ position, index: new Uint32Array(index) });
    if (!pieces.length) return { position: new Float32Array(), index: new Uint32Array() };
    return merge(pieces.filter((g) => g.index.length >= pieces[0].index.length * islands));
  }
}
