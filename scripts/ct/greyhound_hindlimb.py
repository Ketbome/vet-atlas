"""
Extracts bone meshes from the "greyhound pelvic limb CT scan" (John
Hutchinson, figshare 7240520, CC BY 4.0) for scripts/build-dog-skeletal.ts.

    .venv/bin/python -I scripts/ct/greyhound_hindlimb.py            # final groups
    .venv/bin/python -I scripts/ct/greyhound_hindlimb.py --dump toknee   # every label

Downloads the zip (~500 MB) into .cache/models/greyhound-ct/, thresholds bone,
splits touching bones with a distance-transform watershed and runs marching
cubes on groups of watershed labels. The label ids below were picked by eye
from the dumps; they are stable because input and parameters are fixed.

Output per series: .cache/models/greyhound-ct/out/<series>.json (mesh index)
and <series>.bin (float32 positions in patient mm, uint32 indices).
"""
import glob
import json
import os
import sys
import urllib.request
import zipfile

import numpy as np
import pydicom
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from skimage.morphology import h_maxima
from skimage.segmentation import watershed

ROOT = os.path.join(os.getcwd(), ".cache", "models", "greyhound-ct")
URL = "https://ndownloader.figshare.com/files/13328678"

# folder, threshold (HU), h-maxima depth (mm)
SERIES = {
    "ankledown": ("Greyhound hindlimb ankle down", 450, 0.5),
    "toknee": ("greyhound hindlimb hip to knee", 300, 0.7),
    "toankle": ("Greyhound hindlimb knee to ankle", 300, 0.7),
}

# Watershed label ids per exported mesh. ankledown (series HL3, 0.27 mm) is
# the distal limb; digits are a..d from lateral (V) to medial (II), each split
# into P1 (with its proximal sesamoids), P2 and P3 so the build can pose them.
GROUPS = {
    "ankledown": {
        "tibia": [44],
        "fibula": [43],
        "tarsus": [31, 32, 33, 34, 35, 36, 38, 39, 40, 41, 42, 45],
        "tuber": [45],
        "mt-a": [25, 28, 29],
        "mt-b": [21],
        "mt-c": [23],
        "mt-d": [30],
        "a-p1": [17, 19, 20, 24],
        "a-p23": [10],
        "b-p1": [12, 14, 15],
        "b-p2": [6],
        "b-p3": [1, 4],
        "c-p1": [13, 16, 18],
        "c-p2": [7],
        "c-p3": [2, 3, 5],
        "d-p1": [22, 26, 27],
        "d-p2": [11],
        "d-p3": [8, 9],
    },
    # Series HL1: pelvis to stifle, with the sacrum and caudal vertebrae 1-15.
    "toknee": {
        "sacrum": [22, 24, 25, 26, 27, 28],
        "os-coxae": [9, 29, 37, 46, 47],
        "femur": [49, 62],
        "patella": [57, 59, 60],
        "cd1": [30],
        "cd2": [31],
        "cd3": [34],
        "cd4": [35],
        "cd5": [38],
        "cd6": [44, 45, 50],
        "cd7": [51, 53],
        "cd8": [54],
    },
    # Series HL1B: stifle to tarsus; the tail lies along the limb down to its
    # tip. The tail moved between series, so these are registered onto HL1 with
    # the caudal vertebrae both series share (MATCH).
    "toankle": {
        "tibia": [12, 27, 31],
        "cd9": [2],
        "cd10": [3],
        "cd11": [7],
        "cd12": [11, 14],
        "cd13": [17, 18, 20],
        "cd14": [22],
        "cd15": [23],
        "cd16": [24],
        "cd17": [26],
        "cd18": [28],
        "cd19": [29],
    },
}

# toankle label ids -> toknee label ids of the same caudal vertebra (Cd9-Cd15).
MATCH = [([2], [55]), ([3], [56]), ([7], [58, 64]), ([11, 14], [65]), ([17, 18, 20], [67, 70]), ([22], [73]), ([23], [75, 76])]


def fetch():
    raw = os.path.join(ROOT, "raw")
    if os.path.isdir(raw):
        return raw
    os.makedirs(ROOT, exist_ok=True)
    zpath = os.path.join(ROOT, "greyhound.zip")
    if not os.path.exists(zpath):
        print("downloading", URL)
        urllib.request.urlretrieve(URL, zpath)
    with zipfile.ZipFile(zpath) as z:
        for member in z.namelist():
            if member.endswith(".dcm") or member.endswith("/"):
                target = os.path.realpath(os.path.join(raw, member))
                if not target.startswith(os.path.realpath(raw)):
                    raise ValueError(f"unsafe path in zip: {member}")
        z.extractall(raw)
    return raw


def load(key):
    work = os.path.join(ROOT, "work")
    os.makedirs(work, exist_ok=True)
    cache = os.path.join(work, f"{key}.npz")
    if os.path.exists(cache):
        c = np.load(cache)
        return c["vol"], tuple(c["sp"]), tuple(c["origin"])
    folder = SERIES[key][0]
    files = glob.glob(os.path.join(fetch(), "greyhound pelvic limb CT scans", folder, "*.dcm"))
    dss = sorted((pydicom.dcmread(f) for f in files), key=lambda d: -float(d.ImagePositionPatient[2]))
    vol = (np.stack([d.pixel_array for d in dss]).astype(np.int16) * int(dss[0].RescaleSlope) + int(dss[0].RescaleIntercept)).astype(np.int16)
    px = float(dss[0].PixelSpacing[0])
    dz = float(dss[0].ImagePositionPatient[2]) - float(dss[1].ImagePositionPatient[2])
    origin = tuple(float(x) for x in dss[0].ImagePositionPatient)
    sp = (dz, px, px)
    np.savez(cache, vol=vol, sp=sp, origin=origin)
    return vol, sp, origin


def segment(key):
    cache = os.path.join(ROOT, "work", f"{key}-labels.npy")
    vol, sp, origin = load(key)
    if os.path.exists(cache):
        return np.load(cache), sp, origin
    _, t, h = SERIES[key]
    voxel = sp[0] * sp[1] * sp[2]
    lab, _ = ndi.label(vol > t)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    m = np.isin(lab, np.where(sizes * voxel > 200)[0])
    for z in range(m.shape[0]):
        m[z] = ndi.binary_fill_holes(m[z])
    d = ndi.distance_transform_edt(m, sampling=sp)
    seeds, _ = ndi.label(h_maxima(d, h))
    lab = watershed(-d, seeds, mask=m).astype(np.int16)
    np.save(cache, lab)
    return lab, sp, origin


def mesh(mask, sp, origin):
    sl = ndi.find_objects(mask.astype(np.uint8))[0]
    lo = [max(s.start - 3, 0) for s in sl]
    hi = [s.stop + 3 for s in sl]
    sub = mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].astype(np.float32)
    sub = ndi.gaussian_filter(sub, sigma=(0.6 * sp[1] / sp[0], 0.6, 0.6))
    verts, faces, _, _ = marching_cubes(sub, 0.5, spacing=sp)
    # voxel (k, r, c) -> patient (x, y, z) in mm; slices run toward -z
    k = verts[:, 0] + lo[0] * sp[0]
    r = verts[:, 1] + lo[1] * sp[1]
    c = verts[:, 2] + lo[2] * sp[2]
    pos = np.stack([origin[0] + c, origin[1] + r, origin[2] - k], axis=1).astype(np.float32)
    # z is flipped, so flip winding to keep outward normals
    return pos, faces[:, ::-1].astype(np.uint32)


def centroid(lab, ids, sp, origin):
    k, r, c = np.argwhere(np.isin(lab, ids)).mean(axis=0)
    return np.array([origin[0] + c * sp[2], origin[1] + r * sp[1], origin[2] - k * sp[0]])


# Rigid transform (Kabsch) that maps the toankle tail onto the toknee tail.
def registration():
    a, spa, oa = segment("toankle")
    b, spb, ob = segment("toknee")
    p = np.array([centroid(a, i, spa, oa) for i, _ in MATCH])
    q = np.array([centroid(b, j, spb, ob) for _, j in MATCH])
    pc, qc = p.mean(0), q.mean(0)
    u, _, vt = np.linalg.svd((p - pc).T @ (q - qc))
    d = np.sign(np.linalg.det(vt.T @ u.T))
    rot = vt.T @ np.diag([1, 1, d]) @ u.T
    err = np.linalg.norm((p - pc) @ rot.T + qc - q, axis=1)
    print(f"toankle -> toknee tail registration: mean error {err.mean():.1f} mm")
    return rot, qc - pc @ rot.T


def export(key, groups, file=None):
    lab, sp, origin = segment(key)
    rot, shift = registration() if key == "toankle" and file is None else (np.eye(3), np.zeros(3))
    out = os.path.join(ROOT, "out")
    os.makedirs(out, exist_ok=True)
    index, blobs, offset = [], [], 0
    for name, ids in groups.items():
        mask = np.isin(lab, ids)
        if not mask.any():
            continue
        pos, faces = mesh(mask, sp, origin)
        pos = (pos @ rot.T + shift).astype(np.float32)
        for arr, kind in ((pos, "position"), (faces, "index")):
            b = arr.tobytes()
            index.append({"name": name, "kind": kind, "offset": offset, "count": arr.size})
            blobs.append(b)
            offset += len(b)
        print(f"{key} {name}: {len(faces)} triangles")
    file = file or key
    with open(os.path.join(out, f"{file}.bin"), "wb") as f:
        for b in blobs:
            f.write(b)
    with open(os.path.join(out, f"{file}.json"), "w") as f:
        json.dump(index, f)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--dump":
        key = sys.argv[2]
        lab, _, _ = segment(key)
        export(key, {f"lab{i}": [int(i)] for i in np.unique(lab) if i}, f"{key}-dump")
    else:
        for key, groups in GROUPS.items():
            export(key, groups)
