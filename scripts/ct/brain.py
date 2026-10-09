"""
Brain surface meshes for scripts/build-dog-visceral.ts from the "Cortical
Atlas of the Canine Brain" (Johnson & Barry 2019, Cornell eCommons,
https://doi.org/10.7298/4t8z-aw34, CC0): population T1 template of 30
mesaticephalic/dolichocephalic dogs with tissue and ROI label maps.

    .venv/bin/python -I scripts/ct/brain.py <out-base>

Downloads the zip once into .cache/models/cornell-canine-atlas/. Brain mask =
grey + white matter of the tissue segmentation, with interior holes filled.
Cerebellum = the atlas "Cerebellum L/R" labels; brainstem = the brain-mask
voxels caudal to the cerebrum that are not cerebellum; cerebrum = the rest.

Output (<out-base>.json + .bin, same layout as greyhound_hindlimb.py): one
mesh per part in metres, centred on the brain bounding box, oriented in the
atlas frame (x = animal's right, y = dorsal, z = caudal).
"""
import io
import json
import os
import sys
import urllib.request
import zipfile

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi
from skimage.measure import marching_cubes

ROOT = os.path.join(os.getcwd(), ".cache", "models", "cornell-canine-atlas")
# eCommons bitstream (DSpace REST endpoint; the HTML download link sits behind a captcha).
URL = "https://ecommons.cornell.edu/server/api/core/bitstreams/7908237d-56b5-48d3-a0a8-419727343192/content"
PREFIX = "Johnson_etal_2019_Canine_Atlas/"
CEREBELLUM = (223, 224)


def fetch():
    path = os.path.join(ROOT, "atlas.zip")
    if not os.path.exists(path):
        os.makedirs(ROOT, exist_ok=True)
        print("downloading", URL)
        urllib.request.urlretrieve(URL, path)
    return zipfile.ZipFile(path)


def volume(z, name):
    data = z.read(PREFIX + name)
    img = nib.Nifti1Image.from_bytes(__import__("gzip").decompress(data))
    return np.asanyarray(img.dataobj), img.header.get_zooms()[:3]


def surface(mask, spacing):
    smooth = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), 1.0)
    v, f, _, _ = marching_cubes(smooth, 0.5, spacing=spacing)
    return v - 2 * np.array(spacing), f


def write(base, meshes):
    index, off, chunks = [], 0, []
    for name, (p, f) in meshes.items():
        for kind, a in (("position", np.ascontiguousarray(p, np.float32).ravel()), ("index", np.ascontiguousarray(f, np.uint32).ravel())):
            index.append({"name": name, "kind": kind, "offset": off, "count": int(a.size)})
            chunks.append(a.tobytes())
            off += a.nbytes
    with open(base + ".bin", "wb") as fh:
        fh.write(b"".join(chunks))
    with open(base + ".json", "w") as fh:
        json.dump(index, fh)


def main(out):
    z = fetch()
    tsm, spacing = volume(z, "TSMs/Canine_population_template_TSM.nii.gz")
    labels, _ = volume(z, "whole_atlas_cortical_subcortical.nii.gz")
    brain = (tsm >= 2) & (tsm <= 3)
    lab, n = ndi.label(brain)
    brain = lab == (np.argmax(ndi.sum(brain, lab, range(1, n + 1))) + 1)
    brain = ndi.binary_fill_holes(ndi.binary_closing(brain, iterations=2))
    # Voxel axes (from the label centres in Canine-labels.xml): i = left -> right,
    # j = ventral -> dorsal, k = caudal -> rostral (olfactory bulbs at high k).
    cere = np.isin(np.rint(labels).astype(int), CEREBELLUM) & brain
    # The labels cover the cerebellar hemispheres; closing across the midline
    # adds the vermis.
    cere = ndi.binary_closing(ndi.binary_opening(cere, iterations=1), iterations=6) & brain
    lab, n = ndi.label(cere)
    cere = lab == (np.argmax(ndi.sum(cere, lab, range(1, n + 1))) + 1)
    # Brainstem: brain voxels caudal to the rostral edge of the cerebellum,
    # ventral to it, minus the cerebellum itself.
    ks = np.nonzero(cere.any(axis=(0, 1)))[0]
    cj = np.nonzero(cere.any(axis=(0, 2)))[0]
    stem = np.zeros_like(brain)
    stem[:, : cj.min() + (cj.max() - cj.min()) // 3, : ks.max()] = True
    stem &= brain & ~cere
    lab, n = ndi.label(ndi.binary_opening(stem, iterations=2))
    stem = lab == (np.argmax(ndi.sum(lab > 0, lab, range(1, n + 1))) + 1)
    cerebrum = brain & ~cere & ~stem
    lab, n = ndi.label(cerebrum)
    cerebrum = lab == (np.argmax(ndi.sum(cerebrum, lab, range(1, n + 1))) + 1)

    sp = np.array(spacing, float) / 1000.0
    idx = np.argwhere(brain)
    centre = (idx.min(0) + idx.max(0)) / 2 * sp
    meshes = {}
    for name, mask in (("cerebrum", cerebrum), ("cerebellum", cere), ("brainstem", stem)):
        v, f = surface(mask, tuple(sp))
        v = v - centre
        # (i, j, k) -> atlas (x right, y dorsal, z caudal): z = -k. That flips
        # handedness, so the triangle winding is reversed to keep normals out.
        meshes[name] = (np.stack([v[:, 0], v[:, 1], -v[:, 2]], 1), f[:, ::-1])
        print(f"{name}: {len(f)} triangles, size {np.round(np.ptp(v, 0) * 1000, 1)} mm")
    write(out, meshes)


if __name__ == "__main__":
    main(sys.argv[1])
