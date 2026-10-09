"""
Splits the "Front leg of a dog" scan (Scan the World, Zenodo record 21487908,
CC BY-NC-SA 4.0) into separate bones for scripts/build-dog-skeletal.ts.

    .venv/bin/python -I scripts/ct/stw_front_leg.py          # final groups
    .venv/bin/python -I scripts/ct/stw_front_leg.py --dump   # every label

The scan is a single closed surface (radius, ulna and paw from a medical CT)
in which touching bones are fused. It is voxelised, split with the same
distance-transform watershed as greyhound_hindlimb.py and meshed again per
group of labels. Label ids were picked by eye from the dump.

Output: .cache/models/stw-dog-front-leg/out/stw.json + stw.bin (float32
positions in the scan's units, uint32 indices).
"""
import json
import os
import struct
import sys
import urllib.request

import numpy as np
from scipy import ndimage as ndi
from skimage.measure import marching_cubes
from skimage.morphology import h_maxima
from skimage.segmentation import watershed

ROOT = os.path.join(os.getcwd(), ".cache", "models", "stw-dog-front-leg")
FILE = "1ec74f6de8d9c0707df7c31ff156d708_normalized.glb"
URL = f"https://zenodo.org/api/records/21487908/files/{FILE}/content"
VOXEL = 0.13  # scan units (the leg is ~130 units long)
H = 0.15  # h-maxima depth, scan units

# Watershed label ids per exported mesh; "38>46" is label 38 above y = 46
# (the carpometacarpal level), where one label spans two bones. Scan frame:
# +y proximal, -z palmar, +x medial. Digits 2-5 are split into phalanges
# P1 (with the proximal sesamoids), P2 and P3 so the build can pose them.
GROUPS = {
    "radius": [10, 11, 15, 51, 72],
    "ulna": [12, 31, 32, 34, 35],
    "carpus": [33, 45, 46, 47, 48, 49, 50, 62, 63, 64, 70, "38>46", "58>46"],
    "accessory": [33, 46],
    "mc-1": [67, 69],
    "mc-2": ["58<46", 53, 56],
    "mc-3": [42, 44],
    "mc-4": ["38<46", 30, 37],
    "mc-5": [23],
    "dewclaw": [65, 66, 68, 71],
    "2-p1": [54, 55, 57, 59],
    "2-p2": [61],
    "2-p3": [52, 60],
    "3-p1": [39],
    "3-p2": [36],
    "3-p3": [40, 41, 43],
    "4-p1": [26, 27, 28, 29],
    "4-p2": [25],
    "4-p3": [24],
    "5-p1": [22],
    "5-p23": [17],
}


def read_glb(path):
    data = open(path, "rb").read()
    magic, _, _ = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF":
        raise ValueError("not a GLB file")
    offset, doc, binary = 12, None, None
    while offset < len(data):
        length, kind = struct.unpack_from("<I4s", data, offset)
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == b"JSON":
            doc = json.loads(chunk)
        elif kind == b"BIN\x00":
            binary = chunk
        offset += 8 + length

    def accessor(i):
        a = doc["accessors"][i]
        view = doc["bufferViews"][a["bufferView"]]
        dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[a["componentType"]]
        width = {"SCALAR": 1, "VEC3": 3}[a["type"]]
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = view.get("byteStride", 0) or np.dtype(dtype).itemsize * width
        rows = np.frombuffer(binary, np.uint8, stride * (a["count"] - 1) + np.dtype(dtype).itemsize * width, start)
        out = np.lib.stride_tricks.as_strided(rows, (a["count"], np.dtype(dtype).itemsize * width), (stride, 1))
        return np.ascontiguousarray(out).view(dtype).reshape(a["count"], width)

    pos, idx = [], []
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            if "extensions" in prim:
                raise ValueError("compressed primitives are not supported")
            p = accessor(prim["attributes"]["POSITION"]).astype(np.float64)
            i = accessor(prim["indices"]).ravel().astype(np.int64) if "indices" in prim else np.arange(len(p))
            idx.append(i.reshape(-1, 3) + sum(len(x) for x in pos))
            pos.append(p)
    return np.concatenate(pos), np.concatenate(idx)


# Inside/outside by ray parity along z for every (x, y) column of the grid.
def voxelize(pos, faces):
    lo = pos.min(0) - 2 * VOXEL
    shape = np.ceil((pos.max(0) + 2 * VOXEL - lo) / VOXEL).astype(int)
    tri = pos[faces]
    # Column centres, nudged so rays never pass exactly through vertices or edges.
    cx = lambda i: lo[0] + (i + 0.5) * VOXEL + 1.234e-5
    cy = lambda j: lo[1] + (j + 0.5) * VOXEL + 2.345e-5
    i0 = np.ceil((tri[:, :, 0].min(1) - lo[0]) / VOXEL - 0.5).astype(int)
    i1 = np.floor((tri[:, :, 0].max(1) - lo[0]) / VOXEL - 0.5).astype(int)
    j0 = np.ceil((tri[:, :, 1].min(1) - lo[1]) / VOXEL - 0.5).astype(int)
    j1 = np.floor((tri[:, :, 1].max(1) - lo[1]) / VOXEL - 0.5).astype(int)
    ni = np.maximum(i1 - i0 + 1, 0)
    nj = np.maximum(j1 - j0 + 1, 0)
    count = ni * nj
    t = np.repeat(np.arange(len(tri)), count)
    k = np.arange(count.sum()) - np.repeat(np.cumsum(count) - count, count)
    ci = i0[t] + k // nj[t]
    cj = j0[t] + k % nj[t]
    px, py = cx(ci), cy(cj)
    a, b, c = tri[t, 0], tri[t, 1], tri[t, 2]
    d = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])
    w1 = ((px - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (py - a[:, 1])) / np.where(d == 0, 1, d)
    w2 = ((b[:, 0] - a[:, 0]) * (py - a[:, 1]) - (px - a[:, 0]) * (b[:, 1] - a[:, 1])) / np.where(d == 0, 1, d)
    inside = (d != 0) & (w1 >= 0) & (w2 >= 0) & (w1 + w2 <= 1)
    z = a[:, 2] + w1 * (b[:, 2] - a[:, 2]) + w2 * (c[:, 2] - a[:, 2])
    cell = (ci * shape[1] + cj)[inside]
    z = z[inside]
    order = np.lexsort((z, cell))
    cell, z = cell[order], z[order]
    vol = np.zeros(shape, bool)
    starts = np.flatnonzero(np.r_[True, cell[1:] != cell[:-1]])
    ends = np.r_[starts[1:], len(cell)]
    for s, e in zip(starts, ends):
        if (e - s) % 2:
            continue
        i, j = divmod(int(cell[s]), shape[1])
        for za, zb in zip(z[s:e:2], z[s + 1 : e : 2]):
            ka = int(np.ceil((za - lo[2]) / VOXEL - 0.5))
            kb = int(np.floor((zb - lo[2]) / VOXEL - 0.5))
            vol[i, j, ka : kb + 1] = True
    return vol, lo


def segment():
    work = os.path.join(ROOT, "work")
    os.makedirs(work, exist_ok=True)
    cache = os.path.join(work, "labels.npz")
    if os.path.exists(cache):
        c = np.load(cache)
        return c["lab"], c["lo"]
    src = os.path.join(ROOT, FILE)
    if not os.path.exists(src):
        print("downloading", URL)
        urllib.request.urlretrieve(URL, src)
    pos, faces = read_glb(src)
    vol, lo = voxelize(pos, faces)
    d = ndi.distance_transform_edt(vol) * VOXEL
    seeds, _ = ndi.label(h_maxima(d, H))
    lab = watershed(-d, seeds, mask=vol).astype(np.int16)
    np.savez_compressed(cache, lab=lab, lo=lo)
    return lab, lo


def mesh(mask, lo):
    sl = ndi.find_objects(mask.astype(np.uint8))[0]
    a = [max(s.start - 3, 0) for s in sl]
    b = [s.stop + 3 for s in sl]
    sub = ndi.gaussian_filter(mask[a[0] : b[0], a[1] : b[1], a[2] : b[2]].astype(np.float32), 0.7)
    verts, faces, _, _ = marching_cubes(sub, 0.5, spacing=(VOXEL,) * 3)
    verts += lo + (np.array(a) + 0.5) * VOXEL
    return verts.astype(np.float32), faces.astype(np.uint32)


def export(groups, file):
    lab, lo = segment()
    out = os.path.join(ROOT, "out")
    os.makedirs(out, exist_ok=True)
    index, blobs, offset = [], [], 0
    y = lo[1] + (np.arange(lab.shape[1]) + 0.5) * VOXEL
    for name, ids in groups.items():
        mask = np.isin(lab, [i for i in ids if isinstance(i, int)])
        for spec in (i for i in ids if isinstance(i, str)):
            sign = ">" if ">" in spec else "<"
            label, level = spec.split(sign)
            side = (y > float(level)) if sign == ">" else (y <= float(level))
            mask |= (lab == int(label)) & side[None, :, None]
        if not mask.any():
            continue
        pos, faces = mesh(mask, lo)
        for arr, kind in ((pos, "position"), (faces, "index")):
            index.append({"name": name, "kind": kind, "offset": offset, "count": arr.size})
            blobs.append(arr.tobytes())
            offset += arr.nbytes
        print(f"{name}: {len(faces)} triangles")
    with open(os.path.join(out, f"{file}.bin"), "wb") as f:
        f.write(b"".join(blobs))
    with open(os.path.join(out, f"{file}.json"), "w") as f:
        json.dump(index, f)


if __name__ == "__main__":
    if "--dump" in sys.argv:
        lab, _ = segment()
        export({f"lab{i}": [int(i)] for i in np.unique(lab) if i}, "stw-dump")
    else:
        export(GROUPS, "stw")
