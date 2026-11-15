/**
 * Muscles of the cat from "Feline Ecorche Dec" by westerly (Sketchfab
 * 4c08824eb4914ff4b6e71b4dc2ba080e, CC BY 4.0): a ZBrush écorché after
 * Goldfinger's "Animal Anatomy for Artists", by the author of the skeleton
 * that scripts/build-cat-skeletal.ts uses and in the same frame. The author
 * calls it rough; a few minor deep muscles are not sculpted.
 *
 * Every muscle and bone is a separate, unnamed shell. Bone shells are the ones
 * lying on "Feline Skeleton Dec" (at least half their vertices within 0.002
 * sculpt units of it); the rest are muscles. The bone shells are registered
 * onto our skeleton (rigid + uniform scale, without the skull, mandible, hyoid
 * and clavicles, which skeletal.glb models or takes from scans) and the muscles
 * move with them. Our skull and mandible are scans registered onto the same
 * sculpt, so the head muscles need no separate fit (the sculpted skull and
 * mandible lie about 1 mm from ours); vertices that end up inside one of our
 * bones are pushed out of it.
 *
 * Shells are labelled by position (SHELLS) and checked by their attachments.
 * Where the sculpt joins the left and right muscle into one shell across the
 * median plane, it is cut there and the cut closed with a flat cap; the build
 * mirrors the left side. The brachiocephalicus is cut at the clavicle.
 *
 * Returns LEFT-side world geometry keyed by meshKey, decimated, each with
 * `fibre` (scripts/lib/muscle.ts fibres(): the part's long axis, tendon weight
 * from thickness). The skeleton passed in must be skeletal.glb at its true size.
 */
import { BufferAttribute, BufferGeometry, Matrix4, ShapeUtils, Vector2, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { meshKey } from "../../lib/content/mesh";
import { bake, bounds, components, download, merge, pca, pcaStarts, points, readPrims, register, transform, type Geometry } from "./glb";
import { fibres } from "./muscle";
import { weldSimplify } from "./segment";

const sources = {
  ecorche: { uid: "4c08824eb4914ff4b6e71b4dc2ba080e", file: "westerly-feline-ecorche.glb" },
  skeleton: { uid: "a5d0bb8f55dc4f49b103cd20d65e0b17", file: "westerly-feline-skeleton.glb" },
};

// Shell (centre of its bounding box in the atlas frame, mm) -> mesh, with the
// bones each end lies on. M: one shell across the median plane. The hidden
// parts of the sculpted shells run into each other, so SHELLS lists them from
// deep to superficial: the build makes each room for the ones before it.
//
// | Centre (mm)           | Mesh                                    | Attachments                                   |
// | --------------------- | --------------------------------------- | --------------------------------------------- |
// | 0, 245, -197 M        | temporalis                              | braincase -> coronoid process                 |
// | -26, 227, -190        | masseter                                | zygomatic arch -> lateral ramus               |
// | -19, 205, -202        | digastricus                             | caudal skull -> ventral border of mandible    |
// | 0, 203, -190 M        | mylohyoideus                            | sheet between the mandibular bodies           |
// | 0, 203, -137 M        | sternohyoideus                          | manubrium -> hyoid, ventral neck              |
// | 0, 222, -140 M        | sternocephalicus                        | manubrium -> mastoid region                   |
// | -13, 251, -173        | obliquus-capitis-cranialis              | atlas wing -> occiput                         |
// | -8, 246, -155         | obliquus-capitis-caudalis               | spine of axis -> atlas wing                   |
// | 0, 259, -160 M        | rectus-capitis-dorsalis                 | spine of axis -> occiput                      |
// | 0, 197, -122 M        | brachiocephalicus (cut at the clavicle) | dorsal neck -> clavicle -> distal humerus     |
// | 0, 252, -108 M        | trapezius.cervical                      | dorsal neck -> spine of scapula               |
// | 0, 241, -70 M         | trapezius.thoracic                      | thoracic spines -> spine of scapula           |
// | -26, 222, -132 + -14, 238, -105 | rhomboideus (capitis, cervicis) | occiput, nuchal line -> dorsal scapula    |
// | 0, 243, 19 M + 0, 246, -40 M | epaxial (with the comb of the interspinal muscles over T1-T10) |   |
// | 0, 206, -2 M          | latissimus-dorsi                        | thoracolumbar midline -> medial humerus       |
// | -22, 218, -58         | serratus-ventralis                      | ribs 1-8 -> facies serrata of the scapula     |
// | -26, 192, 52          | obliquus-externus-abdominis             | caudal ribs -> flank, pubis                   |
// | -27, 224, 94          | obliquus-internus-abdominis             | tuber coxae -> last rib                       |
// | 0, 173, 76 M          | rectus-abdominis                        | sternum -> pubis                              |
// | 0, 170, -96 M + 0, 148, -80 M | pectorales.superficiales (pectoantebrachialis, pectoralis major) |  |
// | 0, 157, -82 M + 0, 156, -52 M | pectorales.profundus (pectoralis minor, xiphihumeralis) |           |
// | 0, 154, 237 M         | sacrocaudales                           | sacrum -> tail tip, all round the tail        |
// | -29, 220, -92         | supraspinatus                           | supraspinous fossa -> greater tubercle        |
// | -31, 221, -83         | infraspinatus                           | infraspinous fossa -> humerus                 |
// | -36, 207, -92         | deltoideus.scapular                     | spine of scapula -> deltoid tuberosity        |
// | -38, 194, -101        | deltoideus.acromial                     | acromion -> deltoid tuberosity                |
// | -26, 212, -79         | teres-major                             | caudal angle of scapula -> medial humerus     |
// | -31, 175, -71         | triceps-brachii.long                    | caudal border of scapula -> olecranon         |
// | -36, 164, -81         | triceps-brachii.lateral                 | lateral humerus -> olecranon                  |
// | -24, 145, -62         | triceps-brachii.medial                  | medial distal humerus -> olecranon            |
// | -30, 134, -65         | anconeus                                | caudolateral humerus -> ulna                  |
// | -32, 151, -83         | biceps-brachii                          | cranial arm -> proximal forearm (medial)      |
// | -28, 158, -89         | brachialis                              | lateral humerus -> proximal radius and ulna   |
// | -27, 94, -81          | brachioradialis                         | lateral supracondylar crest -> distal radius  |
// | -28, 86, -76          | extensor-carpi-radialis                 | lateral humerus -> metacarpus                 |
// | -28, 76, -89          | extensor-digitorum-communis             | lateral epicondyle -> digits                  |
// | -31, 69, -87          | extensor-digitorum-lateralis            | lateral epicondyle -> lateral digits          |
// | -35, 78, -68          | extensor-carpi-ulnaris                  | lateral epicondyle -> lateral metacarpus      |
// | -29, 110, -70         | pronator-teres                          | medial epicondyle -> radius                   |
// | -23, 71, -75          | flexor-carpi-radialis                   | medial epicondyle -> medial metacarpus        |
// | -24, 64, -83          | flexor-digitorum-superficialis-thoracic | medial epicondyle -> palmar digits            |
// | -27, 79, -68 + -29, 80, -61 | flexor-carpi-ulnaris (humeral, ulnar heads) | -> accessory carpal bone  |
// | -27, 235, 165         | gluteus-medius                          | ilium -> greater trochanter                   |
// | -23, 229, 188         | gluteus-superficialis                   | sacrum, Cd1 -> proximal femur                 |
// | -33, 218, 152         | tensor-fasciae-latae                    | tuber coxae -> fascia lata                    |
// | -27, 186, 136         | sartorius                               | iliac crest -> patella, medial tibia          |
// | -22, 197, 177         | caudofemoralis                          | Cd1-Cd3 -> distal femur, patella              |
// | -31, 158, 185         | biceps-femoris                          | ischiatic tuberosity -> stifle, crus          |
// | -24, 144, 194         | semitendinosus                          | ischiatic tuberosity -> medial tibia          |
// | -18, 168, 183         | semimembranosus                         | ischium -> medial femur and tibia             |
// | 0, 158, 175 M         | gracilis                                | pelvic symphysis -> medial tibia              |
// | 0, 171, 177 M         | adductor                                | pubis, ischium -> caudal femur                |
// | -30, 178, 157         | quadriceps-femoris.vastus-lateralis     | lateral femur -> patella                      |
// | -28, 174, 147         | quadriceps-femoris.rectus-femoris       | ilium -> patella                              |
// | -35, 112, 179         | gastrocnemius                           | caudal femur -> calcaneal tuber               |
// | -38, 103, 186         | soleus                                  | head of fibula -> calcaneal tuber             |
// | -32, 77, 182          | flexor-digitorum-superficialis-pelvic   | caudal femur -> plantar digits                |
// | -34, 90, 170          | tibialis-cranialis                      | cranial tibia -> medial tarsus                |
// | -35, 74, 170          | extensor-digitorum-longus               | extensor fossa of femur -> digits             |
// | -38, 91, 176          | fibularis-longus                        | lateral tibial condyle -> plantar tarsus      |
// | -38, 70, 197          | fibularis-brevis                        | distal fibula -> fifth metatarsal             |
//
// Not used (left side; their right-side twins are left out too):
// - Facial muscles that cannot be told apart with confidence on a rough
//   sculpt: around the orbit (-16, 221, -217), the lips and nose (-12, 206,
//   -218; -12, 194, -213; -8, 207, -224; -12, 200, -205; 0, 237, -220 M; 0,
//   228, -224 M), between temporalis and arch (-25, 239, -192; -24, 236, -209),
//   a strap from the ear to the commissure of the lips, likely the zygomaticus
//   (-25, 231, -193), and a spindle behind the jaw, perhaps the parotid gland
//   (-19, 223, -181).
// - Two straps from the mastoid region that end free in the middle of the neck
//   (-16, 229, -165; -16, 228, -158), possibly the cleidomastoideus and the
//   omotransversarius cut short.
// - The abductor digiti I longus and its tendon (-25, 53, -78; -31, 14, -85),
//   the small muscles of the forepaw (-24, 14, -89) and hindpaw (-32, 28, 189),
//   a thin lateral crural muscle with a tendon to the digits, fibularis tertius
//   or a lateral digital extensor (-37, 69, 178), two muscles from the first
//   caudal vertebrae to the ischium and the tail (-17, 232, 205; -11, 231, 211),
//   and specks of 1 to 64 triangles.
const SHELLS: [number, number, number, string][] = [
  [0, 259, -160.4, "rectus-capitis-dorsalis"],
  [-8.3, 246.4, -154.8, "obliquus-capitis-caudalis"],
  [-12.7, 250.7, -172.6, "obliquus-capitis-cranialis"],
  [0, 202.9, -190.2, "mylohyoideus"],
  [-19.4, 205.2, -202.2, "digastricus"],
  [0, 245.1, -196.9, "temporalis"],
  [-25.9, 227.1, -190.4, "masseter"],
  [0, 242.6, 18.6, "epaxial"],
  [0, 245.7, -40.4, "epaxial"],
  [0, 202.6, -137.4, "sternohyoideus"],
  [-25.9, 222, -132.3, "rhomboideus"],
  [-14, 237.6, -105.4, "rhomboideus"],
  [-22.3, 218.3, -57.8, "serratus-ventralis"],
  [-27, 224.2, 93.6, "obliquus-internus-abdominis"],
  [0, 172.9, 76.4, "rectus-abdominis"],
  [-26.2, 192.4, 52.3, "obliquus-externus-abdominis"],
  [0, 154.4, 236.9, "sacrocaudales"],
  [-28.5, 220, -92.4, "supraspinatus"],
  [-31, 221, -83.2, "infraspinatus"],
  [-26, 211.5, -79.2, "teres-major"],
  [0, 157, -82, "pectorales.profundus"],
  [0, 156.3, -52.2, "pectorales.profundus"],
  [0, 169.8, -95.8, "pectorales.superficiales"],
  [0, 147.6, -79.5, "pectorales.superficiales"],
  [0, 205.5, -1.5, "latissimus-dorsi"],
  [0, 240.5, -69.9, "trapezius.thoracic"],
  [0, 251.7, -107.5, "trapezius.cervical"],
  [0, 222.4, -139.8, "sternocephalicus"],
  [0, 197.4, -122.3, "brachiocephalicus"],
  [-35.6, 206.6, -91.9, "deltoideus.scapular"],
  [-38.2, 194.3, -100.7, "deltoideus.acromial"],
  [-28, 158.1, -89.1, "brachialis"],
  [-31.5, 150.8, -83.2, "biceps-brachii"],
  [-23.8, 144.7, -62.2, "triceps-brachii.medial"],
  [-30, 134.4, -65.2, "anconeus"],
  [-31.1, 174.6, -70.9, "triceps-brachii.long"],
  [-35.9, 164.2, -80.7, "triceps-brachii.lateral"],
  [-28.8, 109.6, -69.9, "pronator-teres"],
  [-23.4, 71, -74.9, "flexor-carpi-radialis"],
  [-23.9, 64.3, -82.7, "flexor-digitorum-superficialis-thoracic"],
  [-26.8, 78.8, -68.2, "flexor-carpi-ulnaris"],
  [-28.7, 79.7, -61.4, "flexor-carpi-ulnaris"],
  [-28.4, 85.5, -76.2, "extensor-carpi-radialis"],
  [-27.9, 76.1, -89.3, "extensor-digitorum-communis"],
  [-31, 69, -86.8, "extensor-digitorum-lateralis"],
  [-34.6, 78.2, -68.2, "extensor-carpi-ulnaris"],
  [-27.3, 94.3, -81.4, "brachioradialis"],
  [0, 170.9, 176.9, "adductor"],
  [-18.4, 168.4, 183, "semimembranosus"],
  [0, 157.7, 174.9, "gracilis"],
  [-28.2, 173.6, 147.3, "quadriceps-femoris.rectus-femoris"],
  [-29.8, 178, 156.8, "quadriceps-femoris.vastus-lateralis"],
  [-27, 186.3, 135.7, "sartorius"],
  [-26.7, 235, 164.5, "gluteus-medius"],
  [-32.5, 217.5, 151.7, "tensor-fasciae-latae"],
  [-23, 229.1, 188, "gluteus-superficialis"],
  [-22.4, 197, 176.9, "caudofemoralis"],
  [-23.8, 143.6, 193.5, "semitendinosus"],
  [-30.5, 158.4, 184.6, "biceps-femoris"],
  [-34.5, 74.1, 170, "extensor-digitorum-longus"],
  [-33.5, 89.9, 169.5, "tibialis-cranialis"],
  [-37.5, 70.2, 197.3, "fibularis-brevis"],
  [-37.7, 90.8, 175.7, "fibularis-longus"],
  [-31.9, 77.3, 181.9, "flexor-digitorum-superficialis-pelvic"],
  [-38.3, 103.1, 186, "soleus"],
  [-34.9, 111.6, 178.5, "gastrocnemius"],
];

// Kept fraction of each part's triangles after the median cut.
const DECIMATE = 0.5;
const MIN_TRIS = 400;
// Vertices inside one of our bones are moved this far outside it; deeper ones
// are left alone (the inside test is unreliable on thin crests).
const CLEAR = 0.0005;
const MAX_DEPTH = 0.004;
// Distance from the centre of our clavicle to the sculpt's clavicular
// intersection, along the brachiocephalicus (see below).
const INTERSECTION = 0.008;

function bvh(g: Geometry) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(g.position, 3));
  geometry.setIndex(new BufferAttribute(g.index, 1));
  return new MeshBVH(geometry);
}

// The part of a closed mesh where (p - o)·n <= 0, closed again with flat caps
// on the plane: each cut cross-section, holes included, triangulated in it.
function cut(g: Geometry, o: Vector3, n: Vector3): Geometry {
  const pos = Array.from(g.position);
  const d: number[] = [];
  const v = new Vector3();
  for (let i = 0; i < g.position.length; i += 3) {
    const s = v.fromArray(g.position, i).sub(o).dot(n);
    d.push(Math.abs(s) < 1e-9 ? 0 : s);
  }
  const mid = new Map<string, number>();
  const split = (a: number, b: number) => {
    if (d[a] === 0) return a;
    if (d[b] === 0) return b;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    let id = mid.get(key);
    if (id === undefined) {
      const t = d[a] / (d[a] - d[b]);
      for (let k = 0; k < 3; k++) pos.push(pos[a * 3 + k] + (pos[b * 3 + k] - pos[a * 3 + k]) * t);
      id = d.push(0) - 1;
      mid.set(key, id);
    }
    return id;
  };
  const tri: number[] = [];
  for (let t = 0; t < g.index.length; t += 3) {
    const f = [g.index[t], g.index[t + 1], g.index[t + 2]];
    if (f.every((i) => d[i] <= 0)) tri.push(...f);
    else if (f.some((i) => d[i] < 0)) {
      const poly: number[] = [];
      for (let k = 0; k < 3; k++) {
        const [a, b] = [f[k], f[(k + 1) % 3]];
        if (d[a] <= 0) poly.push(a);
        if (d[a] <= 0 !== d[b] <= 0) poly.push(split(a, b));
      }
      const ring = poly.filter((x, k) => x !== poly[(k + 1) % poly.length]);
      for (let k = 1; k + 1 < ring.length; k++) tri.push(ring[0], ring[k], ring[k + 1]);
    }
  }
  // Open edges on the plane, reversed: the caps' outlines.
  const count = new Map<string, number>();
  for (let t = 0; t < tri.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[t + k], tri[t + ((k + 1) % 3)]];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  const next = new Map<number, number[]>();
  for (let t = 0; t < tri.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[t + k], tri[t + ((k + 1) % 3)]];
      if (d[a] !== 0 || d[b] !== 0 || count.get(a < b ? `${a},${b}` : `${b},${a}`) !== 1) continue;
      next.set(b, [...(next.get(b) ?? []), a]);
    }
  // Open chains (running into a hole of the sculpt) are walked from their
  // first vertex and closed straight across the gap.
  const reached = new Set([...next.values()].flat());
  const loops: number[][] = [];
  for (const start of [...next.keys()].sort((a, b) => Number(reached.has(a)) - Number(reached.has(b)))) {
    while (next.get(start)?.length) {
      const loop = [start];
      let at = next.get(start)!.pop()!;
      while (at !== start && next.get(at)?.length && loop.length < 100000) {
        loop.push(at);
        at = next.get(at)!.pop()!;
      }
      if (at !== start) loop.push(at);
      if (loop.length >= 3) loops.push(loop);
    }
  }
  // Plane coordinates; loops inside an odd number of others are holes.
  const u = new Vector3(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize();
  const w = new Vector3().crossVectors(n, u);
  const flat = loops.map((l) => l.map((i) => (v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]), new Vector2(v.dot(u), v.dot(w)))));
  const inside = (p: Vector2, poly: Vector2[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    return c;
  };
  const parent = flat.map((l, i) => {
    const around = flat.map((m, j) => j).filter((j) => j !== i && inside(l[0], flat[j]));
    return around.length % 2 ? around.sort((a, b) => Math.abs(ShapeUtils.area(flat[a])) - Math.abs(ShapeUtils.area(flat[b])))[0] : -1;
  });
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  flat.forEach((outer, i) => {
    if (parent[i] >= 0) return;
    const holes = flat.map((_, j) => j).filter((j) => parent[j] === i);
    const ids = [...loops[i], ...holes.flatMap((j) => loops[j])];
    for (const f of ShapeUtils.triangulateShape(outer, holes.map((j) => flat[j]))) {
      const [p, q, r] = f.map((k) => ids[k]);
      a.fromArray(pos, p * 3);
      b.fromArray(pos, q * 3).sub(a);
      c.fromArray(pos, r * 3).sub(a);
      tri.push(...(b.cross(c).dot(n) >= 0 ? [p, q, r] : [p, r, q]));
    }
  });
  return weldSimplify({ position: new Float32Array(pos), index: new Uint32Array(tri) }, Infinity);
}

export async function felineEcorche(skeleton: Map<string, Geometry>): Promise<Map<string, Geometry>> {
  const flip = new Matrix4().makeRotationY(Math.PI);
  const shells = components(bake(await readPrims(await download(sources.ecorche)), flip));
  const sculpt = bvh(bake(await readPrims(await download(sources.skeleton)), flip));
  const hit = { point: new Vector3(), distance: 0, faceIndex: 0 };
  const onSkeleton = (g: Geometry) => {
    const ps = points(g, 400);
    return ps.filter((p) => (sculpt.closestPointToPoint(p, hit), hit.distance < 0.002)).length / ps.length;
  };
  const bones: Geometry[] = [];
  const muscles: Geometry[] = [];
  for (const g of shells) (onSkeleton(g) > 0.5 ? bones : muscles).push(g);

  const ours = merge([...skeleton].filter(([n]) => !/skull|mandible|hyoid|clavicle/.test(n)).map(([, g]) => g));
  const src = merge(bones);
  const { m, rms } = register(src, ours, pcaStarts(src, ours, true), { withScale: true, keep: 0.9, samples: 3000 });
  console.log(`écorché: ${bones.length} bone and ${muscles.length} muscle shells; bones onto skeletal.glb: ICP rms ${(rms * 1000).toFixed(2)} mm, scale ${Math.cbrt(m.determinant()).toFixed(4)}`);

  const placed = muscles.map((g) => {
    const p = transform(g, m);
    return { g: p, b: bounds(p) };
  });
  const parts = new Map<string, Geometry[]>();
  const cutAtMedian = new Set<string>();
  for (const [x, y, z, id] of SHELLS) {
    const at = new Vector3(x, y, z).multiplyScalar(0.001);
    const best = placed.reduce((q, s) => (s.b.center.distanceTo(at) < q.b.center.distanceTo(at) ? s : q));
    if (best.b.center.distanceTo(at) > 0.0015) throw new Error(`écorché shell for ${id} not found near ${x}, ${y}, ${z} mm`);
    const g = weldSimplify(best.g, Infinity);
    const median = best.b.min.x < -0.001 && best.b.max.x > 0.001;
    if (median) cutAtMedian.add(id);
    parts.set(id, [...(parts.get(id) ?? []), median ? cut(g, new Vector3(), new Vector3(1, 0, 0)) : g]);
  }

  // Brachiocephalicus: cleidocephalicus above the clavicular intersection,
  // cleidobrachialis below, cut across the muscle's own direction there. The
  // sculpt marks the intersection with a groove INTERSECTION distal to the
  // centre of our clavicle (modelled, illustrative).
  {
    const g = merge(parts.get("brachiocephalicus")!);
    parts.delete("brachiocephalicus");
    cutAtMedian.add("brachiocephalicus.cleidocephalicus").add("brachiocephalicus.cleidobrachialis");
    const o = bounds(skeleton.get(meshKey("cat.skeletal.clavicle.L"))!).center;
    const n = pca(points(g).filter((p) => p.distanceTo(o) < 0.015)).axes[0];
    if (n.y > 0) n.negate();
    o.addScaledVector(n, INTERSECTION);
    parts.set("brachiocephalicus.cleidocephalicus", [cut(g, o, n)]);
    parts.set("brachiocephalicus.cleidobrachialis", [cut(g, o, n.clone().negate())]);
  }

  const left = merge([...skeleton].filter(([n]) => !/_R$|_R_/.test(n)).map(([, g]) => g));
  const tree = bvh(left);
  const [a, b, c] = [new Vector3(), new Vector3(), new Vector3()];
  const out = new Map<string, Geometry>();
  let total = 0;
  let pushed = 0;
  for (const [id, gs] of parts) {
    const whole = merge(gs);
    const g = weldSimplify(whole, Math.max(MIN_TRIS, Math.round((whole.index.length / 3) * DECIMATE)), 0.01);
    // The median cap is inside the bones it was cut through: left alone, and
    // nothing pushed across the median plane.
    const median = cutAtMedian.has(id);
    const p = new Vector3();
    for (let i = 0; i < g.position.length; i += 3) {
      p.fromArray(g.position, i);
      if ((median && p.x === 0) || !tree.closestPointToPoint(p, hit, 0, MAX_DEPTH)) continue;
      const t = hit.faceIndex * 3;
      const index = tree.geometry.index!.array;
      a.fromArray(left.position, index[t] * 3);
      b.fromArray(left.position, index[t + 1] * 3).sub(a);
      c.fromArray(left.position, index[t + 2] * 3).sub(a);
      const nrm = b.cross(c).normalize();
      if (a.copy(p).sub(hit.point).dot(nrm) >= 0) continue;
      hit.point.addScaledVector(nrm, CLEAR).toArray(g.position, i);
      if (median) g.position[i] = Math.min(g.position[i], 0);
      pushed++;
    }
    const along = pca(points(g, 4000)).axes[0];
    const dirs = new Float32Array(g.position.length);
    for (let i = 0; i < dirs.length; i += 3) along.toArray(dirs, i);
    out.set(meshKey(`cat.muscular.${id}.L`), { ...g, fibre: fibres(g.position, g.index, dirs) });
    total += g.index.length / 3;
  }
  console.log(`écorché: ${out.size} left-side parts, ${total} triangles, ${pushed} vertices pushed out of bone`);
  return out;
}
