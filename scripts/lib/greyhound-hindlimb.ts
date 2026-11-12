/**
 * Pelvic limb muscles of a greyhound, from "Reconstructed 3D anatomy of
 * greyhound hindlimb" (John Hutchinson, Royal Veterinary College; figshare
 * 7240529, CC BY 4.0; Ellis, Rankin & Hutchinson 2018, Front Bioeng
 * Biotechnol, doi:10.3389/fbioe.2018.00162). The muscles were segmented in
 * Mimics from the CT of figshare 7240520 and exported as STL (millimetres;
 * this left limb has +x lateral, +y caudal, +z proximal).
 *
 * The bones come from the same CT (scripts/ct/greyhound_hindlimb.py), whose
 * frame differs from the STL frame. SCAN maps each CT series into the STL
 * frame; it was found once by fitting each bone into the space its muscles
 * leave free (no muscle just inside the bone surface, muscle just outside),
 * with the tibia also held against the femoral condyles. The hip bone and
 * femur of the hip-to-knee series agree within 2 degrees; the tibia's roll
 * about its long axis is uncertain by about 10 degrees.
 *
 * Each limb segment (pelvis, thigh, leg) is then registered rigid + scale
 * from its CT bones onto ours. Every muscle vertex moves with a blend of the
 * segment transforms, weighted by its distance to each segment's CT bones, so
 * muscles that cross a joint bend with it instead of tearing. Vertices that
 * end up inside one of our bones are pushed out to its surface.
 *
 * The scan stops at the tarsus: muscle bellies and the start of their tendons
 * are segmented, distal tendons are not. Each mesh also gets `fibre` (vec4 per
 * vertex): the muscle's long axis laid on the surface, and a tendon weight
 * from local thickness (thin margins of flat muscles score high too).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Ray, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { meshKey } from "../../lib/content/mesh";
import { CACHE_DIR, components, download, mean, merge, pca, pcaStarts, points, register, smoothNormals, transform, type Geometry } from "./glb";
import { weldSimplify } from "./segment";

const ZIP = { url: "https://ndownloader.figshare.com/files/13368233", file: "greyhound-hindlimb-mimics.zip" };
const STL_DIR = path.join(CACHE_DIR, "greyhound-hindlimb");
const CT_OUT = path.join(CACHE_DIR, "greyhound-ct", "out");

// Scan file(s) -> our mesh. File names are the dataset's own, typos included.
//
// | Scan STL                              | Mesh                                              |
// | ------------------------------------- | ------------------------------------------------- |
// | GluteMed                              | gluteus-medius                                    |
// | GluteusSuperficialis                  | gluteus-superficialis                             |
// | GluteusMinimus                        | gluteus-profundus                                 |
// | TFL + TFL2 (two disjoint pieces)      | tensor-fasciae-latae                              |
// | BicepsFemorisUpper                    | biceps-femoris                                    |
// | Semitendinosis                        | semitendinosus                                    |
// | Semimembranosis                       | semimembranosus                                   |
// | Gracilis                              | gracilis                                          |
// | Sartorius / Sartorius2                | sartorius.cranial / sartorius.caudal              |
// | RectusFemoris                         | quadriceps-femoris.rectus-femoris                 |
// | VastusLateralis / Medialis / Intermedius | quadriceps-femoris.vastus-*                    |
// | Iliopsoas                             | iliopsoas                                         |
// | Pectinius                             | pectineus                                         |
// | Adductor + AbductorSomething          | adductor (magnus et brevis + the small cranial    |
// |                                       | belly, likely adductor longus)                    |
// | ObturatorExternus / ObturatorInternus | obturator-externus / obturator-internus           |
// | GemellusSuperior + GemellusInferior   | gemelli                                           |
// | QuadratusFemoris                      | quadratus-femoris                                 |
// | LateraLGastroc / MedialGastroc        | gastrocnemius.lateral / gastrocnemius.medial      |
// | FlexorDigitorumSuperficialis 8_001    | flexor-digitorum-superficialis-pelvic             |
// | FDP2 / FDP                            | flexor-digitorum-profundus-pelvic.lateral/.medial |
// | Popliteus                             | popliteus                                         |
// | TibialisCranialis                     | tibialis-cranialis                                |
// | ExtensorDigitorusLongus (long belly)  | extensor-digitorum-longus                         |
// | ExtensorDigitorumLongus (short belly) | fibularis-longus                                  |
// | ExtensorDigitorusLateralis            | extensor-digitorum-lateralis                      |
//
// FDP2 is the larger, more lateral of the two deep flexor bellies. Not used:
// FlexorDigitorumProfundus (FDP and FDP2 again as one piece) and
// BicepsFemorisLower (a wedge with flat cut faces on the caudomedial distal
// thigh, where the two CT series meet; not identifiable).
const MUSCLES: [string[], string][] = [
  [["GluteMed"], "dog.muscular.gluteus-medius.L"],
  [["GluteusSuperficialis"], "dog.muscular.gluteus-superficialis.L"],
  [["GluteusMinimus"], "dog.muscular.gluteus-profundus.L"],
  [["TFL", "TFL2"], "dog.muscular.tensor-fasciae-latae.L"],
  [["BicepsFemorisUpper"], "dog.muscular.biceps-femoris.L"],
  [["Semitendinosis"], "dog.muscular.semitendinosus.L"],
  [["Semimembranosis"], "dog.muscular.semimembranosus.L"],
  [["Gracilis"], "dog.muscular.gracilis.L"],
  [["Sartorius"], "dog.muscular.sartorius.cranial.L"],
  [["Sartorius2"], "dog.muscular.sartorius.caudal.L"],
  [["RectusFemoris"], "dog.muscular.quadriceps-femoris.rectus-femoris.L"],
  [["VastusLateralis"], "dog.muscular.quadriceps-femoris.vastus-lateralis.L"],
  [["VastusMedialis"], "dog.muscular.quadriceps-femoris.vastus-medialis.L"],
  [["VastusIntermedius"], "dog.muscular.quadriceps-femoris.vastus-intermedius.L"],
  [["Iliopsoas"], "dog.muscular.iliopsoas.L"],
  [["Pectinius"], "dog.muscular.pectineus.L"],
  [["Adductor", "AbductorSomething"], "dog.muscular.adductor.L"],
  [["ObturatorExternus"], "dog.muscular.obturator-externus.L"],
  [["ObturatorInternus"], "dog.muscular.obturator-internus.L"],
  [["GemellusSuperior", "GemellusInferior"], "dog.muscular.gemelli.L"],
  [["QuadratusFemoris"], "dog.muscular.quadratus-femoris.L"],
  [["LateraLGastroc"], "dog.muscular.gastrocnemius.lateral.L"],
  [["MedialGastroc"], "dog.muscular.gastrocnemius.medial.L"],
  [["FlexorDigitorumSuperficialis 8_001"], "dog.muscular.flexor-digitorum-superficialis-pelvic.L"],
  [["FDP2"], "dog.muscular.flexor-digitorum-profundus-pelvic.lateral.L"],
  [["FDP"], "dog.muscular.flexor-digitorum-profundus-pelvic.medial.L"],
  [["Popliteus"], "dog.muscular.popliteus.L"],
  [["TibialisCranialis"], "dog.muscular.tibialis-cranialis.L"],
  [["ExtensorDigitorusLongus"], "dog.muscular.extensor-digitorum-longus.L"],
  [["ExtensorDigitorumLongus"], "dog.muscular.fibularis-longus.L"],
  [["ExtensorDigitorusLateralis"], "dog.muscular.extensor-digitorum-lateralis.L"],
];

// CT series (as written by greyhound_hindlimb.py) -> STL frame, millimetres,
// column-major.
const SCAN: Record<string, number[]> = {
  toknee: [0.01516, 0.99981, -0.01228, 0, -0.99987, 0.01509, -0.00577, 0, -0.00558, 0.01236, 0.99991, 0, -1.90978, 4.57288, 0.40322, 1],
  toankle: [-0.2696, -0.87815, 0.39518, 0, 0.22806, 0.34048, 0.91217, 0, -0.93558, 0.33604, 0.10848, 0, -430.65816, 54.722, -401.36437, 1],
};

// Limb segments: CT bones (series, mesh of greyhound_hindlimb.py), ours, and
// a scan muscle that must end up caudal to another (rules out ICP fits rolled
// half a turn about a shaft).
const SEGMENTS: { ct: [string, string][]; ours: string[]; caudal: [string, string] }[] = [
  { ct: [["toknee", "os-coxae"], ["toknee", "sacrum"]], ours: ["dog.skeletal.os-coxae.L", "dog.skeletal.sacrum"], caudal: ["ObturatorInternus", "TFL2"] },
  { ct: [["toknee", "femur"], ["toknee", "patella"]], ours: ["dog.skeletal.femur.L", "dog.skeletal.patella.L"], caudal: ["Semimembranosis", "RectusFemoris"] },
  { ct: [["toankle", "tibia"]], ours: ["dog.skeletal.tibia.L", "dog.skeletal.fibula.L"], caudal: ["LateraLGastroc", "TibialisCranialis"] },
];

// Width (metres) of the blend between segment transforms.
const BLEND = 0.006;
const TRIS = 2200;

function readStl(file: string): Geometry {
  const b = fs.readFileSync(file);
  const n = b.readUInt32LE(80);
  const position = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) position[i * 9 + k] = b.readFloatLE(84 + i * 50 + 12 + k * 4) * 0.001;
  return { position, index: Uint32Array.from({ length: n * 3 }, (_, i) => i) };
}

async function stls() {
  if (!fs.existsSync(STL_DIR)) {
    const zip = await download(ZIP);
    fs.mkdirSync(STL_DIR, { recursive: true });
    execFileSync("unzip", ["-o", "-q", "-j", zip, "Mimics models/MuscleModels/*.stl", "-d", STL_DIR], { stdio: "inherit" });
  }
  return (name: string) => readStl(path.join(STL_DIR, `${name}.stl`));
}

function readCt(series: string) {
  if (!fs.existsSync(path.join(CT_OUT, `${series}.json`))) {
    execFileSync(path.join(".venv", "bin", "python"), ["-I", path.join("scripts", "ct", "greyhound_hindlimb.py")], { stdio: "inherit" });
  }
  const index = JSON.parse(fs.readFileSync(path.join(CT_OUT, `${series}.json`), "utf8")) as { name: string; kind: string; offset: number; count: number }[];
  const bin = fs.readFileSync(path.join(CT_OUT, `${series}.bin`));
  const out = new Map<string, Geometry>();
  for (const e of index) {
    const g = out.get(e.name) ?? ({} as Geometry);
    const buf = bin.buffer.slice(bin.byteOffset + e.offset, bin.byteOffset + e.offset + e.count * 4) as ArrayBuffer;
    if (e.kind === "position") g.position = new Float32Array(buf).map((v) => v * 0.001);
    else g.index = new Uint32Array(buf);
    out.set(e.name, g);
  }
  return out;
}

function bvh(g: Geometry) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(g.position, 3));
  geometry.setIndex(new BufferAttribute(g.index, 1));
  return new MeshBVH(geometry);
}

// CT axes onto ours (x lateral -> -X, z proximal -> +Y, y caudal -> +Z),
// moved and scaled so the principal spread matches: the start for ICP.
function axesStart(src: Geometry, dst: Geometry) {
  const a = pca(points(src, 4000));
  const b = pca(points(dst, 4000));
  const k = b.spread[0] / a.spread[0];
  return new Matrix4()
    .makeTranslation(b.center.x, b.center.y, b.center.z)
    .multiply(new Matrix4().set(-k, 0, 0, 0, 0, 0, k, 0, 0, k, 0, 0, 0, 0, 0, 1))
    .multiply(new Matrix4().makeTranslation(-a.center.x, -a.center.y, -a.center.z));
}

// Keeps the largest pieces (drops specks under 2 % of the main one).
function clean(g: Geometry) {
  const parts = components(g);
  return merge(parts.filter((p) => p.index.length >= parts[0].index.length * 0.02));
}

export async function greyhoundHindlimb(skeleton: Map<string, Geometry>): Promise<Map<string, Geometry>> {
  const stl = await stls();
  const ct: Record<string, Map<string, Geometry>> = {};
  for (const [series, m] of Object.entries(SCAN)) {
    const scan = new Matrix4().fromArray(m);
    for (const i of [12, 13, 14]) scan.elements[i] *= 0.001;
    ct[series] = new Map([...readCt(series)].map(([k, g]) => [k, transform(g, scan)]));
  }

  const segments = SEGMENTS.map((s) => {
    const src = merge(s.ct.map(([series, name]) => ct[series].get(name)!));
    const dst = merge(s.ours.map((id) => skeleton.get(meshKey(id))!));
    const [back, front] = s.caudal.map((n) => mean(points(stl(n), 2000)));
    const kept = (m: Matrix4) => back.clone().applyMatrix4(m).z > front.clone().applyMatrix4(m).z;
    const { m, rms } = [axesStart(src, dst), ...pcaStarts(src, dst, true)]
      .map((start) => register(src, dst, [start], { withScale: true }))
      .filter((f) => kept(f.m))
      .sort((a, b) => a.rms - b.rms)[0];
    const scale = Math.cbrt(m.determinant());
    console.log(`greyhound ${s.ours[0]}: ICP rms ${(rms * 1000).toFixed(2)} mm, scale ${scale.toFixed(3)}`);
    return { m, tree: bvh(src) };
  });

  const bones = merge(SEGMENTS.flatMap((s) => s.ours.map((id) => skeleton.get(meshKey(id))!)));
  const bonesTree = bvh(bones);
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  // Where a point inside one of our bones leaves it (1 mm out), else undefined.
  function exit(p: Vector3) {
    if (!bonesTree.closestPointToPoint(p, hit, 0, 0.02)) return undefined;
    const t = hit.faceIndex * 3;
    a.fromArray(bones.position, bones.index[t] * 3);
    b.fromArray(bones.position, bones.index[t + 1] * 3).sub(a);
    c.fromArray(bones.position, bones.index[t + 2] * 3).sub(a);
    const n = b.cross(c).normalize();
    return a.copy(p).sub(hit.point).dot(n) < 0 ? hit.point.clone().addScaledVector(n, 0.001) : undefined;
  }

  // Segment weights per vertex, from distances in the scan frame.
  const S = segments.length;
  const muscles = MUSCLES.map(([files, id]) => {
    const g = weldSimplify(clean(merge(files.map(stl))), TRIS, 0.002);
    const weights = new Float32Array((g.position.length / 3) * S);
    const p = new Vector3();
    for (let v = 0; v < g.position.length / 3; v++) {
      p.fromArray(g.position, v * 3);
      const d = segments.map((s) => s.tree.closestPointToPoint(p, hit)!.distance);
      const near = Math.min(...d);
      const w = d.map((x) => Math.exp(-(x - near) / BLEND));
      const total = w.reduce((x, y) => x + y);
      w.forEach((x, j) => (weights[v * S + j] = x / total));
    }
    return { id, g, weights };
  });

  const out = new Map<string, Geometry & { fibre: Float32Array<ArrayBuffer> }>();
  for (const { id, g, weights } of muscles) {
    const count = g.position.length / 3;
    const position = new Float32Array(g.position.length);
    const along = pca(points(g, 4000)).axes[0];
    const dirs = new Float32Array(g.position.length);
    const p = new Vector3();
    const m = new Matrix4();
    for (let v = 0; v < count; v++) {
      m.elements.fill(0);
      segments.forEach((s, j) => s.m.elements.forEach((x, k) => (m.elements[k] += x * weights[v * S + j])));
      p.fromArray(g.position, v * 3).applyMatrix4(m);
      (exit(p) ?? p).toArray(position, v * 3);
      p.copy(along).transformDirection(m).toArray(dirs, v * 3);
    }
    out.set(meshKey(id), { position, index: g.index, fibre: fibres(position, g.index, dirs) });
  }
  return out;
}

// Per vertex: fibre direction (the muscle's long axis, carried by the blend
// and laid on the surface) and a tendon weight from local thickness (1 where
// the muscle is under 15 % of its median thickness, 0 above 40 %).
function fibres(position: Float32Array<ArrayBuffer>, index: Uint32Array<ArrayBuffer>, dirs: Float32Array) {
  const count = position.length / 3;
  const normal = smoothNormals(position, index);
  const tree = bvh({ position, index });
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
