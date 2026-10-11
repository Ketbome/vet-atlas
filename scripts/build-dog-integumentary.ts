/**
 * Builds public/models/dog/integumentary.glb (skin, claws and eyes) from
 * "Canine Model" by Lova Dahn (Sketchfab, CC BY 4.0), an anatomically sculpted
 * dog/wolf base mesh. Its body, claw and eye meshes are used.
 *
 * The sculpt has other proportions and another pose than our skeleton, so it
 * is registered onto public/models/dog/skeletal.glb:
 *   1. a thin-plate-spline warp moves landmarks picked on the sculpt (joint
 *      centres, head, dorsal and ventral midline) onto the same landmarks
 *      measured on the bones, so it follows the skeleton when that changes;
 *   2. the tail is laid along the caudal vertebrae;
 *   3. the warp is re-solved with extra landmarks that move probe vertices
 *      out past the bones and, when public/models/dog/muscular.glb exists,
 *      the muscles (5 mm clearance), then Taubin-smoothed;
 *   4. a final push-out moves the surface past the bones (skull and mandible
 *      included) and muscles still outside, spread smoothly over the mesh;
 *   5. everything below the floor is clamped to y = 0.
 *
 * Source frame: metres, Y up, floor at y=0, animal faces +Z, left side +X.
 * Output: atlas frame (faces -Z, left -X). The skin is one mesh; claws and
 * eyes are split by side and the right side is a mirrored copy of the left.
 *
 * Eyes: the sculpt's globes are about 36 mm across (a dog's is 21-24 mm) and
 * bulge out of the orbit, so each is replaced by a 23 mm globe seated behind
 * the eyelid opening (the hole in the skin): its centre lies on the axis of
 * the opening, deep enough that the globe fills it with the cornea just proud
 * of the lids. Vertex colours paint pupil, iris and sclera around that axis.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";
import { bake, createModel, download, io, merge, mirror, readAtlas, readPrims, smoothNormals, type Geometry } from "./lib/glb";

const OUT = path.join(process.cwd(), "public", "models", "dog", "integumentary.glb");
const SKELETON = path.join(process.cwd(), "public", "models", "dog", "skeletal.glb");
const source = { uid: "5e9bd77e509c4b58aebab6385feae68c", file: "lovadahn-canine-model.glb" };

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const side = (p: Vector3) => p.clone().setX(-p.x);

// ---------------------------------------------------------------- source

const file = await download(source);
const flip = new Matrix4().makeRotationY(Math.PI);
const body = bake(await readPrims(file, (n) => n === "Body__0"), flip);
const clawsLeft = keepSide(bake(await readPrims(file, (n) => n === "Claws__0"), flip));
const eyesLeft = keepSide(bake(await readPrims(file, (n) => n === "Eyes__0"), flip));

// Landmarks on the sculpt after the flip (left side, x < 0), read off
// cross-sections of the mesh. Joint centres are inside the limb.
const S = {
  shoulder: v3(-0.045, 0.27, -0.185),
  elbow: v3(-0.041, 0.195, -0.127),
  olecranon: v3(-0.041, 0.2, -0.114),
  carpus: v3(-0.028, 0.05, -0.129),
  forePaw: v3(-0.035, 0, -0.153),
  scapulaTop: v3(-0.025, 0.355, -0.125),
  hip: v3(-0.042, 0.295, 0.14),
  stifle: v3(-0.04, 0.2, 0.128),
  hock: v3(-0.042, 0.1, 0.203),
  hindPaw: v3(-0.052, 0, 0.187),
  ischium: v3(-0.025, 0.3, 0.178),
  // Midline skin points.
  nose: v3(0, 0.33, -0.386),
  eye: v3(-0.02, 0.362, -0.315),
  occiput: v3(0, 0.392, -0.268),
  chin: v3(0, 0.296, -0.355),
  withers: v3(0, 0.372, -0.125),
  back: v3(0, 0.352, -0.002),
  croup: v3(0, 0.361, 0.096),
  throat: v3(0, 0.302, -0.27),
  presternum: v3(0, 0.25, -0.2),
  chest: v3(0, 0.199, -0.07),
  belly: v3(0, 0.236, 0.06),
  tailRoot: v3(0, 0.31, 0.195),
};

// ---------------------------------------------------------------- skeleton

const bones = await readAtlas(SKELETON);
const bone = (name: string) => {
  const g = bones.get(`dog_skeletal_${name}`);
  if (!g) throw new Error(`skeleton has no mesh dog_skeletal_${name}`);
  return g;
};
const hasBone = (name: string) => bones.has(`dog_skeletal_${name}`);

// Centroid of the vertices in the low or high 10% of a bone along one axis.
function end(g: Geometry, axis: 0 | 1 | 2, high: boolean, frac = 0.1) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = axis; i < g.position.length; i += 3) {
    min = Math.min(min, g.position[i]);
    max = Math.max(max, g.position[i]);
  }
  const limit = high ? max - (max - min) * frac : min + (max - min) * frac;
  const c = new Vector3();
  let n = 0;
  for (let i = 0; i < g.position.length; i += 3) {
    const v = g.position[i + axis];
    if (high ? v >= limit : v <= limit) {
      c.add(v3(g.position[i], g.position[i + 1], g.position[i + 2]));
      n++;
    }
  }
  return c.divideScalar(n);
}
const centroid = (g: Geometry) => end(g, 1, true, 1);

const humerus = bone("humerus_L");
const radius = bone("radius_L");
const scapula = bone("scapula_L");
const femur = bone("femur_L");
const tibia = bone("tibia_L");
const coxae = bone("os-coxae_L");
const skull = bone("skull");
const mandible = bone("mandible");
const hyoid = bone("hyoid");
const manubrium = bone("manubrium");
const sacrum = bone("sacrum");

const carpusT = hasBone("carpus_L") ? centroid(bone("carpus_L")) : end(radius, 1, false).add(v3(0, -0.015, 0));
const elbowT = end(humerus, 1, false);
const hockT = end(tibia, 1, false).add(v3(0, -0.008, 0));
const hindPawT = hasBone("phalanges-pelvic_L") ? centroid(bone("phalanges-pelvic_L")).add(v3(0, 0, -0.008)).setY(0) : hockT.clone().add(v3(0, 0, -0.03)).setY(0);
const forePawT = hasBone("phalanges-thoracic_L") ? centroid(bone("phalanges-thoracic_L")).setY(0) : carpusT.clone().add(v3(0, 0, -0.03)).setY(0);

const T = {
  shoulder: end(humerus, 1, true).add(v3(0, -0.008, 0)),
  elbow: elbowT,
  carpus: carpusT,
  forePaw: forePawT,
  scapulaTop: end(scapula, 1, true),
  hip: end(femur, 1, true).add(v3(0, -0.008, 0)),
  stifle: end(femur, 1, false).add(end(tibia, 1, true)).multiplyScalar(0.5),
  hock: hockT,
  hindPaw: hindPawT,
  ischium: end(coxae, 2, true),
};

// Everything the skin has to contain: the bones (minus skull, mandible and
// hyoid, whose teeth sit in the mouth) and, when built, the muscles. The tail
// is placed on its vertebrae directly, so they stay out of the probes.
const MUSCULAR = path.join(process.cwd(), "public", "models", "dog", "muscular.glb");
const muscles = existsSync(MUSCULAR) ? [...(await readAtlas(MUSCULAR)).values()] : [];
const boneContents = [...bones].filter(([name]) => !/skull|mandible|hyoid/.test(name));
const contents = [...boneContents.map(([, g]) => g), ...muscles];
const inner = thin([...boneContents.filter(([name]) => !name.includes("caudal")).map(([, g]) => g), ...muscles], 0.0025);
// Highest content point near the midline at one z (for the dorsal line).
const topAt = (z: number) => {
  let top = -Infinity;
  for (let i = 0; i < inner.length; i += 3) if (Math.abs(inner[i + 2] - z) < 0.01 && Math.abs(inner[i]) < 0.03) top = Math.max(top, inner[i + 1]);
  return top;
};

// Head: frame from the rostral tip of the incisive bone (N) to the external
// occipital protuberance (O), measured on the skull scan.
const skullN = extreme(skull, (p) => -p.z);
const skullO = extreme(skull, (p) => p.z + p.y);
const headAxis = skullO.clone().sub(skullN);
const headLen = headAxis.length();
headAxis.normalize();
const headUp = headAxis.clone().cross(new Vector3(1, 0, 0)).normalize();
const head = (along: number, up: number, lateral = 0) =>
  skullN.clone().addScaledVector(headAxis, along * headLen).addScaledVector(headUp, up).add(v3(lateral, 0, 0));
const chinBone = extreme(mandible, (p) => -p.y - Math.max(0, p.z - skullN.z - 0.06));
const arch = extreme(skull, (p) => -p.x);
const larynx = extreme(hyoid, (p) => -p.y);

const headPairs: [Vector3, Vector3][] = [
  [S.nose, head(0, 0.012).addScaledVector(headAxis, -0.014)],
  [S.eye, head(0.486, 0.01, -0.03)],
  [side(S.eye), head(0.486, 0.01, 0.03)],
  [S.occiput, head(1, 0.008).addScaledVector(headAxis, 0.006)],
  [S.chin, chinBone.clone().add(v3(0, -0.008, -0.004)).setX(0)],
];
// The sculpt's head is narrower than our skull: widen it until the cheek
// clears the zygomatic arch.
const headMap = similarity(headPairs);
const cheekS = v3(-0.038, 0.335, -0.305).applyMatrix4(headMap);
headMap.premultiply(new Matrix4().makeScale((arch.x - 0.008) / cheekS.x, 1, 1));

// Dorsal midline skin from occiput to withers (quadratic curve, arched neck).
const withersT = v3(0, Math.max(T.scapulaTop.y + 0.02, topAt(T.scapulaTop.z) + 0.006), T.scapulaTop.z);
const occT = headPairs[3][1];
const neckCtrl = v3(0, occT.y * 0.55 + withersT.y * 0.45, withersT.z - 0.015);
const neckDorsal = (t: number) => {
  const p = occT.clone().multiplyScalar((1 - t) ** 2).addScaledVector(neckCtrl, 2 * t * (1 - t)).addScaledVector(withersT, t * t);
  return p.setY(Math.max(p.y, topAt(p.z) + 0.006));
};

const presternumT = end(manubrium, 2, false).add(v3(0, -0.006, -0.018)).setX(0);
const throatT = larynx.clone().add(v3(0, -0.012, 0)).setX(0);
const sacrumTop = end(sacrum, 1, true);

// ---------------------------------------------------------------- landmarks

const pairs: [Vector3, Vector3][] = [];
const add = (s: Vector3, t: Vector3, paired = false) => {
  pairs.push([s.clone(), t.clone()]);
  if (paired) pairs.push([side(s), side(t)]);
};

// Limb chains: joint centres, plus vertices sampled around the distal
// segments and carried along by each segment's rotation and scale.
const fore = ["shoulder", "elbow", "carpus", "forePaw"] as const;
const hind = ["hip", "stifle", "hock", "hindPaw"] as const;
for (const chain of [fore, hind]) {
  for (const j of chain) add(S[j], T[j], true);
  for (let i = 0; i < chain.length - 1; i++) {
    const [a, b] = [chain[i], chain[i + 1]];
    if (i === 0) add(S[a].clone().lerp(S[b], 0.5), T[a].clone().lerp(T[b], 0.5), true);
    else if (i === 1) for (const [s, t] of segmentSamples(S[a], S[b], T[a], T[b], 1.3)) add(s, t, true);
  }
  // The paw keeps its shape, turned to point where the digits point, as wide
  // as their spread and long enough for the claws to sit over the distal
  // phalanges; scaled about the paw centre.
  const paw = chain[3];
  const phalanges = paw === "forePaw" ? "phalanges-thoracic_L" : "phalanges-pelvic_L";
  const toes = toeEnds(paw === "forePaw" ? (p) => p.z < 0 : (p) => p.z > 0, S[paw]);
  const tips = hasBone(phalanges) ? digitTips(bone(phalanges)) : [];
  const pawVerts = sample(body, (p) => p.x < 0 && p.y < 0.03 && p.distanceTo(S[paw]) < 0.045, 100000);
  let map = (p: Vector3) => T[paw].clone().add(p.clone().sub(S[paw]).multiplyScalar(1.3));
  if (tips.length === toes.length) {
    // Forward and lateral axes of the paw in both frames; the width follows
    // the spread of the digits plus 8 mm of skin and pad on each side.
    const fs = mean(toes).sub(S[paw]).setY(0).normalize();
    const ft = mean(tips).sub(T[paw]).setY(0).normalize();
    const ls = v3(fs.z, 0, -fs.x);
    const lt = v3(ft.z, 0, -ft.x);
    const span = (list: Vector3[], axis: Vector3) => Math.max(...list.map((p) => p.dot(axis))) - Math.min(...list.map((p) => p.dot(axis)));
    const digits: Vector3[] = [];
    const g = bone(phalanges);
    for (let i = 0; i < g.position.length; i += 3) if (g.position[i + 1] < 0.025) digits.push(v3(g.position[i], g.position[i + 1], g.position[i + 2]));
    const lateralScale = (span(digits, lt) + 0.016) / span(pawVerts, ls);
    const reach = (list: Vector3[], from: Vector3, axis: Vector3) => Math.max(...list.map((p) => p.clone().sub(from).dot(axis)));
    const forwardScale = Math.max(1.3, (reach(tips, T[paw], ft) + 0.004) / reach(toes, S[paw], fs));
    map = (p) => {
      const d = p.clone().sub(S[paw]);
      return T[paw].clone().addScaledVector(ft, d.dot(fs) * forwardScale).addScaledVector(lt, d.dot(ls) * lateralScale).add(v3(0, d.y * 1.3, 0));
    };
  }
  for (const s of sample(body, (p) => p.x < 0 && p.y < 0.03 && p.distanceTo(S[paw]) < 0.045, 16)) add(s, map(s), true);
}
add(S.olecranon, end(bone("ulna_L"), 1, true), true);
add(S.ischium, T.ischium.clone().add(v3(0, 0, 0.004)), true);

// Head as one rigid piece.
for (const s of sample(body, (p) => p.z < -0.285 && p.y > 0.29, 48)) add(s, s.clone().applyMatrix4(headMap));

// Dorsal midline.
for (const t of [0.3, 0.6]) add(S.occiput.clone().lerp(S.withers, t).setY(dorsalY(body, S.occiput.z + (S.withers.z - S.occiput.z) * t)), neckDorsal(t));
add(S.withers, withersT);
const l1 = centroid(bone("vertebra-l1"));
add(S.back, v3(0, Math.max(end(bone("vertebra-l1"), 1, true).y + 0.012, topAt(l1.z) + 0.006), l1.z));
add(S.croup, v3(0, Math.max(sacrumTop.y + 0.014, end(coxae, 1, true).y + 0.014, topAt(sacrumTop.z) + 0.006), sacrumTop.z));

// Ventral midline: throat under the larynx, point of the chest in front of
// the manubrium, chest floor level with the elbows.
add(S.throat, throatT);
add(S.throat.clone().lerp(S.presternum, 0.5).setY(ventralY(body, (S.throat.z + S.presternum.z) / 2)), throatT.clone().lerp(presternumT, 0.5).add(v3(0, 0, -0.01)));
add(S.presternum, presternumT);
add(S.chest, v3(0, T.elbow.y, T.elbow.z + 0.07));

// Belly and flanks follow an axis-aligned scaling fitted to the trunk pairs.
const trunk = affine(pairs.filter(([s]) => s.z > -0.2 && s.z < 0.2));
add(S.belly, S.belly.clone().applyMatrix4(trunk));
// Flanks: 25 mm of body wall outside the widest rib at that level.
// One mesh per rib since the skeleton was completed; older builds had one per side.
const ribs = hasBone("ribs_L")
  ? bone("ribs_L")
  : merge([...bones].filter(([name]) => /^dog_skeletal_ribs_\d+_L$/.test(name)).map(([, g]) => g));
for (const z of [-0.1, -0.03, 0.04]) {
  const rib = extreme(ribs, (p) => (Math.abs(p.z - z) < 0.015 ? -p.x : -Infinity));
  if (!Number.isFinite(rib.x) || Math.abs(rib.z - z) > 0.015) continue;
  const s = lateral(body, (z - trunk.elements[14]) / trunk.elements[10]);
  add(s, v3(rib.x - 0.025, s.clone().applyMatrix4(trunk).y, z), true);
}
// Point of the shoulder and greater trochanter: 15 mm of skin and fascia.
const humerusLat = extreme(humerus, (p) => (p.y > T.shoulder.y - 0.03 ? -p.x : -Infinity));
add(extreme(body, (p) => (p.z > -0.2 && p.z < -0.17 && p.y > 0.25 && p.y < 0.28 ? -p.x : -Infinity)), humerusLat.clone().add(v3(-0.015, 0, 0)), true);
const femurLat = extreme(femur, (p) => (p.y > T.hip.y - 0.03 ? -p.x : -Infinity));
add(extreme(body, (p) => (p.z > 0.13 && p.z < 0.17 && p.y > 0.27 && p.y < 0.31 ? -p.x : -Infinity)), femurLat.clone().add(v3(-0.015, 0, 0)), true);

// Tail: follows the caudal vertebrae. Source tail vertices are placed along
// the Cd chain by arc length (see tailMap); the stretch near the root also
// goes into the warp so the croup blends into it.
const caudal = [...bones]
  .filter(([name]) => /^dog_skeletal_vertebrae-caudal_cd\d+$/.test(name))
  .sort(([a], [b]) => Number(a.split("_cd")[1]) - Number(b.split("_cd")[1]))
  .map(([, g]) => g);
const tailMap = caudal.length > 1 ? tailCurve(caudal) : null;
if (tailMap) for (const s of sample(body, (p) => isTail(p) && p.z - S.tailRoot.z < 0.06, 24)) add(s, tailMap(s));

// ---------------------------------------------------------------- warp

// Inflation: probe vertices spread over the sculpt are moved out along their
// normals past any contents in front of them and added as landmarks, so the
// warp itself grows the surface smoothly. Five rounds.
const probes = probeVertices(body, pairs, 0.02);
let warp = tps(pairs, 1e-4);
for (let round = 0; round < 5; round++) {
  const targets = clearanceNeeded({ position: place(warp), index: body.index }, inner, probes, 0.005);
  const at = (v: number) => v3(body.position[v * 3], body.position[v * 3 + 1], body.position[v * 3 + 2]);
  warp = tps([...pairs, ...probes.flatMap(([l, r], i): [Vector3, Vector3][] => [[at(l), targets[2 * i]], [at(r), targets[2 * i + 1]]])], 1e-4);
}

const skin: Geometry = { position: place(warp), index: body.index };
taubin(skin, (v) => body.position[v * 3 + 2] > -0.27 && body.position[v * 3 + 1] > 0.05 && !isTail(v3(body.position[v * 3], body.position[v * 3 + 1], body.position[v * 3 + 2])));
const claws: Geometry = { position: warp(clawsLeft.position), index: clawsLeft.index };
const eyes: Geometry = { position: warp(eyesLeft.position), index: eyesLeft.index };
const warped = skin.position.slice();
// Bone inside a claw (the ungual processes) is covered by integument too.
const inClaw = insideTest(merge([claws, mirror(claws)]));
// The skull and mandible are pushed under the skin here (not in the warp,
// where the head is one rigid piece). Rays of the inside test that pass
// through an eye opening count wrong, so bone in line with the eyes is left
// out.
const eyeCentre = mean(Array.from({ length: eyes.position.length / 3 }, (_, i) => v3(eyes.position[i * 3], eyes.position[i * 3 + 1], eyes.position[i * 3 + 2])));
const inEyeLine = (x: number, y: number, z: number) => Math.hypot(y - eyeCentre.y, z - eyeCentre.z) < 0.016;
const pushed = pushOut(skin, [...contents, skull, mandible], 0.003, (x, y, z) => inClaw(x, y, z) || inEyeLine(x, y, z));
carry(claws, warped, pushed);
carry(eyes, warped, pushed);
for (const g of [skin, claws]) for (let i = 1; i < g.position.length; i += 3) g.position[i] = Math.max(0, g.position[i]);
// Centre of the left eye: its triangles only (the vertex list holds both eyes).
const eye = seat(skin, mean([...eyes.index].map((v) => v3(eyes.position[v * 3], eyes.position[v * 3 + 1], eyes.position[v * 3 + 2]))), 0.0115);
const globeL = globe(eye.centre, 0.0115, eye.axis);

const model = createModel("dog.integumentary", [0.85, 0.71, 0.61, 1]);
model.add(meshKey("dog.integumentary.skin"), skin, 50000);
model.add(meshKey("dog.integumentary.claws.L"), claws, 3000);
model.add(meshKey("dog.integumentary.claws.R"), mirror(claws), 3000);
model.add(meshKey("dog.integumentary.eyes.L"), globeL, 2000);
model.add(meshKey("dog.integumentary.eyes.R"), mirror(globeL), 2000);
await model.write(OUT);
await paintEyes(OUT, eye.centre, eye.axis);

// ---------------------------------------------------------------- helpers

function keepSide(g: Geometry): Geometry {
  const index: number[] = [];
  for (let i = 0; i < g.index.length; i += 3) {
    if ([0, 1, 2].every((k) => g.position[g.index[i + k] * 3] < 0)) index.push(g.index[i], g.index[i + 1], g.index[i + 2]);
  }
  return { position: g.position, index: new Uint32Array(index) };
}

function extreme(g: Geometry, score: (p: Vector3) => number) {
  const p = new Vector3();
  const best = new Vector3();
  let top = -Infinity;
  for (let i = 0; i < g.position.length; i += 3) {
    p.fromArray(g.position, i);
    const s = score(p);
    if (s > top) {
      top = s;
      best.copy(p);
    }
  }
  return best;
}

function dorsalY(g: Geometry, z: number) {
  return extreme(g, (p) => (Math.abs(p.z - z) < 0.004 && Math.abs(p.x) < 0.006 ? p.y : -Infinity)).y;
}

function ventralY(g: Geometry, z: number) {
  return extreme(g, (p) => (Math.abs(p.z - z) < 0.004 && Math.abs(p.x) < 0.006 ? -p.y : -Infinity)).y;
}

// Left-most skin point of the trunk at one z, above the limbs.
function lateral(g: Geometry, z: number) {
  return extreme(g, (p) => (Math.abs(p.z - z) < 0.004 && p.y > 0.24 ? -p.x : -Infinity));
}

// Every n-th vertex matching the filter, spread to about `count` points.
function sample(g: Geometry, keep: (p: Vector3) => boolean, count: number) {
  const hits: Vector3[] = [];
  for (let i = 0; i < g.position.length; i += 3) {
    const p = v3(g.position[i], g.position[i + 1], g.position[i + 2]);
    if (keep(p)) hits.push(p);
  }
  const step = Math.max(1, Math.floor(hits.length / count));
  return hits.filter((_, i) => i % step === 0);
}

// Vertices around the middle of a limb segment, mapped by the segment's
// rotation, axial stretch and radial scale `k`.
function segmentSamples(sa: Vector3, sb: Vector3, ta: Vector3, tb: Vector3, k: number) {
  const ds = sb.clone().sub(sa);
  const dt = tb.clone().sub(ta);
  const ls = ds.length();
  const lt = dt.length();
  ds.normalize();
  dt.normalize();
  const rot = new Quaternion().setFromUnitVectors(ds, dt);
  const pts = sample(body, (p) => {
    if (p.x > 0) return false;
    const local = p.clone().sub(sa);
    const t = local.dot(ds) / ls;
    return t > 0.25 && t < 0.75 && local.addScaledVector(ds, -t * ls).length() < 0.035;
  }, 10);
  return pts.map((p) => {
    const local = p.clone().sub(sa);
    const axial = local.dot(ds);
    const radial = local.addScaledVector(ds, -axial).multiplyScalar(k);
    return [p, ta.clone().add(dt.clone().multiplyScalar((axial * lt) / ls)).add(radial.applyQuaternion(rot))] as [Vector3, Vector3];
  });
}

// Best-fit rotation + uniform scale + translation (Umeyama).
function similarity(list: [Vector3, Vector3][]) {
  const cs = new Vector3();
  const ct = new Vector3();
  for (const [s, t] of list) {
    cs.add(s);
    ct.add(t);
  }
  cs.divideScalar(list.length);
  ct.divideScalar(list.length);
  const h = Array.from({ length: 9 }, () => 0);
  let vs = 0;
  for (const [s, t] of list) {
    const a = s.clone().sub(cs);
    const b = t.clone().sub(ct);
    vs += a.lengthSq();
    const av = [a.x, a.y, a.z];
    const bv = [b.x, b.y, b.z];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) h[r * 3 + c] += bv[r] * av[c];
  }
  const { u, s, v } = svd3(h);
  const d = Math.sign(det3(u) * det3(v));
  const dd = [1, 1, d];
  const r = Array.from({ length: 9 }, (_, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    let sum = 0;
    for (let k = 0; k < 3; k++) sum += u[row * 3 + k] * dd[k] * v[col * 3 + k];
    return sum;
  });
  const scale = (s[0] + s[1] + d * s[2]) / vs;
  const m = new Matrix4().set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
  m.premultiply(new Matrix4().makeScale(scale, scale, scale));
  const t = ct.clone().sub(cs.clone().applyMatrix4(m));
  return m.setPosition(t);
}

function det3(m: number[]) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

// SVD of a 3x3 matrix via Jacobi on HᵀH.
function svd3(h: number[]) {
  const a = Array.from({ length: 9 }, (_, i) => {
    const r = Math.floor(i / 3);
    const c = i % 3;
    let s = 0;
    for (let k = 0; k < 3; k++) s += h[k * 3 + r] * h[k * 3 + c];
    return s;
  });
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-15) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j * 4] - a[i * 4]);
  const sv = order.map((i) => Math.sqrt(Math.max(0, a[i * 4])));
  const vs = Array.from({ length: 9 }, (_, i) => v[Math.floor(i / 3) * 3 + order[i % 3]]);
  const u = Array.from({ length: 9 }, () => 0);
  for (let c = 0; c < 3; c++) {
    const col = [0, 1, 2].map((r) => h[r * 3] * vs[c] + h[r * 3 + 1] * vs[3 + c] + h[r * 3 + 2] * vs[6 + c]);
    const len = Math.hypot(...col) || 1;
    for (let r = 0; r < 3; r++) u[r * 3 + c] = col[r] / len;
  }
  return { u, s: sv, v: vs };
}

// Per-axis scale + offset fitted by least squares (x: scale only, about the midline).
function affine(list: [Vector3, Vector3][]) {
  const fit = (axis: "y" | "z") => {
    const n = list.length;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    for (const [s, t] of list) {
      sx += s[axis];
      sy += t[axis];
      sxx += s[axis] * s[axis];
      sxy += s[axis] * t[axis];
    }
    const k = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    return [k, (sy - k * sx) / n];
  };
  const [ky, oy] = fit("y");
  const [kz, oz] = fit("z");
  let num = 0;
  let den = 0;
  for (const [s, t] of list) {
    num += s.x * t.x;
    den += s.x * s.x;
  }
  return new Matrix4().set(num / den, 0, 0, 0, 0, ky, 0, oy, 0, 0, kz, oz, 0, 0, 0, 1);
}

// Centre of each weight-bearing claw of one left paw, 2 mm back toward the
// paw centre (where the ungual process of the distal phalanx sits).
function toeEnds(match: (p: Vector3) => boolean, centre: Vector3) {
  const parent = Array.from({ length: clawsLeft.position.length / 3 }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let t = 0; t < clawsLeft.index.length; t += 3) {
    parent[find(clawsLeft.index[t + 1])] = find(clawsLeft.index[t]);
    parent[find(clawsLeft.index[t + 2])] = find(clawsLeft.index[t]);
  }
  const groups = new Map<number, Vector3[]>();
  for (let t = 0; t < clawsLeft.index.length; t++) {
    const v = clawsLeft.index[t];
    const list = groups.get(find(v)) ?? [];
    list.push(v3(clawsLeft.position[v * 3], clawsLeft.position[v * 3 + 1], clawsLeft.position[v * 3 + 2]));
    groups.set(find(v), list);
  }
  return [...groups.values()]
    .map((pts) => pts.reduce((a, b) => a.add(b), new Vector3()).divideScalar(pts.length))
    .filter((c) => match(c) && c.y < 0.02)
    .map((c) => {
      const back = centre.clone().sub(c).setY(0).normalize();
      return c.addScaledVector(back, 0.002);
    });
}

// Phalanges of the four weight-bearing digits: the low part of the paw split
// into four groups along x (1D k-means), sorted by x.
function digitGroups(g: Geometry) {
  const pts: Vector3[] = [];
  for (let i = 0; i < g.position.length; i += 3) if (g.position[i + 1] < 0.03) pts.push(v3(g.position[i], g.position[i + 1], g.position[i + 2]));
  const xs = pts.map((p) => p.x).sort((a, b) => a - b);
  const centres = [0.125, 0.375, 0.625, 0.875].map((q) => xs[Math.floor(q * (xs.length - 1))]);
  let groups: Vector3[][] = [];
  for (let it = 0; it < 20; it++) {
    groups = centres.map(() => []);
    for (const p of pts) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (Math.abs(p.x - centres[k]) < Math.abs(p.x - centres[best])) best = k;
      groups[best].push(p);
    }
    groups.forEach((list, k) => (centres[k] = list.reduce((s, p) => s + p.x, 0) / Math.max(1, list.length)));
  }
  return groups;
}

function mean(list: Vector3[]) {
  return list.reduce((a, b) => a.add(b), new Vector3()).divideScalar(list.length);
}

// Tip of each weight-bearing digit (its most cranial 6 mm).
function digitTips(g: Geometry) {
  return digitGroups(g).map((list) => {
    const front = Math.min(...list.map((p) => p.z));
    return mean(list.filter((p) => p.z < front + 0.006));
  });
}

// Warped skin positions, with the tail laid along the caudal vertebrae
// (blended in over its first 4 cm).
function place(warp: (p: Float32Array) => Float32Array<ArrayBuffer>) {
  const out = warp(body.position);
  if (!tailMap) return out;
  for (let i = 0; i < out.length; i += 3) {
    const p = v3(body.position[i], body.position[i + 1], body.position[i + 2]);
    if (!isTail(p)) continue;
    const t = Math.min(1, (p.z - S.tailRoot.z) / 0.04);
    v3(out[i], out[i + 1], out[i + 2]).lerp(tailMap(p), t * t * (3 - 2 * t)).toArray(out, i);
  }
  return out;
}

// One point per `cell`-sized voxel of all the given meshes.
function thin(list: Geometry[], cell: number) {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const g of list)
    for (let i = 0; i < g.position.length; i += 3) {
      const k = `${Math.floor(g.position[i] / cell)},${Math.floor(g.position[i + 1] / cell)},${Math.floor(g.position[i + 2] / cell)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(g.position[i], g.position[i + 1], g.position[i + 2]);
    }
  return new Float32Array(out);
}

// One sculpt vertex per `cell`-sized voxel on the left half, away from the
// tail (and its root) and from the existing landmarks, plus its mirror partner on the right.
function probeVertices(g: Geometry, list: [Vector3, Vector3][], cell: number) {
  const seen = new Set<string>();
  const left: number[] = [];
  for (let v = 0; v < g.position.length / 3; v++) {
    const p = v3(g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2]);
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)},${Math.floor(p.z / cell)}`;
    if (p.x > 0 || seen.has(k) || isTail(p) || p.distanceTo(S.tailRoot) < 0.03 || list.some(([s]) => s.distanceTo(p) < 0.012)) continue;
    seen.add(k);
    left.push(v);
  }
  const near = grid(g.position, 0.01);
  return left.map((v) => [v, near(-g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2], 0.01)] as [number, number]).filter(([, r]) => r >= 0);
}

// Target for each probe pair of the warped skin `g`: the left vertex moved
// out along its normal until every content point in a 12 mm cylinder in
// front of it that is outside the skin, or just under it, ends `clearance`
// inside; the right vertex gets the mirrored target (the larger push wins).
function clearanceNeeded(g: Geometry, points: Float32Array, probeList: [number, number][], clearance: number) {
  const normal = smoothNormals(g.position, g.index);
  const inside = insideTest(g);
  const outside = new Uint8Array(points.length / 3);
  for (let i = 0; i < outside.length; i++) outside[i] = inside(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]) ? 0 : 1;
  const near = cells(points, 0.02);
  const push = (v: number) => {
    const at = v3(g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2]);
    const n = v3(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]);
    let d = 0;
    near(at.x, at.y, at.z, 0.06, (q) => {
      const rel = v3(points[q * 3] - at.x, points[q * 3 + 1] - at.y, points[q * 3 + 2] - at.z);
      const ahead = rel.dot(n);
      if (rel.addScaledVector(n, -ahead).length() > 0.012 || ahead < -clearance) return;
      if (outside[q] || ahead <= 0) d = Math.max(d, ahead + clearance);
    });
    return { at, n, d };
  };
  return probeList.flatMap(([l, r]) => {
    const a = push(l);
    const b = push(r);
    const left = a.at.clone().addScaledVector(a.n, Math.max(a.d, b.d));
    return [left, side(left)];
  });
}

// Volume-preserving (Taubin) smoothing of the selected vertices, to even out
// the lumps the muscle shells leave after inflation.
function taubin(g: Geometry, keep: (v: number) => boolean) {
  const count = g.position.length / 3;
  const neighbours: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let i = 0; i < g.index.length; i += 3)
    for (let k = 0; k < 3; k++) {
      neighbours[g.index[i + k]].add(g.index[i + ((k + 1) % 3)]);
      neighbours[g.index[i + k]].add(g.index[i + ((k + 2) % 3)]);
    }
  const active = Array.from({ length: count }, (_, v) => keep(v));
  for (let it = 0; it < 20; it++) {
    const factor = it % 2 === 0 ? 0.5 : -0.53;
    const next = g.position.slice();
    for (let v = 0; v < count; v++) {
      if (!active[v] || !neighbours[v].size) continue;
      for (let k = 0; k < 3; k++) {
        let sum = 0;
        for (const u of neighbours[v]) sum += g.position[u * 3 + k];
        next[v * 3 + k] += (sum / neighbours[v].size - g.position[v * 3 + k]) * factor;
      }
    }
    g.position.set(next);
  }
}

// Calls `visit` for every point in the voxels within `reach`.
function cells(points: Float32Array, cell: number) {
  const map = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  for (let i = 0; i < points.length; i += 3) {
    const k = key(Math.floor(points[i] / cell), Math.floor(points[i + 1] / cell), Math.floor(points[i + 2] / cell));
    let list = map.get(k);
    if (!list) map.set(k, (list = []));
    list.push(i / 3);
  }
  return (x: number, y: number, z: number, reach: number, visit: (p: number) => void) => {
    const r = Math.ceil(reach / cell);
    const [cx, cy, cz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++)
        for (let k = -r; k <= r; k++) for (const p of map.get(key(cx + i, cy + j, cz + k)) ?? []) visit(p);
  };
}

// Tail vertices of the sculpt: caudal to the root and above the hocks.
function isTail(p: Vector3) {
  return p.z > S.tailRoot.z && p.y > 0.27;
}

// Maps a source tail vertex onto the caudal vertebrae: its distance from the
// root becomes arc length along the chain of vertebral centroids (ending just
// past the last vertebra) and its offset from the tail axis is scaled 1.5x in
// the plane across the chain (sideways 2.1x at the root, where the transverse
// processes are wide), dorsal staying dorsal.
function tailCurve(vertebrae: Geometry[]) {
  const pts = vertebrae.map(centroid);
  const last = vertebrae[vertebrae.length - 1];
  const dir = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
  pts.push(extreme(last, (p) => p.dot(dir)).addScaledVector(dir, 0.006));
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = lengths[lengths.length - 1];
  let sourceLength = 0;
  for (let i = 0; i < body.position.length; i += 3) sourceLength = Math.max(sourceLength, body.position[i + 2] - S.tailRoot.z);
  return (p: Vector3) => {
    const s = Math.min(1, Math.max(0, (p.z - S.tailRoot.z) / sourceLength)) * total;
    let i = 1;
    while (i < pts.length - 1 && lengths[i] < s) i++;
    const f = (s - lengths[i - 1]) / (lengths[i] - lengths[i - 1]);
    const at = pts[i - 1].clone().lerp(pts[i], f);
    // Tangent blended between neighbouring segments to avoid kinks.
    const prev = pts[i].clone().sub(pts[i - 1]).normalize();
    const next = (i + 1 < pts.length ? pts[i + 1].clone().sub(pts[i]) : prev.clone()).normalize();
    const tangent = prev.lerp(next, f).normalize();
    const dorsal = v3(0, tangent.z, -tangent.y).normalize();
    const k = 1.5 + 0.6 * Math.max(0, 1 - s / (0.3 * total)) ** 2;
    return at.add(v3(p.x * k, 0, 0)).addScaledVector(dorsal, (p.y - S.tailRoot.y) * 1.5);
  };
}

// 3D thin-plate spline (kernel r) with affine part and smoothing `lambda`.
function tps(list: [Vector3, Vector3][], lambda: number) {
  const n = list.length;
  const m = n + 4;
  const a = new Float64Array(m * m);
  const b = new Float64Array(m * 3);
  for (let i = 0; i < n; i++) {
    const si = list[i][0];
    for (let j = 0; j < n; j++) a[i * m + j] = i === j ? lambda : si.distanceTo(list[j][0]);
    const row = [1, si.x, si.y, si.z];
    for (let k = 0; k < 4; k++) {
      a[i * m + n + k] = row[k];
      a[(n + k) * m + i] = row[k];
    }
    b[i * 3] = list[i][1].x;
    b[i * 3 + 1] = list[i][1].y;
    b[i * 3 + 2] = list[i][1].z;
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(a[r * m + c]) > Math.abs(a[p * m + c])) p = r;
    if (p !== c) {
      for (let k = 0; k < m; k++) [a[c * m + k], a[p * m + k]] = [a[p * m + k], a[c * m + k]];
      for (let k = 0; k < 3; k++) [b[c * 3 + k], b[p * 3 + k]] = [b[p * 3 + k], b[c * 3 + k]];
    }
    for (let r = c + 1; r < m; r++) {
      const f = a[r * m + c] / a[c * m + c];
      if (f === 0) continue;
      for (let k = c; k < m; k++) a[r * m + k] -= f * a[c * m + k];
      for (let k = 0; k < 3; k++) b[r * 3 + k] -= f * b[c * 3 + k];
    }
  }
  const w = new Float64Array(m * 3);
  for (let r = m - 1; r >= 0; r--) {
    for (let k = 0; k < 3; k++) {
      let s = b[r * 3 + k];
      for (let c = r + 1; c < m; c++) s -= a[r * m + c] * w[c * 3 + k];
      w[r * 3 + k] = s / a[r * m + r];
    }
  }
  const centres = list.map(([s]) => s);
  return (position: Float32Array) => {
    const out = new Float32Array(position.length);
    for (let i = 0; i < position.length; i += 3) {
      const [x, y, z] = [position[i], position[i + 1], position[i + 2]];
      const s = [0, 1, 2].map((k) => w[n * 3 + k] + w[(n + 1) * 3 + k] * x + w[(n + 2) * 3 + k] * y + w[(n + 3) * 3 + k] * z);
      for (let j = 0; j < n; j++) {
        const r = Math.hypot(x - centres[j].x, y - centres[j].y, z - centres[j].z);
        for (let k = 0; k < 3; k++) s[k] += w[j * 3 + k] * r;
      }
      out.set(s, i);
    }
    return out;
  };
}

// Uniform grid over points for nearest-neighbour queries within `reach`.
function grid(points: Float32Array, cell: number) {
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number, k: number) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  for (let i = 0; i < points.length; i += 3) {
    const k = key(Math.floor(points[i] / cell), Math.floor(points[i + 1] / cell), Math.floor(points[i + 2] / cell));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i / 3);
  }
  return (x: number, y: number, z: number, reach: number) => {
    const r = Math.ceil(reach / cell);
    const [cx, cy, cz] = [Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)];
    let best = -1;
    let bestD = reach * reach;
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++)
        for (let k = -r; k <= r; k++) {
          const list = cells.get(key(cx + i, cy + j, cz + k));
          if (!list) continue;
          for (const p of list) {
            const d = (points[p * 3] - x) ** 2 + (points[p * 3 + 1] - y) ** 2 + (points[p * 3 + 2] - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = p;
            }
          }
        }
    return best;
  };
}

// Ray-parity test along +x: true when a point is inside the skin surface.
function insideTest(g: Geometry) {
  const cell = 0.005;
  const cells = new Map<number, number[]>();
  const key = (j: number, k: number) => (j + 1024) * 4096 + (k + 1024);
  const p = g.position;
  for (let t = 0; t < g.index.length; t += 3) {
    const ys = [0, 1, 2].map((k) => p[g.index[t + k] * 3 + 1]);
    const zs = [0, 1, 2].map((k) => p[g.index[t + k] * 3 + 2]);
    for (let j = Math.floor(Math.min(...ys) / cell); j <= Math.floor(Math.max(...ys) / cell); j++)
      for (let k = Math.floor(Math.min(...zs) / cell); k <= Math.floor(Math.max(...zs) / cell); k++) {
        let list = cells.get(key(j, k));
        if (!list) cells.set(key(j, k), (list = []));
        list.push(t);
      }
  }
  return (x: number, y: number, z: number) => {
    let hits = 0;
    for (const t of cells.get(key(Math.floor(y / cell), Math.floor(z / cell))) ?? []) {
      const [a, b, c] = [g.index[t] * 3, g.index[t + 1] * 3, g.index[t + 2] * 3];
      const det = (p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[c + 1] - p[a + 1]) * (p[b + 2] - p[a + 2]);
      if (det === 0) continue;
      const u = ((y - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[c + 1] - p[a + 1]) * (z - p[a + 2])) / det;
      const v = ((p[b + 1] - p[a + 1]) * (z - p[a + 2]) - (y - p[a + 1]) * (p[b + 2] - p[a + 2])) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      if (p[a] + u * (p[b] - p[a]) + v * (p[c] - p[a]) > x) hits++;
    }
    return hits % 2 === 1;
  };
}

// Moves skin vertices until every bone vertex sits at least `clearance`
// inside the surface (or inside a claw, per `covered`): bones outside pull
// their nearest skin vertex past them, bones just under the surface push it
// out along its normal. The push is
// spread over neighbouring vertices so the surface stays smooth. Returns the
// total displacement per vertex.
function pushOut(g: Geometry, boneGeoms: Geometry[], clearance: number, covered: (x: number, y: number, z: number) => boolean) {
  const bonePts = new Float32Array(boneGeoms.reduce((n, b) => n + b.position.length, 0));
  let o = 0;
  for (const b of boneGeoms) {
    bonePts.set(b.position, o);
    o += b.position.length;
  }
  const count = g.position.length / 3;
  const neighbours: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let i = 0; i < g.index.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      neighbours[g.index[i + k]].add(g.index[i + ((k + 1) % 3)]);
      neighbours[g.index[i + k]].add(g.index[i + ((k + 2) % 3)]);
    }
  }
  const p = g.position;
  const total = new Float32Array(p.length);
  // After the first pass, steps are capped at 3 mm so neighbouring surfaces
  // (toes, folds) do not jump through each other; the best pass is kept.
  let best = { outside: Infinity, position: p.slice(), total: total.slice() };
  for (let pass = 0; pass < 20; pass++) {
    const normal = smoothNormals(p, g.index);
    const inside = insideTest(g);
    const nearSkin = grid(p, 0.01);
    const need = new Float32Array(p.length);
    const needLen = new Float32Array(count);
    let outside = 0;
    for (let b = 0; b < bonePts.length; b += 3) {
      const [x, y, z] = [bonePts[b], bonePts[b + 1], bonePts[b + 2]];
      if (covered(x, y, z)) continue;
      const isIn = inside(x, y, z);
      const v = nearSkin(x, y, z, isIn ? 0.02 : 0.05);
      if (v < 0) continue;
      const n = [normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]];
      const rel = [x - p[v * 3], y - p[v * 3 + 1], z - p[v * 3 + 2]];
      let push: number[];
      if (isIn) {
        const d = -(rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2]);
        // d < 0: the nearest skin faces away from this bone (a fold), skip.
        if (d < 0 || d >= clearance) continue;
        push = n.map((c) => c * (clearance - d));
      } else {
        outside++;
        push = rel.map((c, k) => c + n[k] * clearance);
      }
      const len = Math.hypot(...push);
      if (len > needLen[v]) {
        needLen[v] = len;
        need.set(push, v * 3);
      }
    }
    if (outside < best.outside) best = { outside, position: p.slice(), total: total.slice() };
    if (outside === 0) break;
    let push = need.slice();
    for (let it = 0; it < 60; it++) {
      const next = new Float32Array(p.length);
      for (let v = 0; v < count; v++) {
        const size = neighbours[v].size;
        for (let k = 0; k < 3; k++) {
          let s = 0;
          for (const u of neighbours[v]) s += push[u * 3 + k];
          next[v * 3 + k] = size ? (s / size + push[v * 3 + k]) / 2 : push[v * 3 + k];
        }
        if (needLen[v] > Math.hypot(next[v * 3], next[v * 3 + 1], next[v * 3 + 2])) next.set(need.subarray(v * 3, v * 3 + 3), v * 3);
      }
      push = next;
    }
    let moved = 0;
    for (let i = 0; i < p.length; i += 3) {
      const len = Math.hypot(push[i], push[i + 1], push[i + 2]);
      if (pass > 0 && len > 0.003) for (let k = 0; k < 3; k++) push[i + k] *= 0.003 / len;
      moved = Math.max(moved, Math.min(len, pass > 0 ? 0.003 : len));
      for (let k = 0; k < 3; k++) {
        p[i + k] += push[i + k];
        total[i + k] += push[i + k];
      }
    }
    console.log(`push-out pass ${pass}: ${outside} bone vertices outside, max move ${(moved * 1000).toFixed(1)} mm`);
  }
  p.set(best.position);
  console.log(`push-out: kept the pass with ${best.outside} bone vertices outside`);
  return best.total;
}

// Moves each claw vertex by the push applied to the nearest skin vertex.
// The eyelid opening of the left eye: the skin's boundary loop next to the
// sculpt's globe. Returns where a globe of radius r sits so that its section
// in the plane of the lids is a little wider than the opening.
function seat(g: Geometry, near: Vector3, r: number) {
  // Vertices are split along UV seams: count edges by welded position.
  const ids = new Map<string, number>();
  const weld = Array.from({ length: g.position.length / 3 }, (_, v) => {
    const key = [0, 1, 2].map((k) => Math.round(g.position[v * 3 + k] * 1e5)).join(",");
    if (!ids.has(key)) ids.set(key, v);
    return ids.get(key)!;
  });
  const edges = new Map<string, number>();
  const I = g.index;
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = weld[I[t + e]];
      const b = weld[I[t + ((e + 1) % 3)]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const rim = new Set<number>();
  for (const [key, n] of edges) if (n === 1) for (const v of key.split(",")) rim.add(+v);
  const pts = [...rim].map((v) => v3(g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2])).filter((p) => p.distanceTo(near) < 0.03);
  const m = mean(pts);
  // Normal of the opening: the axis of least spread of the rim.
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const d = p.clone().sub(m).toArray();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i * 3 + j] += d[i] * d[j];
  }
  let axis = v3(1, 0, 0);
  // Inverse power iteration on the covariance (shifted) for its smallest axis.
  const big = c[0] + c[4] + c[8];
  const shifted = c.map((v, i) => (i % 4 === 0 ? big - v : -v));
  for (let k = 0; k < 50; k++) {
    const a = axis.toArray();
    axis = v3(shifted[0] * a[0] + shifted[1] * a[1] + shifted[2] * a[2], shifted[3] * a[0] + shifted[4] * a[1] + shifted[5] * a[2], shifted[6] * a[0] + shifted[7] * a[1] + shifted[8] * a[2]).normalize();
  }
  if (axis.x > 0) axis.negate(); // the left eye looks left (-X)
  const rho = mean(pts.map((p) => v3(p.distanceTo(m), 0, 0))).x;
  const section = Math.min(r * 0.97, rho * 1.15);
  const depth = Math.sqrt(r * r - section * section);
  console.log(`eye opening: ${(rho * 2000).toFixed(1)} mm across, globe ${(r * 2000).toFixed(0)} mm, ${((r - depth) * 1000).toFixed(1)} mm proud of the lids`);
  return { centre: m.clone().addScaledVector(axis, -depth), axis };
}

// UV sphere with its poles on the visual axis, so pupil and iris edges fall on
// rings of vertices.
function globe(centre: Vector3, r: number, axis: Vector3): Geometry {
  const rings = 30;
  const segments = 32;
  const q = new Quaternion().setFromUnitVectors(v3(0, 0, 1), axis);
  const position: number[] = [];
  const index: number[] = [];
  // Denser near the front pole: the polar angle grows with the square of the ring.
  for (let i = 0; i <= rings; i++) {
    const theta = Math.PI * Math.pow(i / rings, 1.4);
    for (let j = 0; j < segments; j++) {
      const phi = (2 * Math.PI * j) / segments;
      const p = v3(Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)).multiplyScalar(r).applyQuaternion(q).add(centre);
      position.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      index.push(a, a + segments, b, b, a + segments, b + segments);
    }
  return { position: new Float32Array(position), index: new Uint32Array(index) };
}

// Multiplies the baked occlusion of both eyes by pupil, iris and sclera
// colours (relative to the eyes' material colour, #EDE6DC in meta.json).
async function paintEyes(file: string, centre: Vector3, axis: Vector3) {
  const doc = await io.read(file);
  const sclera = [1, 1, 1];
  const iris = [0.45, 0.29, 0.16];
  const pupil = [0.04, 0.035, 0.03];
  const step = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  for (const node of doc.getRoot().listNodes()) {
    const right = node.getName() === meshKey("dog.integumentary.eyes.R");
    if (!right && node.getName() !== meshKey("dog.integumentary.eyes.L")) continue;
    const c = right ? side(centre) : centre;
    const dir = right ? side(axis) : axis;
    const world = new Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of node.getMesh()!.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!;
      const col = prim.getAttribute("COLOR_0")!;
      const p: number[] = [];
      const ao: number[] = [];
      for (let v = 0; v < pos.getCount(); v++) {
        const w = v3(...(pos.getElement(v, p) as [number, number, number])).applyMatrix4(world);
        const angle = w.sub(c).angleTo(dir);
        // Pupil to 17 degrees, iris to 48 (the cornea's edge), soft limbus.
        const t1 = step(0.27, 0.32, angle);
        const t2 = step(0.8, 0.88, angle);
        const tint = [0, 1, 2].map((k) => pupil[k] + (iris[k] - pupil[k]) * t1 + (sclera[k] - iris[k]) * t2);
        col.getElement(v, ao);
        col.setElement(v, [0, 1, 2].map((k) => ao[k] * tint[k]));
      }
    }
  }
  await io.write(file, doc);
}

function carry(g: Geometry, skinPos: Float32Array, push: Float32Array) {
  const near = grid(skinPos, 0.01);
  for (let i = 0; i < g.position.length; i += 3) {
    const v = near(g.position[i], g.position[i + 1], g.position[i + 2], 0.05);
    if (v < 0) continue;
    for (let k = 0; k < 3; k++) g.position[i + k] += push[v * 3 + k];
  }
}
