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

