"""
Brain surface meshes for scripts/build-cat-visceral.ts from the "Diffusion
Tensor Imaging White Matter Atlas for the Domestic Feline" (Johnson, Barry,
Luh, Raj & Cerda-Gonzalez 2019, Cornell eCommons,
https://doi.org/10.7298/X48W3BHQ.2, CC0): skull-stripped population T1
template of 8 mesaticephalic cats (0.5 x 0.47 x 0.47 mm voxels).

    .venv/bin/python -I scripts/ct/cat_brain.py <out-base>

Downloads the population maps zip once into .cache/models/cornell-feline-atlas/.
The atlas has no grey-matter labels, so the template is split by a
marker-controlled watershed on its intensity (the dark transverse fissure and
fourth ventricle become the borders): cerebrum, cerebellum and brainstem
markers are boxes picked on the midsagittal slice. The brainstem is then
limited to the midbrain, pons and medulla (caudal to the rostral colliculi,
near the median plane); everything rostral or lateral of that (diencephalon,
piriform lobes) goes to the cerebrum.

Output (<out-base>.json + .bin, same layout as brain.py): one mesh per part in
metres, centred on the brain bounding box, oriented in the atlas frame
(x = animal's right, y = dorsal, z = caudal).
"""
import gzip
import os
import sys
import urllib.request
import zipfile

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi
from skimage.segmentation import watershed

# -I leaves the script's directory off sys.path; the helpers live next door.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from brain import surface, write  # noqa: E402

ROOT = os.path.join(os.getcwd(), ".cache", "models", "cornell-feline-atlas")
# eCommons bitstream of Johnson_etal_2019_Population_maps.zip (DSpace REST).
URL = "https://ecommons.cornell.edu/server/api/core/bitstreams/e036e1f3-83ab-4497-9aa3-7857953cea71/content"
T1 = "Johnson_etal_2019_Population_maps/T1.nii.gz"


def fetch():
    path = os.path.join(ROOT, "population_maps.zip")
    if not os.path.exists(path):
        os.makedirs(ROOT, exist_ok=True)
        print("downloading", URL)
        urllib.request.urlretrieve(URL, path)
    return zipfile.ZipFile(path)


def largest(mask):
    lab, n = ndi.label(mask)
    return lab == (np.argmax(ndi.sum(mask, lab, range(1, n + 1))) + 1)


def main(out):
    img = nib.Nifti1Image.from_bytes(gzip.decompress(fetch().read(T1)))
    t1 = np.asanyarray(img.dataobj).astype(np.float64)
    t1 /= np.quantile(t1, 0.999)
    spacing = np.array(img.header.get_zooms()[:3], float)
    # Voxel axes (checked on the slices): i = right -> left, j = dorsal ->
    # ventral, k = caudal -> rostral (olfactory bulbs at high k).
    brain = largest(t1 > 0.15)
    brain = ndi.binary_fill_holes(ndi.binary_closing(brain, iterations=2))
    I, J, K = np.indices(t1.shape)
    mid = int(round(np.argwhere(brain)[:, 0].mean()))
    markers = np.zeros(t1.shape, int)
    markers[brain & (K > 60) & (J < 40)] = 1  # cerebral hemispheres
    markers[brain & (K < 22) & (J > 18) & (J < 40)] = 2  # cerebellum
    markers[brain & (K < 40) & (J > 54) & (np.abs(I - mid) < 8)] = 3  # medulla and pons
    ws = watershed(-ndi.gaussian_filter(t1, 0.7), markers, mask=brain)
    cere = largest(ws == 2)
    stem = (ws == 3) & (K < 48) & (np.abs(I - mid) < 11)
    stem = largest(ndi.binary_opening(stem, iterations=1))
    cerebrum = largest(brain & ~cere & ~stem)
    # One voxel between the parts, so their surfaces do not coincide.
    cere &= ~ndi.binary_dilation(stem)
    cerebrum &= ~ndi.binary_dilation(cere | stem)

    sp = spacing / 1000.0
    idx = np.argwhere(brain)
    centre = (idx.min(0) + idx.max(0)) / 2 * sp
    meshes = {}
    for name, mask in (("cerebrum", cerebrum), ("cerebellum", cere), ("brainstem", stem)):
        v, f = surface(mask, tuple(sp))
        v = v - centre
        # (i, j, k) -> atlas (x right, y dorsal, z caudal) = (-i, -j, -k): a
        # reflection, so the winding is reversed to keep normals out.
        meshes[name] = (-v, f[:, ::-1])
        print(f"{name}: {len(f)} triangles, size {np.round(np.ptp(v, 0) * 1000, 1)} mm")
    write(out, meshes)


if __name__ == "__main__":
    main(sys.argv[1])
