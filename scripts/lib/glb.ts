/**
 * Shared helpers for the model build scripts (scripts/build-dog-*.ts).
 *
 * Atlas frame for every GLB: metres, Y up, floor at y=0, animal faces -Z,
 * animal's left side is -X. One mesh per structure (or per side) named with
 * meshKey(); right-side meshes are mirrored copies of the left ones.
 */
import fs from "node:fs";
import path from "node:path";
import { Document, NodeIO, type Accessor, type Primitive } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { quantize, simplifyPrimitive, weldPrimitive } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { BufferAttribute, BufferGeometry, CapsuleGeometry, DoubleSide, Matrix4, Quaternion, Ray, SphereGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";

export const CACHE_DIR = path.join(process.cwd(), ".cache", "models");

export type Vec = [number, number, number];
export type Geometry = { position: Float32Array<ArrayBuffer>; index: Uint32Array<ArrayBuffer> };
export type Prim = { prim: Primitive; world: Matrix4 };

await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready]);

export const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

// Downloads a Sketchfab model (by uid) or a plain URL into .cache/models/ once.
export async function download(source: { uid: string; file: string } | { url: string; file: string }) {
  const target = path.join(CACHE_DIR, source.file);
  if (fs.existsSync(target)) return target;
  let url: string;
  if ("uid" in source) {
    process.loadEnvFile(".env.local");
    const token = process.env.SKETCHFAB_TOKEN;
    if (!token) throw new Error("SKETCHFAB_TOKEN missing in .env.local (Sketchfab settings → Password & API)");
    const res = await fetch(`https://api.sketchfab.com/v3/models/${source.uid}/download`, { headers: { authorization: `Token ${token}` } });
    if (!res.ok) throw new Error(`Sketchfab download API: ${res.status} ${await res.text()}`);
    url = ((await res.json()) as { glb: { url: string } }).glb.url;
  } else {
    url = source.url;
  }
  const body = await fetch(url);
  if (!body.ok) throw new Error(`download ${url}: ${body.status}`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(target, Buffer.from(await body.arrayBuffer()));
  console.log(`downloaded ${target}`);
  return target;
}

export async function readPrims(file: string, match: (name: string) => boolean = () => true): Promise<Prim[]> {
  const doc = await io.read(file);
  return doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh() && match(n.getName()))
    .flatMap((n) => n.getMesh()!.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) })));
}

// Applies each primitive's world matrix and then `post` (frame conversion).
// Source normals are dropped (they are per-face and block welding); smooth
// normals are recomputed after simplification.
export function bake(prims: Prim[], post: Matrix4): Geometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const v = new Vector3();
  for (const { prim, world } of prims) {
    const offset = positions.length / 3;
    // getElement() denormalizes quantized accessors.
    const accessor = prim.getAttribute("POSITION")!;
    const el: number[] = [];
    for (let i = 0; i < accessor.getCount(); i++) {
      accessor.getElement(i, el);
      v.set(el[0], el[1], el[2]).applyMatrix4(world).applyMatrix4(post);
      positions.push(v.x, v.y, v.z);
    }
    const idx = prim.getIndices()?.getArray();
    const count = idx ? idx.length : accessor.getCount();
    for (let i = 0; i < count; i++) indices.push(offset + (idx ? idx[i] : i));
  }
  return { position: new Float32Array(positions), index: new Uint32Array(indices) };
}

export function mirror(g: Geometry): Geometry {
  const position = g.position.slice();
  for (let i = 0; i < position.length; i += 3) position[i] *= -1;
  const index = g.index.slice();
  for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  return { position, index };
}

export function transform(g: Geometry, m: Matrix4): Geometry {
  const position = g.position.slice();
  const v = new Vector3();
  for (let i = 0; i < position.length; i += 3) {
    v.fromArray(position, i).applyMatrix4(m);
    v.toArray(position, i);
  }
  const index = g.index.slice();
  // A negative determinant flips winding.
  if (m.determinant() < 0) for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  return { position, index };
}

export function merge(parts: Geometry[]): Geometry {
  const position = new Float32Array(parts.reduce((n, p) => n + p.position.length, 0));
  const index = new Uint32Array(parts.reduce((n, p) => n + p.index.length, 0));
  let pOff = 0;
  let iOff = 0;
  for (const p of parts) {
    position.set(p.position, pOff);
    for (let i = 0; i < p.index.length; i++) index[iOff + i] = p.index[i] + pOff / 3;
    pOff += p.position.length;
    iOff += p.index.length;
  }
  return { position, index };
}

// Splits a mesh into its connected pieces. Vertices at the same position are
// one vertex, so pieces cut across primitives stay whole. Largest first.
export function components(g: Geometry): Geometry[] {
  const ids = new Map<string, number>();
  const weld = new Uint32Array(g.position.length / 3);
  for (let i = 0; i < weld.length; i++) {
    const key = `${g.position[i * 3].toFixed(6)},${g.position[i * 3 + 1].toFixed(6)},${g.position[i * 3 + 2].toFixed(6)}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    weld[i] = ids.get(key)!;
  }
  const parent = Uint32Array.from({ length: ids.size }, (_, i) => i);
  const find = (x: number) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let i = 0; i < g.index.length; i += 3) {
    const a = find(weld[g.index[i]]);
    for (const v of [g.index[i + 1], g.index[i + 2]]) {
      const b = find(weld[v]);
      if (b !== a) parent[b] = a;
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < g.index.length; i += 3) {
    const root = find(weld[g.index[i]]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  return [...groups.values()]
    .map((tris) => {
      const remap = new Map<number, number>();
      const index = new Uint32Array(tris.length * 3);
      tris.forEach((t, j) => {
        for (let k = 0; k < 3; k++) {
          const v = g.index[t + k];
          if (!remap.has(v)) remap.set(v, remap.size);
          index[j * 3 + k] = remap.get(v)!;
        }
      });
      const position = new Float32Array(remap.size * 3);
      for (const [v, i] of remap) position.set(g.position.subarray(v * 3, v * 3 + 3), i * 3);
      return { position, index };
    })
    .sort((a, b) => b.index.length - a.index.length);
}

export function bounds(g: Geometry) {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  for (let i = 0; i < g.position.length; i += 3) {
    v.fromArray(g.position, i);
    min.min(v);
    max.max(v);
  }
  return { min, max, center: min.clone().add(max).multiplyScalar(0.5), size: max.clone().sub(min) };
}

// Area-weighted smooth vertex normals.
export function smoothNormals(position: ArrayLike<number>, index: ArrayLike<number>) {
  const n = new Float32Array(position.length);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < index.length; i += 3) {
    const [i0, i1, i2] = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3];
    a.fromArray(position, i0);
    b.fromArray(position, i1).sub(a);
    c.fromArray(position, i2).sub(a);
    b.cross(c);
    for (const j of [i0, i1, i2]) {
      n[j] += b.x;
      n[j + 1] += b.y;
      n[j + 2] += b.z;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    a.fromArray(n, i).normalize();
    a.toArray(n, i);
  }
  return n;
}

export function fromThree(geometry: BufferGeometry): Geometry {
  const position = new Float32Array(geometry.attributes.position.array);
  const index = geometry.index ? new Uint32Array(geometry.index.array) : Uint32Array.from({ length: position.length / 3 }, (_, i) => i);
  return { position, index };
}

export function capsule(from: Vec, to: Vec, radius: number): Geometry {
  const a = new Vector3(...from);
  const b = new Vector3(...to);
  const dir = b.clone().sub(a);
  const geometry = new CapsuleGeometry(radius, Math.max(dir.length() - radius * 2, 0.001), 6, 16);
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
  geometry.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), quat, new Vector3(1, 1, 1)));
  return fromThree(geometry);
}

export function sphere(center: Vec, radius: number): Geometry {
  const geometry = new SphereGeometry(radius, 24, 16);
  geometry.translate(...center);
  return fromThree(geometry);
}

// Ambient occlusion baked per vertex into COLOR_0 (grey): creases, contacts
// and cavities darken as under soft room light, which is most of what makes
// tissue read as real. Rays reach `reach` metres against every mesh of the
// model; cosine-weighted hemisphere samples, rotated per vertex to avoid bands.
function bakeOcclusion(prims: Primitive[], reach: number, accessor: (array: Float32Array<ArrayBuffer>) => Accessor, samples = 24) {
  const parts = prims.map((p) => ({ pos: p.getAttribute("POSITION")!.getArray()!, idx: p.getIndices()!.getArray()! }));
  const position = new Float32Array(parts.reduce((n, p) => n + p.pos.length, 0));
  const index = new Uint32Array(parts.reduce((n, p) => n + p.idx.length, 0));
  let pOff = 0;
  let iOff = 0;
  for (const p of parts) {
    position.set(p.pos, pOff);
    for (let i = 0; i < p.idx.length; i++) index[iOff + i] = p.idx[i] + pOff / 3;
    pOff += p.pos.length;
    iOff += p.idx.length;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(position, 3));
  geometry.setIndex(new BufferAttribute(index, 1));
  const bvh = new MeshBVH(geometry);

  const golden = Math.PI * (3 - Math.sqrt(5));
  const dirs = Array.from({ length: samples }, (_, i) => {
    const u = (i + 0.5) / samples;
    const r = Math.sqrt(u);
    return [r * Math.cos(i * golden), r * Math.sin(i * golden), Math.sqrt(1 - u)];
  });
  const ray = new Ray();
  const n = new Vector3();
  const t = new Vector3();
  const b = new Vector3();
  for (const prim of prims) {
    const pos = prim.getAttribute("POSITION")!.getArray()!;
    const nor = prim.getAttribute("NORMAL")!.getArray()!;
    const color = new Float32Array(pos.length);
    for (let v = 0; v < pos.length; v += 3) {
      n.set(nor[v], nor[v + 1], nor[v + 2]);
      t.set(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
      b.crossVectors(n, t);
      const spin = ((v * 0.618034) % 1) * Math.PI * 2;
      const [cs, sn] = [Math.cos(spin), Math.sin(spin)];
      let occluded = 0;
      for (const [x0, y0, z] of dirs) {
        const x = x0 * cs - y0 * sn;
        const y = x0 * sn + y0 * cs;
        ray.origin.set(pos[v] + n.x * 3e-4, pos[v + 1] + n.y * 3e-4, pos[v + 2] + n.z * 3e-4);
        ray.direction.set(t.x * x + b.x * y + n.x * z, t.y * x + b.y * y + n.y * z, t.z * x + b.z * y + n.z * z);
        const hit = bvh.raycastFirst(ray, DoubleSide, 0, reach);
        if (hit) occluded += 1 - hit.distance / reach;
      }
      // Never fully black: soft room light still reaches into a crease.
      const ao = 0.3 + 0.7 * Math.pow(1 - occluded / samples, 1.4);
      color[v] = color[v + 1] = color[v + 2] = ao;
    }
    prim.setAttribute("COLOR_0", accessor(color));
  }
}

// Collects meshes and writes one meshopt-compressed GLB, with ambient
// occlusion baked into vertex colours (reach in metres, 0 to skip).
export function createModel(sceneName: string, color: [number, number, number, number], occlusion = 0.03) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(sceneName);
  const material = doc.createMaterial("default").setBaseColorFactor(color).setRoughnessFactor(0.85).setMetallicFactor(0);

  function add(name: string, g: Geometry, tris?: number) {
    const position = doc.createAccessor().setType("VEC3").setArray(g.position).setBuffer(buffer);
    const index = doc.createAccessor().setType("SCALAR").setArray(g.index).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", position).setIndices(index).setMaterial(material);
    if (tris) {
      weldPrimitive(prim);
      const count = prim.getIndices()!.getCount() / 3;
      if (count > tris) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: tris / count, error: 0.01 });
      console.log(`${name}: ${count} -> ${prim.getIndices()!.getCount() / 3} triangles`);
    }
    const normal = smoothNormals(prim.getAttribute("POSITION")!.getArray()!, prim.getIndices()!.getArray()!);
    prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(normal).setBuffer(buffer));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }

  async function write(out: string) {
    if (occlusion > 0) {
      const started = Date.now();
      bakeOcclusion(
        doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()),
        occlusion,
        (array) => doc.createAccessor().setType("VEC3").setArray(array).setBuffer(buffer),
      );
      console.log(`occlusion baked in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 8 }));
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await io.write(out, doc);
    let tris = 0;
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices()!.getCount() / 3;
    console.log(`wrote ${path.relative(process.cwd(), out)}: ${doc.getRoot().listMeshes().length} meshes, ${Math.round(tris)} triangles, ${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB`);
  }

  return { add, write };
}

// Reads a built atlas GLB back as world-space geometry per mesh name, so one
// system can anchor its meshes on another (e.g. muscles on bones).
export async function readAtlas(file: string): Promise<Map<string, Geometry>> {
  const doc = await io.read(file);
  const out = new Map<string, Geometry>();
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const prims = mesh.listPrimitives().map((prim) => ({ prim, world: new Matrix4().fromArray(n.getWorldMatrix()) }));
    out.set(n.getName(), bake(prims, new Matrix4()));
  }
  return out;
}


// ---------------------------------------------------------------------------
// Registration of one mesh onto another (used by the cat build; the dog
// script keeps its own point-to-point versions).

// Up to `max` evenly spaced vertices.
export function points(g: Geometry, max = Infinity): Vector3[] {
  const n = g.position.length / 3;
  const step = Math.max(1, Math.floor(n / max));
  const out: Vector3[] = [];
  for (let i = 0; i < n; i += step) out.push(new Vector3().fromArray(g.position, i * 3));
  return out;
}

export function mean(ps: Vector3[]) {
  return ps.reduce((a, p) => a.add(p), new Vector3()).divideScalar(ps.length);
}

// Eigen decomposition of a symmetric matrix (Jacobi), eigenvalues descending.
function eigen(a: number[][]) {
  const n = a.length;
  const m = a.map((r) => r.slice());
  const v: number[][] = m.map((_, i) => m.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    for (let p = 0; p < n; p++)
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-15) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const [mkp, mkq] = [m[k][p], m[k][q]];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const [mpk, mqk] = [m[p][k], m[q][k]];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const [vkp, vkq] = [v[k][p], v[k][q]];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
  }
  return m.map((_, i) => ({ value: m[i][i], vector: v.map((r) => r[i]) })).sort((x, y) => y.value - x.value);
}

// Principal axes of a point cloud (longest first) and the spread along each.
export function pca(ps: Vector3[]) {
  const c = mean(ps);
  const cov = [0, 1, 2].map(() => [0, 0, 0]);
  for (const p of ps) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  const e = eigen(cov);
  return { center: c, axes: e.map((x) => new Vector3(...x.vector).normalize()), spread: e.map((x) => Math.sqrt(Math.max(x.value, 0) / ps.length)) };
}

// Best rotation + translation (+ uniform scale) mapping src[i] onto dst[i] (Horn's quaternion method).
export function fit(src: Vector3[], dst: Vector3[], withScale = false) {
  const cs = mean(src);
  const cd = mean(dst);
  const s = [0, 1, 2].map(() => [0, 0, 0]);
  let ss = 0;
  for (let i = 0; i < src.length; i++) {
    const a = src[i].clone().sub(cs);
    const b = dst[i].clone().sub(cd);
    ss += a.lengthSq();
    const [av, bv] = [a.toArray(), b.toArray()];
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) s[j][k] += av[j] * bv[k];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = s;
  const n = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const [w, x, y, z] = eigen(n)[0].vector;
  const rot = new Matrix4().makeRotationFromQuaternion(new Quaternion(x, y, z, w).normalize());
  let scale = 1;
  if (withScale) {
    let num = 0;
    for (let i = 0; i < src.length; i++) num += dst[i].clone().sub(cd).dot(src[i].clone().sub(cs).applyMatrix4(rot));
    scale = num / ss;
  }
  return new Matrix4().makeTranslation(cd.x, cd.y, cd.z).multiply(rot).multiply(new Matrix4().makeScale(scale, scale, scale)).multiply(new Matrix4().makeTranslation(-cs.x, -cs.y, -cs.z));
}

function bvhOf(g: Geometry) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(g.position, 3));
  geometry.setIndex(new BufferAttribute(g.index, 1));
  return new MeshBVH(geometry);
}

// Symmetric trimmed ICP of mesh `src` onto mesh `dst` against their surfaces
// (closest points both ways, so a free scale cannot shrink into a dense
// part). Each start transform is refined briefly on fewer points and the
// best one fully.
export function register(src: Geometry, dst: Geometry, starts: Matrix4[], { withScale = false, keep = 0.85, samples = 1500 } = {}) {
  const [sb, db] = [bvhOf(src), bvhOf(dst)];
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  function run(init: Matrix4, iterations: number, n: number) {
    const [sp, dp] = [points(src, n), points(dst, n)];
    let m = init.clone();
    let rms = Infinity;
    for (let it = 0; it < iterations; it++) {
      const inv = m.clone().invert();
      const pairs: { s: Vector3; d: Vector3; e: number }[] = [];
      for (const p of sp) {
        db.closestPointToPoint(p.clone().applyMatrix4(m), hit);
        pairs.push({ s: p, d: hit.point.clone(), e: hit.distance });
      }
      for (const q of dp) {
        sb.closestPointToPoint(q.clone().applyMatrix4(inv), hit);
        pairs.push({ s: hit.point.clone(), d: q, e: hit.point.clone().applyMatrix4(m).distanceTo(q) });
      }
      pairs.sort((a, b) => a.e - b.e);
      const kept = pairs.slice(0, Math.floor(pairs.length * keep));
      rms = Math.sqrt(kept.reduce((a, p) => a + p.e * p.e, 0) / kept.length);
      m = fit(kept.map((p) => p.s), kept.map((p) => p.d), withScale);
    }
    return { m, rms };
  }
  const best = starts.map((s) => run(s, 15, Math.min(samples, 400))).sort((a, b) => a.rms - b.rms)[0];
  return run(best.m, 40, samples);
}

// Start transforms for register(): principal axes of `src` onto those of
// `dst` with every sign combination that keeps handedness (and with the two
// minor axes swapped, for near-round sections), scaled by spread.
export function pcaStarts(src: Geometry, dst: Geometry, withScale = false) {
  const a = pca(points(src, 5000));
  const b = pca(points(dst, 5000));
  const k = withScale ? b.spread[0] / a.spread[0] : 1;
  const out: Matrix4[] = [];
  for (const [s0, s1, minor] of [1, 2].flatMap((j) => [[1, 1, j], [1, -1, j], [-1, 1, j], [-1, -1, j]])) {
    const u = [a.axes[0].clone().multiplyScalar(s0), a.axes[minor].clone().multiplyScalar(s1)];
    const from = new Matrix4().makeBasis(u[0], u[1], u[0].clone().cross(u[1]));
    const to = new Matrix4().makeBasis(b.axes[0], b.axes[1], b.axes[0].clone().cross(b.axes[1]));
    out.push(
      new Matrix4()
        .makeTranslation(b.center.x, b.center.y, b.center.z)
        .multiply(to)
        .multiply(from.transpose())
        .multiply(new Matrix4().makeScale(k, k, k))
        .multiply(new Matrix4().makeTranslation(-a.center.x, -a.center.y, -a.center.z)),
    );
  }
  return out;
}
