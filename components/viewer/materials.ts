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

export function tissueMaterial(kind: Material, color: string, occlusion: boolean) {
  const base = new Color(color);
  const material = new MeshPhysicalMaterial({ color: base, metalness: 0, vertexColors: occlusion, ...finishes[kind] });
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
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float ghost;\nuniform float rim;\nvoid main() {")
      .replace(
        "#include <opaque_fragment>",
        `float facing = abs(dot(normalize(normal), normalize(vViewPosition)));
        if (ghost > 0.5) diffuseColor.a *= mix(1.0, 0.18, pow(facing, 1.5));
        outgoingLight = mix(outgoingLight, vec3(0.78, 0.56, 0.18), rim * pow(1.0 - facing, 3.0) * 0.7);
        #include <opaque_fragment>`,
      );
  };
  return material;
}

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
