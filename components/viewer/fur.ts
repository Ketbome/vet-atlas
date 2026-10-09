import { Color, Mesh, MeshStandardMaterial, Vector3, type BufferGeometry } from "three";

// Short-coat fur by shell texturing: copies of the skin pushed out along the
// normal, each discarding everything but the strands that reach that height.
// Strands come from a 3D cell hash of the root position, taper toward the
// tip, darken at the root and droop slightly under gravity. The coat is a
// fawn short coat with a darker dorsal saddle and a lighter belly.
const LENGTH = 0.007; // metres
const DENSITY = 1500; // strand cells per metre

// Eye centres in the root space of the fur (world units at load), where the
// coat stops so the eyes stay visible. Shared by every shell of a mesh.
type Clear = { value: Vector3[] };

function shellMaterial(h: number, scale: number, clear: Clear) {
  const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.furH = { value: h };
    shader.uniforms.furLocal = { value: LENGTH / scale };
    shader.uniforms.furScale = { value: scale };
    shader.uniforms.furClear = clear;
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `uniform float furH;
        uniform float furLocal;
        uniform float furScale;
        varying vec3 vFurRoot;
        varying float vFurUp;
        void main() {`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vFurRoot = position * furScale;
        vFurUp = normalize(mat3(modelMatrix) * objectNormal).y;
        transformed += normalize(objectNormal) * furLocal * furH;
        transformed.y -= furLocal * furH * furH * 0.35;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "void main() {",
        `uniform float furH;
        uniform vec3 furClear[2];
        varying vec3 vFurRoot;
        varying float vFurUp;
        float furHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Rotated off the axes so the strand cells never line up into stripes;
        // each strand sits at a jittered spot in its cell.
        if (min(distance(vFurRoot, furClear[0]), distance(vFurRoot, furClear[1])) < 0.011) discard;
        vec3 furP = mat3(0.80, 0.36, -0.48, -0.48, 0.86, -0.16, 0.36, 0.36, 0.86) * vFurRoot * ${DENSITY.toFixed(1)};
        vec3 furCell = floor(furP);
        vec3 furJit = vec3(furHash(furCell), furHash(furCell + 3.1), furHash(furCell + 5.7)) - 0.5;
        float furLen = 0.6 + 0.4 * furHash(furCell + 1.3);
        float furDist = length(fract(furP) - 0.5 - furJit * 0.45);
        // A dense undercoat near the skin, single tapering guard hairs above.
        if (furH > 0.3 && (furH > furLen || furDist > 0.62 * (1.0 - furH / furLen))) discard;
        vec3 fawn = vec3(0.86, 0.60, 0.34);
        vec3 saddle = vec3(0.24, 0.16, 0.10);
        vec3 belly = vec3(0.93, 0.82, 0.64);
        vec3 coat = mix(fawn, saddle, smoothstep(0.05, 0.75, vFurUp) * 0.75);
        coat = mix(coat, belly, smoothstep(-0.3, -0.85, vFurUp) * 0.7);
        coat *= 0.62 + 0.38 * min(1.0, furH / furLen) + 0.1 * (furHash(furCell + 7.0) - 0.5);
        diffuseColor.rgb *= coat;`,
      );
  };
  return material;
}

// Adds the shells as children of the skin mesh (so they follow explode) and
// returns them; toggle with `visible`.
export function addFur(mesh: Mesh, shells: number, clear: Clear) {
  mesh.updateWorldMatrix(true, false);
  const scale = mesh.matrixWorld.getMaxScaleOnAxis();
  const list: Mesh[] = [];
  for (let i = 1; i <= shells; i++) {
    const shell = new Mesh(mesh.geometry as BufferGeometry, shellMaterial(i / shells, scale, clear));
    shell.raycast = () => {};
    shell.userData.furShell = true;
    shell.renderOrder = 0;
    mesh.add(shell);
    list.push(shell);
  }
  return list;
}

// Shows or hides the coat of a skin mesh, building the shells the first time.
// Fewer shells on touch devices, which are usually phones.
// The skin under the coat is shown as dark hide so gaps between hairs read as
// depth, not as bare skin.
const HIDE = new Color("#3B2A1D");

export function syncFur(mesh: Mesh, on: boolean) {
  let shells = mesh.userData.fur as Mesh[] | undefined;
  if (on && !shells) {
    const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    // vFurRoot is position * scale: world space minus the node's offset.
    mesh.updateWorldMatrix(true, false);
    const offset = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
    const eyes = ((mesh.parent?.children ?? []).filter((o) => o.name.includes("_eyes_")) as Mesh[]).map((o) => {
      o.geometry.computeBoundingBox();
      return o.geometry.boundingBox!.getCenter(new Vector3()).applyMatrix4(o.matrixWorld).sub(offset);
    });
    while (eyes.length < 2) eyes.push(new Vector3(1e3, 1e3, 1e3));
    shells = addFur(mesh, coarse ? 10 : 20, { value: eyes.slice(0, 2) });
    mesh.userData.fur = shells;
  }
  for (const s of shells ?? []) s.visible = on;
  const material = mesh.material as MeshStandardMaterial;
  if (on) material.color.copy(HIDE);
}
