/**
 * Builds public/models/cat/integumentary.glb (skin, claws and eyes) from
 * "Cat Model" by Lova Dahn (Sketchfab, CC BY 4.0), an anatomically sculpted
 * hairless cat base mesh. Its body, claw and eyeball (globe and cornea)
 * meshes are used; eyelids, lacrimal glands, mouth, teeth and tongue are not.
 *
 * The sculpt has other proportions and another pose than our skeleton (it
 * stands with the head up; the skeleton stalks with the head low and flexed
 * and the tail hanging), so it is registered onto
 * public/models/cat/skeletal.glb:
 *   1. a thin-plate-spline warp moves landmarks picked on the sculpt (joint
 *      centres, head, dorsal and ventral midline) onto the same landmarks
 *      measured on the bones, so it follows the skeleton when that changes.
 *      The head moves as one piece fitted to the skull (nose, orbits,
 *      occiput, chin), grown and widened until it holds the skull dorsum,
 *      masseter and temporalis; rings of skin across the forearm, crus,
 *      carpus, hock and metapodia are set 3-4 mm past the bones and tendons
 *      there;
 *   2. the tail is laid along the caudal vertebrae;
 *   3. the warp is re-solved with extra landmarks that move probe vertices
 *      out past the bones and, when public/models/cat/muscular.glb exists,
 *      the muscles (3 mm clearance), then Taubin-smoothed;
 *   4. a final push-out moves the surface (head excluded) past the bones and
 *      muscles still outside, spread smoothly over the mesh;
 *   5. everything below the floor is clamped to y = 0;
 *   6. the widened head carries the globes out against the orbital
 *      ligament: each moves the least it needs to clear the orbit by its
 *      radius, and the eyelids follow (blended over 2 cm). The eyes get a
 *      slit pupil, amber iris and sclera as vertex colours over the baked
 *      occlusion.
 *
 * Source frame: arbitrary units (about 1.7x life size), Y up, floor at y=0,
 * animal faces +Z, left side +X. Output: atlas frame (metres, faces -Z,
 * left -X). The skin is one mesh; claws and eyes are split by side and the
 * right side is a mirrored copy of the left.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";
import { bake, createModel, download, io, merge, mirror, pca, points, readAtlas, readPrims, smoothNormals, type Geometry } from "./lib/glb";

const OUT = path.join(process.cwd(), "public", "models", "cat", "integumentary.glb");
const SKELETON = path.join(process.cwd(), "public", "models", "cat", "skeletal.glb");
const MUSCULAR = path.join(process.cwd(), "public", "models", "cat", "muscular.glb");
const source = { uid: "f79fccece2d2403586ac7407c4fe582b", file: "lovadahn-cat-model.glb" };

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const side = (p: Vector3) => p.clone().setX(-p.x);

// ---------------------------------------------------------------- source

const file = await download(source);
const flip = new Matrix4().makeRotationY(Math.PI);
// The body is split in two primitives (16-bit indices); welded back into one surface.
const body = weld(bake(await readPrims(file, (n) => n === "Object_4" || n === "Object_5"), flip));
const clawsLeft = keepSide(bake(await readPrims(file, (n) => n === "Object_7"), flip));
// Eyeball (globe) and Pupil (cornea and iris); the cornea alone gives the
// direction of gaze for the iris colours.
const eyesLeft = keepSide(bake(await readPrims(file, (n) => n === "Object_9" || n === "Object_17"), flip));
const corneaLeft = bake(await readPrims(file, (n) => n === "Object_17"), flip);

// Landmarks on the sculpt after the flip (left side, x < 0), read off
// cross-sections of the mesh. Joint centres are inside the limb.
const S = {
  shoulder: v3(-0.058, 0.31, -0.258),
  elbow: v3(-0.064, 0.232, -0.192),
  olecranon: v3(-0.062, 0.24, -0.158),
  carpus: v3(-0.048, 0.062, -0.2),
  forePaw: v3(-0.054, 0, -0.228),
  scapulaTop: v3(-0.03, 0.45, -0.215),
  hip: v3(-0.058, 0.35, 0.225),
  stifle: v3(-0.058, 0.237, 0.172),
  hock: v3(-0.046, 0.12, 0.293),
  calcaneus: v3(-0.046, 0.135, 0.321),
  plantar: v3(-0.053, 0.06, 0.296),
  hindPaw: v3(-0.064, 0, 0.238),
  ischium: v3(-0.028, 0.36, 0.28),
  // Midline skin points (y measured on the mesh below) and the eyeball centre.
  nose: extreme(body, (p) => -p.z),
  eye: mean(points(eyesLeft).filter((p) => p.x < 0)),
  occiput: v3(0, 0, -0.36),
  chin: v3(0, 0, -0.462),
  withers: v3(0, 0, -0.22),
  back: v3(0, 0, -0.02),
  croup: v3(0, 0, 0.12),
  throat: v3(0, 0, -0.35),
  presternum: v3(0, 0, -0.262),
  belly: v3(0, 0, 0.08),
  tailRoot: v3(0, 0.418, 0.31),
};
for (const k of ["occiput", "withers", "back", "croup"] as const) S[k].setY(dorsalY(body, S[k].z));
for (const k of ["chin", "throat", "presternum", "belly"] as const) S[k].setY(ventralY(body, S[k].z));

// ---------------------------------------------------------------- skeleton

const bones = await readAtlas(SKELETON);
const bone = (name: string) => {
  const g = bones.get(`cat_skeletal_${name}`);
  if (!g) throw new Error(`skeleton has no mesh cat_skeletal_${name}`);
  return g;
};

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
const scapula = bone("scapula_L");
const femur = bone("femur_L");
const tibia = bone("tibia_L");
const coxae = bone("os-coxae_L");
const skull = bone("skull");
const mandible = bone("mandible");
const hyoid = bone("hyoid");
const manubrium = bone("sternum_s1");
const sacrum = bone("sacrum");

const T = {
  shoulder: end(humerus, 1, true).add(v3(0, -0.005, 0)),
  elbow: end(humerus, 1, false),
  carpus: centroid(bone("carpus_L")),
  forePaw: centroid(bone("phalanges-thoracic_L")).setY(0),
  scapulaTop: end(scapula, 1, true),
  hip: end(femur, 1, true).add(v3(0, -0.005, 0)),
  stifle: end(femur, 1, false).add(end(tibia, 1, true)).multiplyScalar(0.5),
  hock: end(tibia, 1, false).add(v3(0, -0.005, 0)),
  hindPaw: centroid(bone("phalanges-pelvic_L")).add(v3(0, 0, -0.005)).setY(0),
  ischium: end(coxae, 2, true),
};

// Head: frame from the rostral tip of the incisive bone (N) to the external
// occipital protuberance (O), along the skull's long axis (the head is
// flexed, so not along z).
const skullPts = points(skull, 20000);
const long = pca(skullPts).axes[0];
const rostral = long.clone().multiplyScalar(long.z < 0 ? 1 : -1).setX(0).normalize();
const skullUp = v3(0, -rostral.z, rostral.y);
const skullN = extreme(skull, (p) => p.dot(rostral));
const skullO = extreme(skull, (p) => p.dot(skullUp) - p.dot(rostral));
const headAxis = skullO.clone().sub(skullN);
const headLen = headAxis.length();
headAxis.normalize();
const headUp = headAxis.clone().cross(new Vector3(1, 0, 0)).normalize();
const head = (along: number, up: number, lateral = 0) =>
  skullN.clone().addScaledVector(headAxis, along * headLen).addScaledVector(headUp, up).add(v3(lateral, 0, 0));
// Chin: the most rostroventral point of the mandible (the ventral border
// turning up to the incisors), 3 mm out.
const chinDir = headUp.clone().add(headAxis).multiplyScalar(-1).normalize();
const chinBone = extreme(mandible, (p) => p.dot(chinDir)).addScaledVector(chinDir, 0.003).setX(0);
const arch = extreme(skull, (p) => -p.x);
const larynx = extreme(hyoid, (p) => -p.y);

// Eye centre: in the orbit, a third of the way from N to O, level with the
// top of the zygomatic arch and 17.5 mm off the median plane (the globe is
// about 21 mm across).
const eyeL = head(0.32, 0.015, -0.0175);
const headPairs: [Vector3, Vector3][] = [
  [S.nose, head(-0.045, 0.01)],
  [S.eye, eyeL],
  [side(S.eye), side(eyeL)],
  [S.occiput, head(1, 0.004).addScaledVector(headAxis, 0.003)],
  [S.chin, chinBone],
];
// Widen or narrow the head until the cheek clears the zygomatic arch by 4 mm.
const headMap = similarity(headPairs);

const cheek = extreme(body, (p) => (p.z > -0.43 && p.z < -0.38 && p.y > 0.42 && p.y < 0.47 ? -p.x : -Infinity));
const cheekT = cheek.clone().applyMatrix4(headMap);
headMap.premultiply(new Matrix4().makeScale((arch.x - 0.004) / cheekT.x, 1, 1));
console.log(`head: scale ${Math.cbrt(headMap.determinant()).toFixed(3)}, cheek ${(cheekT.x * 1000).toFixed(1)} mm -> arch ${(arch.x * 1000).toFixed(1)} mm`);

// Everything the skin has to contain: the bones (minus skull, mandible and
// hyoid, whose teeth sit in the mouth; the head is placed on the skull as a
// whole) and, when built, the muscles. The tail is placed on its vertebrae
// directly, so they stay out of the probes.
const muscleMap = existsSync(MUSCULAR) ? await readAtlas(MUSCULAR) : new Map<string, Geometry>();
const muscles = [...muscleMap.values()];
const boneContents = [...bones].filter(([name]) => !/skull|mandible|hyoid/.test(name));
const contents = [...boneContents.map(([, g]) => g), ...muscles];
const inner = thin([...boneContents.filter(([name]) => !name.includes("caudal")).map(([, g]) => g), ...muscles], 0.002);
// Highest content point near the midline at one z (for the dorsal line).
const topAt = (z: number) => {
  let top = -Infinity;
  for (let i = 0; i < inner.length; i += 3) if (Math.abs(inner[i + 2] - z) < 0.006 && Math.abs(inner[i]) < 0.02) top = Math.max(top, inner[i + 1]);
  return top;
};

// Grow the head about the point between the eyes, and widen it, until the
// masseter, temporalis and the cranial and nasal dorsum are inside it:
// tested on the sculpt, mapped back (some stay out, in the ear canals and
// round the eyelids): the smallest growth with about the fewest out.
{
  const inSculpt = insideTest(body);
  const headPts: Vector3[] = [];
  for (const [name, g] of muscleMap) if (/masseter|temporalis/.test(name)) headPts.push(...points(g));
  const upOf = (p: Vector3) => p.clone().sub(skullN).dot(headUp);
  const farFromEyes = (p: Vector3) => Math.min(p.distanceTo(eyeL), p.distanceTo(side(eyeL))) > 0.015;
  headPts.push(...points(skull).filter((p) => upOf(p) > 0.004 && farFromEyes(p)));
  const test = headPts.filter((_, i) => i % Math.max(1, Math.floor(headPts.length / 2000)) === 0);
  const centre = mean(skullPts).setX(0);
  const grown = (g: number, wide: number) =>
    new Matrix4().makeTranslation(centre.x, centre.y, centre.z).multiply(new Matrix4().makeScale(g * wide, g, g)).multiply(new Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z)).multiply(headMap);
  const tried: { out: number; g: number; wide: number }[] = [];
  for (let g = 1; g <= 1.1001; g += 0.01)
    for (let wide = 1; wide <= 1.2001; wide += 0.02) {
      const inv = grown(g, wide).invert();
      const out = test.filter((p) => {
        const q = p.clone().applyMatrix4(inv);
        return !inSculpt(q.x, q.y, q.z);
      }).length;
      tried.push({ out, g, wide });
    }
  const least = Math.min(...tried.map((t) => t.out));
  const best = tried.filter((t) => t.out <= least + 3).sort((a, b) => a.g * a.g * a.wide - b.g * b.g * b.wide)[0];
  headMap.copy(grown(best.g, best.wide));
  console.log(`head grown ${best.g.toFixed(2)}x, widened ${best.wide.toFixed(2)}x: ${best.out} of ${test.length} skull and muscle points out`);
}

// Dorsal midline skin from occiput to withers (quadratic curve, arched neck).
const withersT = v3(0, Math.max(T.scapulaTop.y + 0.008, topAt(T.scapulaTop.z) + 0.004), T.scapulaTop.z);
const occT = S.occiput.clone().applyMatrix4(headMap);
const neckCtrl = v3(0, occT.y * 0.4 + withersT.y * 0.6, (occT.z + withersT.z) / 2 - 0.01);
const neckDorsal = (t: number) => {
  const p = occT.clone().multiplyScalar((1 - t) ** 2).addScaledVector(neckCtrl, 2 * t * (1 - t)).addScaledVector(withersT, t * t);
  return p.setY(Math.max(p.y, topAt(p.z) + 0.004));
};

const presternumT = end(manubrium, 2, false).add(v3(0, -0.004, -0.008)).setX(0);
const throatT = larynx.clone().add(v3(0, -0.008, 0)).setX(0);
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
const limbScale = T.shoulder.distanceTo(T.hip) / S.shoulder.distanceTo(S.hip);
for (const chain of [fore, hind]) {
  // The paw keeps its shape at limbScale, turned to point where the digits
  // point and as wide as their spread; its centre is set back from the digit
  // tips so the claws sit over the distal phalanges.
  const paw = chain[3];
  const phalanges = bone(paw === "forePaw" ? "phalanges-thoracic_L" : "phalanges-pelvic_L");
  const toes = toeEnds(paw === "forePaw" ? (p) => p.z < 0 : (p) => p.z > 0, S[paw]);
  const tips = digitTips(phalanges);
  const pawVerts = sample(body, (p) => p.x < 0 && p.y < 0.035 && p.distanceTo(S[paw]) < 0.05, 100000);
  // Forward and lateral axes of the paw in both frames; the width follows
  // the spread of the digits plus 4 mm of skin and pad on each side.
  const fs = mean(toes).sub(S[paw]).setY(0).normalize();
  const ft = mean(tips).sub(T[paw]).setY(0).normalize();
  const ls = v3(fs.z, 0, -fs.x);
  const lt = v3(ft.z, 0, -ft.x);
  const span = (list: Vector3[], axis: Vector3) => Math.max(...list.map((p) => p.dot(axis))) - Math.min(...list.map((p) => p.dot(axis)));
  const lateralScale = (span(digitGroups(phalanges).flat(), lt) + 0.008) / span(pawVerts, ls);
  const reach = (list: Vector3[], from: Vector3, axis: Vector3) => Math.max(...list.map((p) => p.clone().sub(from).dot(axis)));
  T[paw].addScaledVector(ft, reach(tips, T[paw], ft) + 0.002 - reach(toes, S[paw], fs) * limbScale);
  console.log(`${paw}: ${toes.length} claws, ${tips.length} digits, scale ${limbScale.toFixed(2)}, lateral ${lateralScale.toFixed(2)}`);
  const map = (p: Vector3) => {
    const d = p.clone().sub(S[paw]);
    return T[paw].clone().addScaledVector(ft, d.dot(fs) * limbScale).addScaledVector(lt, d.dot(ls) * lateralScale).add(v3(0, d.y * limbScale, 0));
  };
  for (const s of sample(body, (p) => p.x < 0 && p.y < 0.035 && p.distanceTo(S[paw]) < 0.05, 16)) add(s, map(s), true);

  for (const j of chain) add(S[j], T[j], true);
  for (let i = 0; i < chain.length - 1; i++) {
    const [a, b] = [chain[i], chain[i + 1]];
    if (i === 0) add(S[a].clone().lerp(S[b], 0.5), T[a].clone().lerp(T[b], 0.5), true);
    else {
      // Rings across the forearm or crus and the metapodium.
      const axisS = S[a].clone().sub(S[b]).normalize();
      const axisT = T[a].clone().sub(T[b]).normalize();
      for (const f of i === 1 ? [0.25, 0.5, 0.75] : [0.4]) for (const [s, t] of jointRing(S[a].clone().lerp(S[b], f), T[a].clone().lerp(T[b], f), axisS, axisT)) add(s, t, true);
    }
  }
}
add(S.olecranon, end(bone("ulna_L"), 1, true), true);
// Carpus and hock: rings of skin around and above the joint, each vertex as far out as
// the limb scale puts it or 3 mm past the bones and tendons in its direction.
for (const [j, prev, next] of [["carpus", "elbow", "forePaw"], ["hock", "stifle", "hindPaw"]] as const) {
  const axisS = S[prev].clone().sub(S[j]).normalize().add(S[j].clone().sub(S[next]).normalize()).normalize();
  const axisT = T[prev].clone().sub(T[j]).normalize().add(T[j].clone().sub(T[next]).normalize()).normalize();
  for (const offset of [-0.012, 0, 0.012, 0.024]) for (const [s, t] of jointRing(S[j].clone().addScaledVector(axisS, offset), T[j].clone().addScaledVector(axisT, offset * limbScale), axisS, axisT)) add(s, t, true);
}
add(S.ischium, T.ischium.clone().add(v3(0, 0, 0.003)), true);
// Point of the hock: 3 mm behind the tuber calcanei.
{
  const near = (c: Vector3, r: number) => {
    const out: Vector3[] = [];
    for (let i = 0; i < inner.length; i += 3) if (Math.abs(inner[i + 2] - c.z) < r && Math.abs(inner[i + 1] - c.y) < r && Math.abs(inner[i] - c.x) < r) out.push(v3(inner[i], inner[i + 1], inner[i + 2]));
    return out;
  };
  const tuber = extreme(bone("tarsus_L"), (p) => p.z);
  add(S.calcaneus, tuber.clone().setZ(Math.max(...near(tuber, 0.01).map((p) => p.z)) + 0.004), true);
  // Plantar surface of the metatarsus, 3 mm outside the bones and tendons there.
  const mt = bone("metatarsus_L");
  const [top, bottom] = [end(mt, 1, true), end(mt, 1, false)];
  const mid = top.clone().lerp(bottom, 0.5);
  const plantar = top.clone().sub(bottom).normalize().cross(v3(1, 0, 0)).normalize();
  if (plantar.z < 0) plantar.negate();
  const depth = Math.max(...near(mid, 0.008).map((p) => p.clone().sub(mid).dot(plantar)));
  add(S.plantar, mid.clone().addScaledVector(plantar, depth + 0.003), true);
}

// Head as one rigid piece (ears included).
for (const s of sample(body, isHead, 60)) add(s, s.clone().applyMatrix4(headMap));

// Dorsal midline.
for (const t of [0.25, 0.5, 0.75]) add(S.occiput.clone().lerp(S.withers, t).setY(dorsalY(body, S.occiput.z + (S.withers.z - S.occiput.z) * t)), neckDorsal(t));
add(S.withers, withersT);
const l1 = centroid(bone("vertebrae-lumbar_l1"));
add(S.back, v3(0, Math.max(end(bone("vertebrae-lumbar_l1"), 1, true).y + 0.006, topAt(l1.z) + 0.004), l1.z));
add(S.croup, v3(0, Math.max(sacrumTop.y + 0.008, end(coxae, 1, true).y + 0.008, topAt(sacrumTop.z) + 0.004), sacrumTop.z));

// Ventral midline: throat under the larynx, point of the chest in front of
// the manubrium, chest floor under the sternum.
add(S.throat, throatT);
add(S.throat.clone().lerp(S.presternum, 0.5).setY(ventralY(body, (S.throat.z + S.presternum.z) / 2)), throatT.clone().lerp(presternumT, 0.5).add(v3(0, -0.004, -0.006)));
add(S.presternum, presternumT);
// Chest floor 8 mm under the sternebrae, each at the matching distance behind
// the point of the chest on the sculpt.
for (const n of [2, 4, 6, 8]) {
  const sb = bone(`sternum_s${n}`);
  const z = S.presternum.z + (centroid(sb).z - presternumT.z) / limbScale;
  add(v3(0, ventralY(body, z), z), v3(0, end(sb, 1, false).y - 0.008, centroid(sb).z));
}

// Belly and flanks follow an axis-aligned scaling fitted to the trunk pairs.
const trunk = affine(pairs.filter(([s]) => s.z > -0.26 && s.z < 0.29));
add(S.belly, S.belly.clone().applyMatrix4(trunk));
// Flanks: 12 mm of body wall outside the widest rib at that level.
const ribs = merge([...bones].filter(([name]) => /^cat_skeletal_ribs_\d+_L$/.test(name)).map(([, g]) => g));
for (const z of [-0.07, -0.035, 0]) {
  const rib = extreme(ribs, (p) => (Math.abs(p.z - z) < 0.008 ? -p.x : -Infinity));
  if (!Number.isFinite(rib.x) || Math.abs(rib.z - z) > 0.008) continue;
  const s = lateral(body, (z - trunk.elements[14]) / trunk.elements[10]);
  add(s, v3(rib.x - 0.012, s.clone().applyMatrix4(trunk).y, z), true);
}
// Point of the shoulder and greater trochanter: 8 mm of skin and fascia.
const humerusLat = extreme(humerus, (p) => (p.y > T.shoulder.y - 0.02 ? -p.x : -Infinity));
add(extreme(body, (p) => (p.z > -0.29 && p.z < -0.24 && p.y > 0.29 && p.y < 0.33 ? -p.x : -Infinity)), humerusLat.clone().add(v3(-0.008, 0, 0)), true);
const femurLat = extreme(femur, (p) => (p.y > T.hip.y - 0.02 ? -p.x : -Infinity));
add(extreme(body, (p) => (p.z > 0.2 && p.z < 0.25 && p.y > 0.33 && p.y < 0.37 ? -p.x : -Infinity)), femurLat.clone().add(v3(-0.008, 0, 0)), true);

// Tail: follows the caudal vertebrae. Source tail vertices are placed along
// the Cd chain by arc length (see tailMap); the stretch near the root also
// goes into the warp so the croup blends into it.
const caudal = [...bones]
  .filter(([name]) => /^cat_skeletal_vertebrae-caudal_cd\d+$/.test(name))
  .sort(([a], [b]) => Number(a.split("_cd")[1]) - Number(b.split("_cd")[1]))
  .map(([, g]) => g);
const tailMap = tailCurve(caudal, Math.cbrt(Math.abs(trunk.determinant())));
for (const s of sample(body, (p) => isTail(p) && p.z - S.tailRoot.z < 0.08, 24)) add(s, tailMap(s));

// ---------------------------------------------------------------- warp

// Inflation: probe vertices spread over the sculpt are moved out along their
// normals past any contents in front of them and added as landmarks, so the
// warp itself grows the surface smoothly. Five rounds.
const probes = probeVertices(body, pairs, 0.03);
console.log(`${pairs.length} landmarks, ${probes.length} probe pairs`);
let warp = tps(pairs, 1e-4);
for (let round = 0; round < 5; round++) {
  const targets = clearanceNeeded({ position: place(warp), index: body.index }, inner, probes, 0.003);
  const at = (v: number) => v3(body.position[v * 3], body.position[v * 3 + 1], body.position[v * 3 + 2]);
  warp = tps([...pairs, ...probes.flatMap(([l, r], i): [Vector3, Vector3][] => [[at(l), targets[2 * i]], [at(r), targets[2 * i + 1]]])], 1e-4);
}

const skin: Geometry = { position: place(warp), index: body.index };
taubin(skin, (v) => {
  const p = v3(body.position[v * 3], body.position[v * 3 + 1], body.position[v * 3 + 2]);
  return !isHead(p) && p.y > 0.04 && !isTail(p);
});
const claws: Geometry = { position: warp(clawsLeft.position), index: clawsLeft.index };
const eyes: Geometry = { position: eyesLeft.position.slice(), index: eyesLeft.index };
for (let i = 0; i < eyes.position.length; i += 3) v3(eyes.position[i], eyes.position[i + 1], eyes.position[i + 2]).applyMatrix4(headMap).toArray(eyes.position, i);
// The head is widened to clear the zygomatic arch, which carries the globes
// out against the orbital ligament: each globe moves the least it needs to
// clear the bone of the orbit by its radius, and the eyelids go with it.
const eyeAt = S.eye.clone().applyMatrix4(headMap);
const eyeAxis = mean(points(corneaLeft).filter((p) => p.x < 0)).applyMatrix4(headMap).sub(eyeAt).normalize();
const globe = points(eyesLeft).filter((p) => p.x < 0).map((p) => p.distanceTo(S.eye)).sort((x, y) => x - y);
const eyeRadius = globe[Math.floor(globe.length / 2)] * Math.cbrt(Math.abs(headMap.determinant()));
const orbit = points(skull).filter((p) => p.distanceTo(eyeAt) < 0.03);
const clear = (q: Vector3) => orbit.every((p) => p.distanceToSquared(q) >= (eyeRadius * 0.95) ** 2);
const shifts: Vector3[] = [];
for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) for (let z = -12; z <= 12; z++) shifts.push(v3(x, y, z).multiplyScalar(0.0005));
shifts.sort((p, q) => p.length() - q.length());
const eyeShift = shifts.find((d) => clear(eyeAt.clone().add(d))) ?? v3(0, 0, 0);
console.log(`eyes: moved ${(eyeShift.length() * 1000).toFixed(1)} mm into the orbit`);
for (let i = 0; i < eyes.position.length; i += 3) v3(eyes.position[i], eyes.position[i + 1], eyes.position[i + 2]).add(eyeShift).toArray(eyes.position, i);
const warped = skin.position.slice();
// Bone inside a claw (the ungual processes) is covered by integument too.
const inClaw = insideTest(merge([claws, mirror(claws)]));
// The head is placed on the skull as a whole and stays as it is.
const pushed = pushOut(skin, contents, 0.002, inClaw, (v) => isHead(v3(body.position[v * 3], body.position[v * 3 + 1], body.position[v * 3 + 2])));
carry(claws, warped, pushed);
for (const g of [skin, claws]) for (let i = 1; i < g.position.length; i += 3) g.position[i] = Math.max(0, g.position[i]);
for (let i = 0; i < skin.position.length; i += 3) {
  const p = v3(skin.position[i], skin.position[i + 1], skin.position[i + 2]);
  const own = p.x < 0 ? eyeAt : side(eyeAt);
  const w = Math.max(0, 1 - p.distanceTo(own) / 0.02);
  p.addScaledVector(p.x < 0 ? eyeShift : side(eyeShift), w * w * (3 - 2 * w)).toArray(skin.position, i);
}

const model = createModel("cat.integumentary", [0.85, 0.71, 0.61, 1]);
model.add(meshKey("cat.integumentary.skin"), skin, 160000);
model.add(meshKey("cat.integumentary.claws.L"), claws, 3000);
model.add(meshKey("cat.integumentary.claws.R"), mirror(claws), 3000);
// Split twice so the pupil and iris colours have vertices to sit on.
const fineEyes = subdivide(subdivide(eyes));
model.add(meshKey("cat.integumentary.eyes.L"), fineEyes);
model.add(meshKey("cat.integumentary.eyes.R"), mirror(fineEyes));
await model.write(OUT);

// Eyes: a vertical slit pupil, an amber iris with a darker limbal ring and
// pale sclera round it, as vertex colours over the baked occlusion (the
// structure colour is near white so they show).
{
  const doc = await io.read(OUT);
  const lin = (r: number, g: number, b: number) => [r, g, b].map((c) => c ** 2.2);
  const pupil = lin(0.03, 0.025, 0.02);
  const iris = lin(0.8, 0.64, 0.22);
  const limbus = lin(0.42, 0.34, 0.12);
  const sclera = lin(0.88, 0.84, 0.76);
  const centre = eyeAt.clone().add(eyeShift);
  for (const node of doc.getRoot().listNodes()) {
    const right = node.getName() === meshKey("cat.integumentary.eyes.R");
    if (!right && node.getName() !== meshKey("cat.integumentary.eyes.L")) continue;
    const prim = node.getMesh()!.listPrimitives()[0];
    const g = bake([{ prim, world: new Matrix4().fromArray(node.getWorldMatrix()) }], new Matrix4());
    const c = right ? side(centre) : centre;
    const a = right ? side(eyeAxis) : eyeAxis;
    const up = v3(0, 1, 0).addScaledVector(a, -a.y).normalize();
    const across = a.clone().cross(up);
    const ao = prim.getAttribute("COLOR_0")!;
    const color = new Float32Array(ao.getCount() * 3);
    const el: number[] = [];
    for (let v = 0; v < ao.getCount(); v++) {
      const d = v3(g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2]).sub(c).normalize();
      const [u, w] = [d.dot(across), d.dot(up)];
      const r = Math.hypot(u, w);
      let tint = sclera;
      if (d.dot(a) > 0 && (u / 0.16) ** 2 + (w / 0.44) ** 2 < 1) tint = pupil;
      else if (d.dot(a) > 0 && r < 0.66) {
        const k = Math.min(1, Math.max(0, (r - 0.5) / 0.16)) * 0.8 + 0.08 * Math.sin(Math.atan2(w, u) * 23);
        tint = iris.map((x, i) => x + (limbus[i] - x) * Math.max(0, k));
      }
      ao.getElement(v, el);
      for (let i = 0; i < 3; i++) color[v * 3 + i] = tint[i] * el[0];
    }
    prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(color).setBuffer(doc.getRoot().listBuffers()[0]));
    ao.dispose();
  }
  await io.write(OUT, doc);
}

// ---------------------------------------------------------------- helpers

// Merges vertices at the same position (welds the primitive split).
function weld(g: Geometry): Geometry {
  const ids = new Map<string, number>();
  const remap = new Uint32Array(g.position.length / 3);
  const position: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const key = `${g.position[i * 3].toFixed(6)},${g.position[i * 3 + 1].toFixed(6)},${g.position[i * 3 + 2].toFixed(6)}`;
    if (!ids.has(key)) {
      ids.set(key, ids.size);
      position.push(g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]);
    }
    remap[i] = ids.get(key)!;
  }
  return { position: new Float32Array(position), index: g.index.map((v) => remap[v]) };
}

// Midpoint subdivision: every triangle into four.
function subdivide(g: Geometry): Geometry {
  const position = Array.from(g.position);
  const mids = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let m = mids.get(key);
    if (m === undefined) {
      m = position.length / 3;
      for (let k = 0; k < 3; k++) position.push((g.position[a * 3 + k] + g.position[b * 3 + k]) / 2);
      mids.set(key, m);
    }
    return m;
  };
  const index: number[] = [];
  for (let i = 0; i < g.index.length; i += 3) {
    const [a, b, c] = [g.index[i], g.index[i + 1], g.index[i + 2]];
    const [ab, bc, ca] = [mid(a, b), mid(b, c), mid(c, a)];
    index.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  return { position: new Float32Array(position), index: new Uint32Array(index) };
}

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
  return extreme(g, (p) => (Math.abs(p.z - z) < 0.004 && p.y > 0.3 ? -p.x : -Infinity));
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

// Skin vertices in a slab across a joint of the sculpt, mapped onto the
// joint of the skeleton (turned from axisS to axisT): radially limbScale
// times as far out, or 3 mm past the furthest content point within 30° of
// that direction, whichever is more.
function jointRing(sj: Vector3, tj: Vector3, axisS: Vector3, axisT: Vector3) {
  const rot = new Quaternion().setFromUnitVectors(axisS, axisT);
  const around: Vector3[] = [];
  for (let i = 0; i < inner.length; i += 3) {
    const q = v3(inner[i], inner[i + 1], inner[i + 2]).sub(tj);
    if (q.length() < 0.03 && Math.abs(q.dot(axisT)) < 0.005) around.push(q.addScaledVector(axisT, -q.dot(axisT)));
  }
  return sample(body, (p) => {
    if (p.x > 0) return false;
    const d = p.clone().sub(sj);
    return Math.abs(d.dot(axisS)) < 0.003 && d.length() < 0.05;
  }, 10).map((p): [Vector3, Vector3] => {
    const d = p.clone().sub(sj);
    const along = d.dot(axisS);
    const radial = d.addScaledVector(axisS, -along).applyQuaternion(rot);
    const dir = radial.clone().normalize();
    let reach = radial.length() * limbScale;
    for (const q of around) if (q.dot(dir) > q.length() * 0.866) reach = Math.max(reach, q.dot(dir) + 0.004);
    return [p, tj.clone().addScaledVector(axisT, along * limbScale).addScaledVector(dir, reach)];
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
      return c.addScaledVector(back, 0.003);
    });
}

// Phalanges of the four weight-bearing digits: the low part of the paw (the
// thoracic dewclaw is higher) split into four groups along x (1D k-means),
// sorted by x.
function digitGroups(g: Geometry) {
  let floor = Infinity;
  for (let i = 1; i < g.position.length; i += 3) floor = Math.min(floor, g.position[i]);
  const pts: Vector3[] = [];
  for (let i = 0; i < g.position.length; i += 3) if (g.position[i + 1] < floor + 0.012) pts.push(v3(g.position[i], g.position[i + 1], g.position[i + 2]));
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

// Tip of each weight-bearing digit (its most cranial 4 mm).
function digitTips(g: Geometry) {
  return digitGroups(g).map((list) => {
    const front = Math.min(...list.map((p) => p.z));
    return mean(list.filter((p) => p.z < front + 0.004));
  });
}

// Warped skin positions, with the tail laid along the caudal vertebrae
// (blended in over its first 6 cm of sculpt).
function place(warp: (p: Float32Array) => Float32Array<ArrayBuffer>) {
  const out = warp(body.position);
  for (let i = 0; i < out.length; i += 3) {
    const p = v3(body.position[i], body.position[i + 1], body.position[i + 2]);
    if (!isTail(p)) continue;
    const t = Math.min(1, (p.z - S.tailRoot.z) / 0.06);
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
    if (p.x > 0 || seen.has(k) || isTail(p) || isHead(p) || p.distanceTo(S.tailRoot) < 0.05 || list.some(([s]) => s.distanceTo(p) < 0.02)) continue;
    seen.add(k);
    left.push(v);
  }
  const near = grid(g.position, 0.01);
  return left.map((v) => [v, near(-g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2], 0.01)] as [number, number]).filter(([, r]) => r >= 0);
}

// Target for each probe pair of the warped skin `g`: the left vertex moved
// out along its normal until every content point in an 8 mm cylinder in
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
    near(at.x, at.y, at.z, 0.04, (q) => {
      const rel = v3(points[q * 3] - at.x, points[q * 3 + 1] - at.y, points[q * 3 + 2] - at.z);
      const ahead = rel.dot(n);
      if (rel.addScaledVector(n, -ahead).length() > 0.008 || ahead < -clearance) return;
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

// Tail vertices of the sculpt: caudal to the root and above the buttocks.
function isTail(p: Vector3) {
  return p.z > S.tailRoot.z && p.y > 0.385;
}

// Head of the sculpt: in front of the occiput, plus the ears.
function isHead(p: Vector3) {
  return p.z < -0.37 || (p.z < -0.33 && p.y > 0.535);
}

// Maps a source tail vertex onto the caudal vertebrae: its distance from the
// root becomes arc length along the chain of vertebral centroids (ending just
// past the last vertebra) and its offset from the tail axis is scaled by the
// trunk's scale `k0` in the plane across the chain (sideways 1.3x that at the
// root, where the transverse processes are wide), dorsal staying dorsal.
function tailCurve(vertebrae: Geometry[], k0: number) {
  const pts = vertebrae.map(centroid);
  const last = vertebrae[vertebrae.length - 1];
  const dir = pts[pts.length - 1].clone().sub(pts[pts.length - 2]).normalize();
  pts.push(extreme(last, (p) => p.dot(dir)).addScaledVector(dir, 0.004));
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
    const k = k0 * (1 + 0.3 * Math.max(0, 1 - s / (0.3 * total)) ** 2);
    return at.add(v3(p.x * k, 0, 0)).addScaledVector(dorsal, (p.y - S.tailRoot.y) * k0);
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
function pushOut(g: Geometry, boneGeoms: Geometry[], clearance: number, covered: (x: number, y: number, z: number) => boolean, fixed: (v: number) => boolean) {
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
  // Fixed vertices do not move; the push fades in over a few rings around them.
  const isFixed = Array.from({ length: count }, (_, v) => fixed(v));
  let weight = Float32Array.from(isFixed, (f) => (f ? 0 : 1));
  for (let it = 0; it < 8; it++) {
    const next = weight.slice();
    for (let v = 0; v < count; v++) {
      if (isFixed[v] || !neighbours[v].size) continue;
      let sum = 0;
      for (const u of neighbours[v]) sum += weight[u];
      next[v] = (sum / neighbours[v].size + weight[v]) / 2;
    }
    weight = next;
  }
  const p = g.position;
  const total = new Float32Array(p.length);
  // After the first pass, steps are capped at 2 mm so neighbouring surfaces
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
      const v = nearSkin(x, y, z, isIn ? 0.015 : 0.04);
      if (v < 0 || isFixed[v]) continue;
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
        // Along the normal when the bone is in front of the vertex, so the
        // surface bulges instead of shearing into folds.
        const d = rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2];
        push = d > 0 ? n.map((c) => c * (d + clearance)) : rel.map((c, k) => c + n[k] * clearance);
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
      for (let k = 0; k < 3; k++) push[i + k] *= weight[i / 3];
      const len = Math.hypot(push[i], push[i + 1], push[i + 2]);
      if (pass > 0 && len > 0.002) for (let k = 0; k < 3; k++) push[i + k] *= 0.002 / len;
      moved = Math.max(moved, Math.min(len, pass > 0 ? 0.002 : len));
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
function carry(g: Geometry, skinPos: Float32Array, push: Float32Array) {
  const near = grid(skinPos, 0.01);
  for (let i = 0; i < g.position.length; i += 3) {
    const v = near(g.position[i], g.position[i + 1], g.position[i + 2], 0.05);
    if (v < 0) continue;
    for (let k = 0; k < 3; k++) g.position[i + k] += push[v * 3 + k];
  }
}
