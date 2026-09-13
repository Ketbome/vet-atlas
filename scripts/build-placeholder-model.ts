/**
 * Generates a schematic placeholder skeleton so the viewer can be developed
 * before real scans are integrated. Shapes are NOT anatomically accurate.
 *
 * Conventions (same as real models): metres, Y up, animal faces -Z,
 * animal's left side is -X. Mesh names are structure ids with "." -> "_".
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { CapsuleGeometry, Matrix4, Quaternion, SphereGeometry, Vector3 } from "three";
import { meshKey } from "../lib/content/mesh";

type Vec = [number, number, number];

type Part = {
  id: string;
  shape: "capsule" | "sphere";
  from: Vec;
  to?: Vec;
  radius: number;
  paired?: boolean;
};

const parts: Part[] = [
  { id: "dog.skeletal.sacrum", shape: "capsule", from: [0, 0.5, 0.17], to: [0, 0.5, 0.25], radius: 0.025 },
  { id: "dog.skeletal.os-coxae", shape: "capsule", from: [0.04, 0.52, 0.13], to: [0.05, 0.42, 0.31], radius: 0.022, paired: true },
  { id: "dog.skeletal.femur", shape: "capsule", from: [0.07, 0.45, 0.25], to: [0.07, 0.29, 0.17], radius: 0.017, paired: true },
  { id: "dog.skeletal.patella", shape: "sphere", from: [0.07, 0.29, 0.14], radius: 0.012, paired: true },
  { id: "dog.skeletal.tibia", shape: "capsule", from: [0.068, 0.28, 0.17], to: [0.065, 0.12, 0.26], radius: 0.014, paired: true },
  { id: "dog.skeletal.fibula", shape: "capsule", from: [0.085, 0.27, 0.18], to: [0.08, 0.13, 0.26], radius: 0.005, paired: true },
  { id: "dog.skeletal.tarsus", shape: "capsule", from: [0.065, 0.11, 0.27], to: [0.065, 0.08, 0.24], radius: 0.016, paired: true },
  { id: "dog.skeletal.metatarsus", shape: "capsule", from: [0.065, 0.08, 0.24], to: [0.065, 0.02, 0.2], radius: 0.012, paired: true },
  { id: "dog.skeletal.phalanges-pelvic", shape: "capsule", from: [0.065, 0.02, 0.2], to: [0.065, 0.012, 0.15], radius: 0.01, paired: true },
];

const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene("dog.skeletal");
const material = doc
  .createMaterial("bone")
  .setBaseColorFactor([0.91, 0.89, 0.83, 1])
  .setRoughnessFactor(0.85)
  .setMetallicFactor(0);

function addMesh(name: string, geometry: CapsuleGeometry | SphereGeometry, transform: Matrix4) {
  geometry.applyMatrix4(transform);
  const g = geometry.toNonIndexed();
  g.computeVertexNormals();
  const position = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array(g.attributes.position.array))
    .setBuffer(buffer);
  const normal = doc
    .createAccessor()
    .setType("VEC3")
    .setArray(new Float32Array(g.attributes.normal.array))
    .setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setMaterial(material);
  const mesh = doc.createMesh(name).addPrimitive(prim);
  scene.addChild(doc.createNode(name).setMesh(mesh));
}

function capsuleBetween(a: Vec, b: Vec, radius: number) {
  const from = new Vector3(...a);
  const to = new Vector3(...b);
  const dir = to.clone().sub(from);
  const length = Math.max(dir.length() - radius * 2, 0.001);
  const geometry = new CapsuleGeometry(radius, length, 6, 16);
  const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.clone().normalize());
  const center = from.clone().add(to).multiplyScalar(0.5);
  return { geometry, transform: new Matrix4().compose(center, quat, new Vector3(1, 1, 1)) };
}

for (const part of parts) {
  const sides = part.paired ? (["L", "R"] as const) : ([null] as const);
  for (const side of sides) {
    const sign = side === "L" ? -1 : 1;
    const mirror = (v: Vec): Vec => [v[0] * sign, v[1], v[2]];
    const name = meshKey(side ? `${part.id}.${side}` : part.id);
    if (part.shape === "sphere") {
      const geometry = new SphereGeometry(part.radius, 16, 12);
      addMesh(name, geometry, new Matrix4().makeTranslation(...mirror(part.from)));
    } else {
      const { geometry, transform } = capsuleBetween(mirror(part.from), mirror(part.to!), part.radius);
      addMesh(name, geometry, transform);
    }
  }
}

const out = process.argv[2] ?? "public/models/dog/skeletal.glb";
new NodeIO().write(out, doc).then(() => {
  console.log(`wrote ${out} with ${scene.listChildren().length} meshes`);
});
