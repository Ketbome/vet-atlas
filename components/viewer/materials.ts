import { Color, MeshPhysicalMaterial } from "three";
import type { Material } from "./types";

// Surface finish per tissue, kept matte: dry bone, fibrous muscle with a soft
// sheen, moist but not lacquered viscera, velvety skin. Depth comes from the
// ambient occlusion baked into vertex colours, not from reflections.
const finishes: Record<Material, Partial<MeshPhysicalMaterial>> = {
  bone: { roughness: 0.86 },
  muscle: { roughness: 0.72, sheen: 0.25, sheenRoughness: 0.6 },
  organ: { roughness: 0.6, clearcoat: 0.06, clearcoatRoughness: 0.7 },
  skin: { roughness: 0.9, sheen: 0.3, sheenRoughness: 0.9 },
};

// Muscle geometry may carry `_fibre` (fibre direction xyz, tendon weight w):
// fascicles are drawn as fine bump striations along the fibres, faded below
// pixel size, and tendon and aponeurosis turn pearly and a little smoother.
const FIBRE_VERTEX = `attribute vec4 _fibre;
varying vec4 vFibre;
varying vec3 vFibrePos;
void main() {`;
const FIBRE_FRAGMENT = `varying vec4 vFibre;
varying vec3 vFibrePos;
float fibreHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fibreNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(fibreHash(i), fibreHash(i + vec3(1, 0, 0)), f.x), mix(fibreHash(i + vec3(0, 1, 0)), fibreHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(fibreHash(i + vec3(0, 0, 1)), fibreHash(i + vec3(1, 0, 1)), f.x), mix(fibreHash(i + vec3(0, 1, 1)), fibreHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`;
const FIBRE_SURFACE = `{
  vec3 f = vFibre.xyz;
  float len = length(f);
  float tendon = smoothstep(0.15, 0.85, clamp(vFibre.w, 0.0, 1.0));
  if (len > 0.2) {
    f /= len;
    vec3 a = normalize(cross(f, abs(f.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 q = vec3(dot(vFibrePos, a), dot(vFibrePos, cross(f, a)), dot(vFibrePos, f));
    float px = length(fwidth(vFibrePos));
    // Fascicles about 5 mm and 1.3 mm across, stretched along the fibre.
    float coarse = fibreNoise(q * vec3(190.0, 190.0, 7.0)) * (1.0 - smoothstep(0.0018, 0.0045, px));
    float fine = fibreNoise(q * vec3(760.0, 760.0, 24.0)) * (1.0 - smoothstep(0.0005, 0.0012, px));
    float h = 0.65 * coarse + 0.35 * fine;
    vec3 dpdx = dFdx(-vViewPosition);
    vec3 dpdy = dFdy(-vViewPosition);
    vec3 r1 = cross(dpdy, normal);
    vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    float amp = mix(0.0004, 0.0001, tendon);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) * amp;
    normal = normalize(abs(det) * normal - grad);
    diffuseColor.rgb *= mix(0.78, 1.1, mix(h, 0.5, tendon));
  }
  vec3 pearl = vec3(0.72, 0.66, 0.56);
  #ifdef USE_COLOR
  pearl *= vColor.rgb;
  #endif
  diffuseColor.rgb = mix(diffuseColor.rgb, pearl, tendon);
  roughnessFactor = mix(roughnessFactor, 0.5, tendon);
}
#include <lights_physical_fragment>`;

export function tissueMaterial(kind: Material, color: string, occlusion: boolean, fibre = false) {
  const base = new Color(color);
  const material = new MeshPhysicalMaterial({ color: base, metalness: 0, vertexColors: occlusion, ...finishes[kind] });
  if (fibre) material.defines = { FIBRE: "" };
  if (material.sheen > 0) material.sheenColor = base.clone().lerp(new Color("#ffffff"), 0.25);
  // X-ray ghost for faded tissue: a see-through body is several surfaces
  // deep, so plain alpha stacks up to opaque. Surfaces facing the viewer drop
  // to a fraction of the opacity and the silhouette keeps it, so what lies
  // inside shows while the outline of the body stays readable.
  // Selection is an ochre rim light on the same surface (no extra geometry,
  // so nothing shows through eye sockets or the open mouth).
  const ghost = { value: 0 };
  const rim = { value: 0 };
  material.userData.ghost = ghost;
  material.userData.rim = rim;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.ghost = ghost;
    shader.uniforms.rim = rim;
    if (fibre) {
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", FIBRE_VERTEX)
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFibre = vec4(length(_fibre.xyz) > 0.5 ? normalize(mat3(modelMatrix) * _fibre.xyz) : vec3(0.0), _fibre.w);\nvFibrePos = mat3(modelMatrix) * transformed;");
      shader.fragmentShader = (FIBRE_FRAGMENT + shader.fragmentShader).replace("#include <lights_physical_fragment>", FIBRE_SURFACE);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float ghost;\nuniform float rim;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        `float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        if (ghost > 0.5) {
          diffuseColor.a *= mix(1.0, 0.18, pow(facing, 1.5));
          outgoingLight = mix(outgoingLight, diffuseColor.rgb * 0.9 + 0.08, pow(1.0 - facing, 2.0) * 0.6);
        }
        outgoingLight = mix(outgoingLight, vec3(0.78, 0.56, 0.18), rim * pow(1.0 - facing, 3.0) * 0.7);
        #include <opaque_fragment>`,
      );
  };
  return material;
}

// Opacity of the skin as a silhouette over what lies beneath it.
export const SKIN_GHOST = 0.4;

// Fades a tissue material; below full opacity it also turns into a ghost.
export function setOpacity(material: MeshPhysicalMaterial, opacity: number) {
  material.transparent = opacity < 1;
  material.opacity = opacity;
  material.depthWrite = opacity >= 1;
  (material.userData.ghost as { value: number }).value = opacity < 1 ? 1 : 0;
  material.needsUpdate = true;
}

export function setSelected(material: MeshPhysicalMaterial, selected: boolean) {
  (material.userData.rim as { value: number }).value = selected ? 1 : 0;
}
