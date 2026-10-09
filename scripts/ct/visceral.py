"""
Organ geometry for scripts/build-dog-visceral.ts (which exports the inputs,
runs this script and writes the GLB).

    .venv/bin/python -I scripts/ct/visceral.py <work-dir>

Inputs in <work-dir> (json index + bin, same layout as greyhound_hindlimb.py):
abdomen (pixelbeaker abdomen CT, one entry per source node, source frame),
heart (pixelbeaker heart CT, merged), skeleton (our skeletal.glb, atlas frame)
and brain (scripts/ct/brain.py). Output: organs.json/.bin, one mesh per mesh id
in the atlas frame (metres, Y up, animal faces -Z, left side -X).

Abdomen CT. Source nodes were identified by position, shape and material:
Object_22 stomach contents (fundus and body), Object_24 liver (its patchy
surface also wraps the left kidney, which is cut back out), Object_11
contrast-filled blood (aorta, caudal vena cava, renal, mesenteric and iliac
vessels, kidneys; the heart remnant at the cranial cut is only used to place
the heart), Object_13-19 intestinal loops, Object_2-4 lung surface with its
airway and vessel trees, Object_7/8 ribs, vertebrae and pelvis (registration
only). Not used: Object_12 (ambiguous tube in the caudal abdomen), Object_20/21
and Object_25/26 (enhancing sheets and pieces around the stomach that could
not be told apart as spleen, pancreas, gastric wall or omentum). The spleen,
pancreas, bladder and large intestine are therefore procedural.

Registration. The CT dog lay on its back (broad, shallow chest); our skeleton
is narrow and deep, and its lumbar region is short. A single similarity
transform cannot fit both, so:
- A landmark map W sends CT positions to the skeleton: x from the half-width
  of the rib cage, y relative to the vertebral bodies from the depth of the
  thorax (L1 body to sternum), z piecewise linear through the T13/L1 level,
  the iliac crests and the acetabula (thoracic part scaled by vertebral
  length, C7 to L1).
- The vertebral column of the CT dog is arched; y is measured from the
  ventral border of its vertebral bodies and mapped onto the C7-L1 line.
- The great vessels, long and thin, go through W itself (bent along the
  spine, fidelity "modeled").
- Each other scanned organ keeps its shape: it is moved rigidly so that its centroid
  lands on W(centroid), and scaled by a per-axis factor halfway (in log space)
  between W's factors and their geometric mean, so organs follow the body
  conformation without being squashed.
- The lungs are modelled: the CT lung surface (caudal half) goes through W
  itself, is extended cranially to the thoracic inlet following the cross
  section of the rib cage, and is carved by the heart and mediastinum.

Heart: the heart CT is registered (rotation + scale, ICP) to the heart
remnant at the cranial edge of the abdomen CT, so it lands where that dog's
heart was, and then follows the same organ rule.

Brain: fitted into the cranial cavity of our skull scan (per-axis scale to
the cavity size, centred on it).

Stomach (fidelity "modeled"): the scanned fundus and body plus a modelled
pyloric part sweeping ventrally across to the scanned duodenum.

Procedural organs (fidelity "illustrative"): trachea and principal bronchi,
esophagus, pancreas, spleen, large intestine, urinary bladder, prostate and
thyroid lobes: tubes, ribbons and ellipsoids placed from skeletal landmarks
and from the scanned organs.

Skeleton landmarks used: L1, C7, manubrium (or the cranial end of a sternum
mesh), os coxae, femur, skull, and all rib meshes (one per side or one per
rib); a sternum mesh, when present, sets the floor of the thorax. The axis and
C3-C6 route the trachea and esophagus (fallback: the hyoid/larynx scan); the
sacrum and caudal vertebrae bound the pelvic canal for the rectum and anus.
"""
import json
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
from skimage.measure import marching_cubes

# --- io ---------------------------------------------------------------------


def read(base):
    index = json.load(open(base + ".json"))
    buf = open(base + ".bin", "rb").read()
    out = {}
    for e in index:
        dtype = np.float32 if e["kind"] == "position" else np.uint32
        a = np.frombuffer(buf, dtype, e["count"], e["offset"])
        out.setdefault(e["name"], {})[e["kind"]] = a.reshape(-1, 3).astype(np.float64 if dtype == np.float32 else np.int64)
    return {k: (v["position"], v["index"]) for k, v in out.items()}


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


# --- mesh helpers -----------------------------------------------------------


def weld(p, f, tol=1e-5):
    q = np.round(p / tol).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    return p[first], inv.ravel()[f]


def components(p, f, min_tris=0):
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]]])
    _, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(p), len(p))), directed=False)
    flab = lab[f[:, 0]]
    out = []
    for c, n in zip(*np.unique(flab, return_counts=True)):
        if n >= min_tris:
            out.append(compact(p, f[flab == c]))
    return sorted(out, key=lambda m: -len(m[1]))


def compact(p, f):
    v, inv = np.unique(f, return_inverse=True)
    return p[v], inv.reshape(-1, 3)


def merge(meshes):
    ps, fs, n = [], [], 0
    for p, f in meshes:
        ps.append(p)
        fs.append(f + n)
        n += len(p)
    return np.concatenate(ps), np.concatenate(fs)


def flip(m):
    return m[0], m[1][:, ::-1]


class Grid:
    """Voxel grid over a box, for turning CT surfaces into closed organs."""

    def __init__(self, lo, hi, h):
        self.h = h
        self.lo = np.asarray(lo, float) - 4 * h
        self.shape = tuple(np.ceil((np.asarray(hi, float) + 4 * h - self.lo) / h).astype(int) + 1)

    def coords(self):
        axes = [self.lo[d] + self.h * np.arange(self.shape[d]) for d in range(3)]
        return np.meshgrid(*axes, indexing="ij")

    def splat(self, p, f):
        """Marks every voxel touched by the triangles."""
        g = np.zeros(self.shape, bool)
        a, b, c = p[f[:, 0]], p[f[:, 1]], p[f[:, 2]]
        size = np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1))
        steps = np.clip(np.ceil(size / (self.h * 0.5)).astype(int), 1, 60)
        for k in np.unique(steps):
            sel = steps == k
            u, v = np.meshgrid(np.arange(k + 1), np.arange(k + 1))
            m = (u + v) <= k
            u, v = u[m] / k, v[m] / k
            pts = a[sel, None] + (b[sel] - a[sel])[:, None] * u[None, :, None] + (c[sel] - a[sel])[:, None] * v[None, :, None]
            self.mark(g, pts.reshape(-1, 3))
        return g

    def mark(self, g, pts):
        q = np.floor((pts - self.lo) / self.h).astype(int)
        ok = np.all((q >= 0) & (q < np.array(self.shape)), axis=1)
        g[tuple(q[ok].T)] = True

    def solid(self, p, f, close):
        g = self.splat(p, f)
        g = ndi.binary_closing(np.pad(g, close + 1), iterations=close)[tuple(slice(close + 1, -close - 1) for _ in range(3))]
        return ndi.binary_fill_holes(g)

    def lookup(self, g, pts):
        q = np.floor((pts - self.lo) / self.h).astype(int)
        q = np.clip(q, 0, np.array(self.shape) - 1)
        return g[tuple(q.T)]

    def surface(self, mask, sigma=1.0):
        smooth = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), sigma)
        v, f, _, _ = marching_cubes(smooth, 0.5)
        # marching_cubes winds triangles clockwise for a solid with value > level inside.
        return (v - 2) * self.h + self.lo, f[:, ::-1]


def largest(mask):
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    return lab == (np.argmax(ndi.sum(mask, lab, range(1, n + 1))) + 1)


def taubin(mesh, iters=10, lam=0.5, mu=-0.53):
    """Taubin smoothing (uniform Laplacian): removes voxel stair-steps without
    shrinking the surface."""
    from scipy.sparse import coo_matrix, diags

    p, f = mesh
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    A = coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(len(p), len(p))).tocsr()
    A.data[:] = 1.0
    L = diags(1.0 / np.maximum(np.asarray(A.sum(1)).ravel(), 1)) @ A
    p = p.copy()
    for _ in range(iters):
        p = p + lam * (L @ p - p)
        p = p + mu * (L @ p - p)
    return p, f


def main_part(mesh, keep=0.02):
    """Drops loose fragments: components smaller than `keep` of the largest."""
    parts = components(*weld(*mesh))
    big = len(parts[0][1])
    return merge([m for m in parts if len(m[1]) >= keep * big])


def tube(points, radii, sides=18, caps=True):
    """Swept circle along a polyline (parallel-transport frames)."""
    pts = np.asarray(points, float)
    r = np.broadcast_to(np.asarray(radii, float), (len(pts),))
    t = np.gradient(pts, axis=0)
    t /= np.linalg.norm(t, axis=1)[:, None]
    n = np.cross(t[0], [0.0, 1.0, 0.0] if abs(t[0][1]) < 0.9 else [1.0, 0.0, 0.0])
    n /= np.linalg.norm(n)
    rings = []
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    for i in range(len(pts)):
        n = n - t[i] * (n @ t[i])
        n /= np.linalg.norm(n)
        b = np.cross(t[i], n)
        rings.append(pts[i] + r[i] * (np.cos(ang)[:, None] * n + np.sin(ang)[:, None] * b))
    p = np.concatenate(rings)
    faces = []
    for i in range(len(pts) - 1):
        for j in range(sides):
            a, b_, c, d = i * sides + j, i * sides + (j + 1) % sides, (i + 1) * sides + j, (i + 1) * sides + (j + 1) % sides
            faces += [[a, c, b_], [b_, c, d]]
    if caps:
        p = np.concatenate([p, [pts[0], pts[-1]]])
        s, e = len(p) - 2, len(p) - 1
        last = (len(pts) - 1) * sides
        for j in range(sides):
            faces.append([s, j, (j + 1) % sides])
            faces.append([e, last + (j + 1) % sides, last + j])
    return p, np.array(faces)


def ribbon(points, width, thick, normal, sides=20):
    """Tube with an elliptical cross-section whose short axis follows
    `normal` (a flat organ such as the spleen)."""
    pts = np.asarray(points, float)
    w = np.broadcast_to(np.asarray(width, float), (len(pts),))
    th = np.broadcast_to(np.asarray(thick, float), (len(pts),))
    t = np.gradient(pts, axis=0)
    t /= np.linalg.norm(t, axis=1)[:, None]
    ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
    rings = []
    for i in range(len(pts)):
        n = np.asarray(normal, float) - t[i] * (np.asarray(normal, float) @ t[i])
        n /= np.linalg.norm(n)
        b = np.cross(t[i], n)
        rings.append(pts[i] + np.cos(ang)[:, None] * n * th[i] + np.sin(ang)[:, None] * b * w[i])
    p, f = tube(pts, 1.0, sides)
    p[: len(pts) * sides] = np.concatenate(rings)
    return p, f


def spline(ctrl, n=60):
    """Centripetal-free Catmull-Rom through control points."""
    c = np.asarray(ctrl, float)
    c = np.concatenate([[2 * c[0] - c[1]], c, [2 * c[-1] - c[-2]]])
    out = []
    for i in range(1, len(c) - 2):
        p0, p1, p2, p3 = c[i - 1], c[i], c[i + 1], c[i + 2]
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t**2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t**3))
    out.append(c[-2])
    return np.array(out)


def ellipsoid(center, radii, axes=np.eye(3), n=24):
    u, v = np.meshgrid(np.linspace(0, np.pi, n // 2 + 1), np.linspace(0, 2 * np.pi, n, endpoint=False), indexing="ij")
    unit = np.stack([np.sin(u) * np.cos(v), np.cos(u), np.sin(u) * np.sin(v)], -1).reshape(-1, 3)
    p = np.asarray(center) + (unit * radii) @ np.asarray(axes)
    rows, cols = n // 2 + 1, n
    f = []
    for i in range(rows - 1):
        for j in range(cols):
            a, b, c, d = i * cols + j, i * cols + (j + 1) % cols, (i + 1) * cols + j, (i + 1) * cols + (j + 1) % cols
            f += [[a, b, c], [b, d, c]]
    p, f = weld(p, np.array(f), 1e-9)
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    # Orient outward.
    a, b, c = p[f[:, 0]], p[f[:, 1]], p[f[:, 2]]
    if np.sum(np.cross(b - a, c - a) * ((a + b + c) / 3 - center)) < 0:
        f = f[:, ::-1]
    return p, f


# --- landmarks ----------------------------------------------------------------


def src_frame(p):
    """Abdomen CT node coordinates -> source frame: x = animal's right,
    y = dorsal, z = caudal (unknown units, about 0.15 m each)."""
    return np.stack([p[:, 2], -p[:, 1], p[:, 0]], 1)


# Measured once on the CT bones (Object_7/8) in the source frame.
SRC = {
    "mid": 0.767,  # median plane (lumbar vertebrae)
    "L1": np.array([0.767, -0.437, -1.21]),  # body of L1
    "crest": np.array([0.197, -0.509, -0.563]),  # cranial tip of the iliac wing (|dx|, y, z)
    "acet": np.array([0.157, -0.617, -0.085]),  # acetabulum
    "cage": 0.417,  # half-width of the rib cage
    "floor": -1.181,  # ventral surface of the sternum, caudal thorax
    "vertebra": 0.13,  # length of a caudal thoracic vertebra (rib-head spacing)
    # Ventral surface of the vertebral bodies along z (arched: the dog lay on
    # its back), sampled every 0.2 from the cranial cut to the hips.
    "spine_z": np.array([-2.38, -2.2, -2.0, -1.8, -1.6, -1.4, -1.2, -1.0, -0.8, -0.6, -0.4]),
    "spine_y": np.array([-0.484, -0.439, -0.401, -0.38, -0.376, -0.415, -0.483, -0.526, -0.568, -0.589, -0.576]),
}


def skeleton_landmarks(sk):
    def pts(name):
        return sk[f"dog_skeletal_{name}"][0]

    def body(name):
        q = pts(name)
        lo, hi = q[:, 1].min(), q[:, 1].max()
        return q[q[:, 1] < lo + 0.35 * (hi - lo)].mean(0)

    lm = {"L1": body("vertebra-l1"), "C7": body("vertebra-c7")}
    ox = pts("os-coxae_L")
    lm["crest"] = ox[ox[:, 2] < ox[:, 2].min() + 0.008].mean(0)
    fe = pts("femur_L")
    top = fe[fe[:, 1] > fe[:, 1].max() - 0.015]
    lm["acet"] = top[np.abs(top[:, 0]) < np.median(np.abs(top[:, 0]))].mean(0)
    # Ribs: one merged mesh per side or one mesh per rib (dog_skeletal_ribs_<n>_L/R).
    ribs = np.concatenate([m[0] for k, m in sk.items() if k.startswith("dog_skeletal_ribs")])
    lm["ribs"] = ribs
    lm["cage"] = np.abs(ribs[:, 0]).max()
    sternum = [m[0] for k, m in sk.items() if k.startswith("dog_skeletal_stern")]
    if sternum:
        lm["floor"] = np.concatenate(sternum)[:, 1].min()
    else:
        lm["floor"] = ribs[:, 1].min() - 0.022  # sternum line, as in build-dog-muscular.ts
    lm["manubrium"] = pts("manubrium").mean(0) if "dog_skeletal_manubrium" in sk else np.concatenate(sternum)[np.argmin(np.concatenate(sternum)[:, 2])]
    lm["L1_ventral"] = pts("vertebra-l1")[:, 1].min()
    lm["C7_ventral"] = pts("vertebra-c7")[:, 1].min()
    # Pecten of the pubis: cranial edge of the os coxae near the median plane.
    near = ox[np.abs(ox[:, 0]) < np.abs(ox[:, 0]).min() + 0.01]
    lm["pubis"] = near[near[:, 1] < np.quantile(near[:, 1], 0.2)].mean(0) * [0, 1, 1]
    return lm


class Warp:
    """Landmark map from the CT source frame to the atlas frame."""

    def __init__(self, a):
        s = SRC
        self.sx = a["cage"] / s["cage"]
        self.sy = (a["L1"][1] - a["floor"]) / (s["L1"][1] - s["floor"])
        k_thorax = (a["L1"][2] - a["C7"][2]) / 14 / s["vertebra"]
        zs = [s["L1"][2], s["crest"][2], s["acet"][2]]
        za = [a["L1"][2], a["crest"][2], a["acet"][2]]
        self.zs = np.array([zs[0] - 10] + zs + [zs[-1] + 10])
        tail = (za[2] - za[1]) / (zs[2] - zs[1])
        self.za = np.array([za[0] - 10 * k_thorax] + za + [za[-1] + 10 * tail])
        # y reference: the ventral border of the vertebral bodies (C7 to L1 in
        # the skeleton, continued to the level of the acetabula).
        self.a = a
        self.k_thorax = k_thorax

    def spine_src(self, z):
        return np.interp(z, SRC["spine_z"], SRC["spine_y"])

    def spine_atlas(self, z):
        a = self.a
        acet = a["acet"][1] + self.sy * (self.spine_src(SRC["acet"][2]) - SRC["acet"][1])
        return np.interp(z, [a["C7"][2], a["L1"][2], a["acet"][2]], [a["C7_ventral"], a["L1_ventral"], acet])

    def z(self, z):
        return np.interp(z, self.zs, self.za)

    def slope(self, z):
        i = np.clip(np.searchsorted(self.zs, z) - 1, 0, len(self.zs) - 2)
        return (self.za[i + 1] - self.za[i]) / (self.zs[i + 1] - self.zs[i])

    def __call__(self, p):
        p = np.atleast_2d(p)
        za = self.z(p[:, 2])
        y = self.spine_atlas(za) + self.sy * (p[:, 1] - self.spine_src(p[:, 2]))
        return np.stack([self.sx * (p[:, 0] - SRC["mid"]), y, za], 1)

    def rigid(self, p):
        """Rigid placement of a scanned organ: centroid through the warp, shape
        scaled halfway between the warp's local factors and their mean."""
        c = p.mean(0)
        local = np.array([self.sx, self.sy, self.slope(c[2])])
        mean = np.exp(np.log(local).mean())
        scale = np.sqrt(local * mean)
        target = self(c)[0]
        return lambda q: target + (np.atleast_2d(q) - c) * scale

    def place(self, mesh):
        return self.rigid(mesh[0])(mesh[0]), mesh[1]


# --- organs from the abdomen CT -------------------------------------------------


def node(src, name):
    p, f = src[name]
    return weld(src_frame(p), f)


def liver(src, kidneys):
    """Object_24 is an open, patchy surface (diaphragmatic dome, visceral
    surface, lobe edges). A strong closing turns it into a volume; the
    stomach and kidneys, which the closing swallows, are cut back out."""
    p, f = node(src, "Object_24")
    g = Grid(p.min(0), p.max(0), 0.01)
    s = largest(g.solid(p, f, 9))
    pts = np.stack([c.ravel() for c in g.coords()], 1)
    kg, km = kidneys
    s &= ~kg.lookup(ndi.binary_dilation(km, iterations=2), pts).reshape(s.shape)
    sp, sf = node(src, "Object_22")
    sg = Grid(sp.min(0), sp.max(0), 0.01)
    stomach = ndi.binary_dilation(sg.solid(sp, sf, 2), iterations=2)
    inside = np.all((pts >= sg.lo) & (pts < sg.lo + sg.h * np.array(sg.shape)), axis=1)
    s &= ~(sg.lookup(stomach, pts) & inside).reshape(s.shape)
    # The segmentation also wraps the left kidney, where no liver lobe reaches.
    X, Y, Z = g.coords()
    s &= ~((X < SRC["mid"] - 0.05) & (Z > -1.3))
    return g.surface(largest(ndi.binary_opening(s, iterations=2)), 1.2)


def kidneys_and_vessels(src):
    p, f = node(src, "Object_11")
    parts = components(p, f, 1000)
    # The largest piece runs the whole length (aorta, caudal vena cava,
    # kidneys); the other one is the heart remnant at the cranial cut.
    vp, vf = max(parts, key=lambda m: np.ptp(m[0][:, 2]))
    g = Grid(vp.min(0), vp.max(0), 0.007)
    # Each kidney is cut out of the vessel tree with a box beside the median
    # plane (aorta and caudal vena cava stay outside), then closed and filled:
    # the CT surfaces are open at the hilus.
    tri_c = vp[vf].mean(1)
    kidneys, masks = [], []
    # Boxes (source frame): left kidney at L1-L3, right kidney at T13-L2 with
    # its cranial pole against the caudate process; the renal veins and the
    # adrenal region are cut off by the box and the opening.
    for x0, x1, z0, z1 in ((SRC["mid"] - 0.37, SRC["mid"] - 0.085, -1.3, -0.8), (SRC["mid"] + 0.1, SRC["mid"] + 0.4, -1.56, -1.06)):
        box = (tri_c[:, 0] > x0) & (tri_c[:, 0] < x1) & (tri_c[:, 2] > z0) & (tri_c[:, 2] < z1) & (tri_c[:, 1] > -0.95) & (tri_c[:, 1] < -0.4)
        m = largest(g.solid(vp, vf[box], 10))
        m = largest(ndi.binary_opening(m, iterations=5))
        masks.append(m)
        kidneys.append(g.surface(m, 1.0))
    grown = np.logical_or(*masks)
    kidneys.sort(key=lambda k: k[0][:, 0].mean())  # left (smaller x) first
    # Vessels: the CT triangles outside the (dilated) kidneys.
    around = ndi.binary_dilation(grown, iterations=2)
    vessels = compact(vp, vf[~g.lookup(around, tri_c)])
    # Open-ended CT lumens: voxelise finely, close and fill, keep the tree.
    vg = Grid(vessels[0].min(0), vessels[0].max(0), 0.005)
    vm = vg.solid(*vessels, 1)
    lab, n = ndi.label(vm)
    sizes = ndi.sum(vm, lab, range(1, n + 1))
    vm = np.isin(lab, np.nonzero(sizes > 400)[0] + 1)
    vessels = taubin(main_part(vg.surface(vm, 0.8), 0.01), 6)
    return kidneys, vessels, (g, grown)


def stomach_parts(src):
    body = node(src, "Object_22")
    duo = components(*node(src, "Object_17"), 1000)
    # The intestinal piece on the far right, cranially: pyloric part and
    # descending duodenum.
    duo = max(duo, key=lambda m: m[0][:, 0].mean() - m[0][:, 2].mean())
    return body, duo


def intestine(src, h=0.006):
    """The CT loops are open wall shells with fragments: voxelised, closed and
    filled into solid loops; specks are dropped."""
    loops = []
    for name in ("Object_13", "Object_14", "Object_15", "Object_16", "Object_17", "Object_18", "Object_19"):
        loops += components(*node(src, name), 300)
    p, f = merge(loops)
    g = Grid(p.min(0), p.max(0), h)
    m = g.solid(p, f, 2)
    lab, n = ndi.label(m)
    sizes = ndi.sum(m, lab, range(1, n + 1))
    m = np.isin(lab, np.nonzero(sizes > 1500)[0] + 1)
    return taubin(main_part(g.surface(m, 0.9), 0.01), 6)


def lungs_src(src):
    """Closed lung volume: the lung surface (Object_2) is full of holes, so
    the bronchial and vascular trees inside it (Object_3/4) are added before
    closing and filling."""
    p, f = merge([node(src, n) for n in ("Object_2", "Object_3", "Object_4")])
    g = Grid(p.min(0), p.max(0), 0.01)
    return g.surface(largest(g.solid(p, f, 4)), 1.0)


def heart_fit(src, heart):
    """Rotation + scale of the heart CT onto the heart remnant of the abdomen CT."""
    rem = [m for m in components(*node(src, "Object_23"), 20000) + components(*node(src, "Object_11"), 20000) if m[0][:, 2].max() < -1.5]
    R = np.concatenate([m[0] for m in rem])
    R = R[R[:, 2] < -2.0]
    H = heart[0]
    # Heart CT: y dorsal, +z cranial; turn it to face -z (caudal = +z).
    M = np.diag([-1.0, 1.0, -1.0])
    Hm = H[::5] @ M.T
    sc = np.ptp(R[:, 0]) / np.ptp(Hm[Hm[:, 1] < np.median(Hm[:, 1])][:, 0])
    t0 = R[R[:, 1] < np.quantile(R[:, 1], 0.05)].mean(0) - sc * Hm[Hm[:, 1] < np.quantile(Hm[:, 1], 0.05)].mean(0)
    s, Rm, t = 1.0, np.eye(3), np.zeros(3)
    base = sc * Hm + t0
    for _ in range(40):
        d, j = cKDTree(s * base @ Rm.T + t).query(R)
        keep = d < np.quantile(d, 0.85)
        a, b = base[j[keep]], R[keep]
        ma, mb = a.mean(0), b.mean(0)
        U, S, Vt = np.linalg.svd((b - mb).T @ (a - ma) / len(a))
        D = np.eye(3)
        D[2, 2] = np.sign(np.linalg.det(U @ Vt))
        Rm = U @ D @ Vt
        s = (S * np.diag(D)).sum() / ((a - ma) ** 2).sum(1).mean()
        t = mb - s * Rm @ ma
    return s * (sc * (H @ M.T) + t0) @ Rm.T + t, heart[1]


def trim_heart(mesh, h=0.005):
    """One closed external heart surface with short, capped vessel roots.

    The CT heart is several nested shells (epicardium, blood pool) with gaps.
    Inside a ball around the heart the triangles are voxelised (~0.8 mm),
    closed to seal the gaps, and every internal cavity is filled; a stronger
    closing in a band just inside the ball plugs the vessel lumens where the
    ball cuts them, so the roots end in clean caps on the ball. Thin loose
    sheets and twig-like small vessels go with an opening; the surface is smoothed lightly (source frame,
    h in its units)."""
    p, f = mesh
    c = p[p[:, 1] < np.median(p[:, 1])].mean(0)
    apex = p[p[:, 1] < np.quantile(p[:, 1], 0.3)]
    R = np.linalg.norm(apex - c, axis=1).max() * 1.15
    tc = p[f].mean(1)
    sub = compact(p, f[np.linalg.norm(tc - c, axis=1) < R + 4 * h])
    g = Grid(sub[0].min(0), sub[0].max(0), h)
    shell = g.splat(*sub)
    pad = 12
    shell = np.pad(shell, pad)
    m = ndi.binary_closing(shell, iterations=2)
    X, Y, Z = (np.pad(a, pad, mode="edge") for a in g.coords())
    d = np.sqrt((X - c[0]) ** 2 + (Y - c[1]) ** 2 + (Z - c[2]) ** 2)
    band = (d > R - 14 * h) & (d < R + 2 * h)
    m |= ndi.binary_closing(shell, iterations=9) & band
    m = ndi.binary_fill_holes(m) & (d < R)
    m = largest(ndi.binary_opening(m, iterations=3))
    m = m[pad:-pad, pad:-pad, pad:-pad]
    return taubin(main_part(g.surface(m, 1.0)), 8)


def clear_of(heart, liver, gap=0.006, scale=0.9):
    """The large-breed heart, placed by the warp, reaches into the liver dome
    with its apex. Shrink it about its base (to a vertebral heart score close
    to 10 on this skeleton) and move it cranially until the diaphragm fits
    between apex and liver; it stays within ribs 3-6."""
    p, f = heart
    base = p[p[:, 1] > np.quantile(p[:, 1], 0.7)].mean(0)
    p = base + (p - base) * scale
    tree = cKDTree(liver)
    for dz in np.arange(0, 0.05, 0.001):
        if tree.query(p - [0, 0, dz])[0].min() > gap:
            return p - [0, 0, dz], f
    return p - [0, 0, 0.05], f


def outward(mesh):
    p, f = mesh
    a, b, c = p[f[:, 0]], p[f[:, 1]], p[f[:, 2]]
    vol = np.sum(np.einsum("ij,ij->i", a, np.cross(b, c)))
    return mesh if vol > 0 else flip(mesh)


# --- lungs (modelled) -----------------------------------------------------------


def cage_profile(lm):
    """Half-width, dorsal and ventral limits of the thoracic cavity along z."""
    ribs = lm["ribs"]
    z0, z1 = ribs[:, 2].min(), lm["L1"][2]
    zs = np.arange(z0, z1 + 0.005, 0.005)
    hw = np.full(len(zs), np.nan)
    for i, z in enumerate(zs):
        sl = ribs[np.abs(ribs[:, 2] - z) < 0.006]
        if len(sl) > 20:
            hw[i] = np.abs(sl[:, 0]).max()
    ok = ~np.isnan(hw)
    hw = np.interp(zs, zs[ok], hw[ok])
    # Ribs slope caudoventrally, so one z slab only cuts part of each rib:
    # take the running maximum over neighbouring slabs, then smooth.
    hw = ndi.maximum_filter1d(hw, 11)
    hw = ndi.uniform_filter1d(hw, 7)
    t = (zs - lm["C7"][2]) / (lm["L1"][2] - lm["C7"][2])
    top = lm["C7_ventral"] + t * (lm["L1_ventral"] - lm["C7_ventral"])
    tm = np.clip((zs - lm["manubrium"][2]) / (lm["L1"][2] - 0.05 - lm["manubrium"][2]), 0, 1)
    floor = lm["manubrium"][1] - 0.01 + tm * (lm["floor"] - lm["manubrium"][1] + 0.01)
    return zs, hw, top, floor


def build_lungs(src, warp, lm, heart):
    p, f = lungs_src(src)
    p = warp(p)
    h = 0.0018
    zs, hw, top, floor = cage_profile(lm)
    lo = np.minimum([-hw.max(), floor.min(), zs[0]], p.min(0)) - 0.01
    hi = np.maximum([hw.max(), top.max(), zs[-1]], p.max(0)) + 0.01
    g = Grid(lo, hi, h)
    s = g.solid(p, f, 1)
    X, Y, Z = g.coords()
    # Cranial extension: copy the most cranial full CT slice forward to the
    # thoracic inlet, rescaled to the rib cage cross-section at each level.
    zi = np.nonzero(s.any(axis=(0, 1)))[0]
    k0 = zi.min() + 3
    cut = s[:, :, k0]
    z_cut = g.lo[2] + k0 * g.h
    z_apex = lm["ribs"][:, 2].min() - 0.008
    w_cut, t_cut, f_cut = np.interp(z_cut, zs, hw), np.interp(z_cut, zs, top), np.interp(z_cut, zs, floor)
    xs = g.lo[0] + g.h * np.arange(g.shape[0])
    ys = g.lo[1] + g.h * np.arange(g.shape[1])
    for k in range(k0 - 1, -1, -1):
        z = g.lo[2] + k * g.h
        if z < z_apex:
            break
        u = (z - z_apex) / (z_cut - z_apex)
        taper = np.sqrt(np.clip(u, 0, 1)) * 0.75 + 0.25
        w = np.interp(z, zs, hw) / w_cut * taper
        tp, fl = np.interp(z, zs, top), np.interp(z, zs, floor)
        d = (tp - fl) / (t_cut - f_cut) * (0.55 + 0.45 * taper)
        # Inverse map: atlas (x, y) at this level -> (x, y) on the cut slice.
        sx = xs / w
        sy = t_cut - (tp - ys) / d
        ix = np.clip(np.round((sx - g.lo[0]) / g.h).astype(int), 0, g.shape[0] - 1)
        iy = np.clip(np.round((sy - g.lo[1]) / g.h).astype(int), 0, g.shape[1] - 1)
        inside_x = np.abs(sx) <= np.abs(xs).max()
        sl = cut[np.ix_(ix, iy)] & inside_x[:, None] & ((sy >= g.lo[1]) & (sy <= hi[1]))[None, :]
        s[:, :, k] |= sl
    # Stay inside the rib cage and off the median plane (mediastinum).
    W = np.interp(Z, zs, hw) - 0.002
    s &= (np.abs(X) < W) & (np.abs(X) > 0.0035)
    s &= ~((np.abs(X) < 0.013) & (Y > np.interp(Z, zs, top) - 0.003))  # vertebral bodies
    s &= Y < lm["ribs"][:, 1].max() + 0.004  # no higher than the rib heads
    # Carve the heart (with a little pericardial space).
    hg = g.solid(heart[0], heart[1], 2)
    s &= ~ndi.binary_dilation(hg, iterations=2)
    left = largest(s & (X < 0))
    right = largest(s & (X > 0))
    return g.surface(left, 1.2), g.surface(right, 1.2)


# --- brain ----------------------------------------------------------------------


def brain_in_skull(brain, skull):
    p, f = skull
    h = 0.0015
    g = Grid(p.min(0), p.max(0), h)
    shell = g.splat(p, f)
    shell = ndi.binary_dilation(shell, iterations=1)
    # Seal foramina with a closing, then the cranial cavity is the largest
    # enclosed void in the caudal half of the skull.
    sealed = ndi.binary_closing(np.pad(shell, 8), iterations=7)[8:-8, 8:-8, 8:-8]
    filled = ndi.binary_fill_holes(sealed)
    void = filled & ~sealed
    Z = g.coords()[2]
    void &= Z > p[:, 2].min() + 0.45 * np.ptp(p[:, 2])
    cav = largest(ndi.binary_opening(void, iterations=2))
    q = np.argwhere(cav) * h + g.lo
    c_lo, c_hi = q.min(0), q.max(0)
    allp = np.concatenate([m[0] for m in brain.values()])
    b_lo, b_hi = allp.min(0), allp.max(0)
    size = (c_hi - c_lo) / (b_hi - b_lo)
    mean = np.exp(np.log(size).mean())
    scale = np.clip(size, mean * 0.85, mean * 1.15) * 0.97
    centre = (c_lo + c_hi) / 2
    bc = (b_lo + b_hi) / 2
    out = {k: ((m[0] - bc) * scale + centre, m[1]) for k, m in brain.items()}
    return out, (c_lo, c_hi)


# --- modelled and procedural organs -------------------------------------------------


def pylorus(duo):
    p = duo[0]
    return p[p[:, 2] < p[:, 2].min() + 0.03].mean(0)


def stomach_mesh(body, duo):
    """Scanned fundus and body (CT contents) plus a modelled pyloric part that
    sweeps ventrally across to the duodenum (source frame)."""
    p, f = body
    end = pylorus(duo)
    low = p[p[:, 1] < np.quantile(p[:, 1], 0.15)].mean(0)
    start = p.mean(0) * 0.4 + low * 0.6
    ctrl = [start, [SRC["mid"] - 0.05, low[1] - 0.16, (start[2] + end[2]) / 2 + 0.12], [SRC["mid"] + 0.12, low[1] - 0.12, end[2] + 0.08], end]
    path = spline(ctrl, 30)
    radii = np.linspace(0.13, 0.055, len(path))
    allp = np.concatenate([p, path - 0.15, path + 0.15])
    g = Grid(allp.min(0), allp.max(0), 0.008)
    s = g.solid(p, f, 2)
    X, Y, Z = g.coords()
    for q, r in zip(path[::2], radii[::2]):
        s |= (X - q[0]) ** 2 + (Y - q[1]) ** 2 + (Z - q[2]) ** 2 < r * r
    return g.surface(ndi.binary_closing(s, iterations=3), 1.5)


def ventral_body(q):
    """Ventral point of a vertebral body on the median plane."""
    near = q[np.abs(q[:, 0]) < 0.008]
    lo = near[:, 1].min()
    return near[near[:, 1] < lo + 0.004].mean(0) * [0, 1, 1]


def pelvic_canal(sk, z):
    """Centre of the pelvic canal at z: midway between the dorsal surface of
    the pelvic floor and the ventral surface of the sacrum or caudal vertebrae."""
    ox = np.concatenate([m[0] for k, m in sk.items() if k.startswith("dog_skeletal_os-coxae")])
    roof = np.concatenate([m[0] for k, m in sk.items() if k.startswith("dog_skeletal_sacrum") or k.startswith("dog_skeletal_vertebrae-caudal")])
    r = roof[(np.abs(roof[:, 2] - z) < 0.006) & (np.abs(roof[:, 0]) < 0.012)]
    f = ox[(np.abs(ox[:, 2] - z) < 0.006) & (np.abs(ox[:, 0]) < 0.012)]
    top = r[:, 1].min() if len(r) else None
    bottom = f[:, 1].max() if len(f) else None
    if top is None or bottom is None or top - bottom < 0.01:
        return None
    return np.array([0.0, (top + bottom) / 2, z])


def procedural(lm, out, sk, pyl):
    res = {}
    vert = (lm["L1"][2] - lm["C7"][2]) / 14
    T = lambda n: lm["C7"][2] + n * vert  # z of thoracic vertebra n (body centre)
    zs, hw, top, floor = cage_profile(lm)
    spine = lambda z: np.interp(z, zs, top)

    # Trachea: from the cricoid (level of the axis) down the neck ventral to
    # the cervical vertebral bodies, through the thoracic inlet between C7 and
    # the manubrium, to the bifurcation at T5; then the principal bronchi.
    # The esophagus runs between the trachea and the vertebrae, shifting to the
    # left of the trachea in the caudal neck.
    inlet = np.array([0, (lm["C7_ventral"] + lm["manubrium"][1]) / 2 + 0.004, lm["manubrium"][2] - 0.004])
    carina = np.array([0.0, spine(T(5)) - 0.026, T(5)])
    names = ["axis"] + [f"vertebrae-cervical_c{i}" for i in range(3, 7)]
    neck = [ventral_body(sk[f"dog_skeletal_{n}"][0]) for n in names if f"dog_skeletal_{n}" in sk]
    if len(neck) >= 3:
        neck_t = [q + [0, -0.023, 0] for q in neck]
        neck_e = [q + [-0.0015 * i, -0.0095, 0] for i, q in enumerate(neck)]
    else:  # cervical vertebrae not in the skeleton yet: start at the larynx scan
        hy = sk["dog_skeletal_hyoid"][0]
        larynx = hy[hy[:, 2] > hy[:, 2].max() - 0.008].mean(0) * [0, 1, 1]
        neck_t = [larynx, (larynx + inlet) / 2 + [0, 0.004, 0]]
        neck_e = [larynx + [0, 0.012, -0.006], (larynx + inlet) / 2 + [-0.008, 0.012, 0]]
    path = spline(neck_t + [inlet, (inlet + carina) / 2 + [0, 0.002, 0], carina], 16)
    trachea = [tube(path, 0.0075, 20)]
    for side in (-1, 1):
        b = spline([carina, carina + [side * 0.010, -0.006, 0.012], carina + [side * 0.020, -0.012, 0.028]], 8)
        trachea.append(tube(b, 0.0048, 14))
    res["dog.visceral.trachea"] = merge(trachea)

    # Thyroid lobes beside the first tracheal rings.
    for side, key in ((-1, "L"), (1, "R")):
        i = int(len(path) * 0.18)
        d = path[i + 2] - path[i - 2]
        d /= np.linalg.norm(d)
        lat = np.array([side * 1.0, 0, 0])
        y = np.cross(d, lat) * side
        c = path[i] + lat * 0.0105 + y * 0.002
        res[f"dog.visceral.thyroid.{key}"] = ellipsoid(c, [0.0032, 0.011, 0.0045], np.array([lat, d, np.cross(lat, d)]), 16)

    # Esophagus: dorsal to the larynx, left-dorsal to the trachea in the neck
    # and at the inlet, dorsal to the bifurcation, through the hiatus (T11) to
    # the cardia.
    stomach = out["dog.visceral.stomach"][0]
    hiatus = np.array([-0.004, spine(T(11)) - 0.03, T(11)])
    cardia = stomach[np.argmin(np.linalg.norm(stomach - (hiatus + [0, 0, 0.02]), axis=1))]
    path_e = spline(neck_e + [
        inlet + [-0.007, 0.011, 0.004],
        carina + [-0.002, 0.016, 0],
        [-0.003, spine(T(8)) - 0.022, T(8)],
        hiatus,
        cardia + (hiatus - cardia) * 0.1,
    ], 14)
    res["dog.visceral.esophagus"] = tube(path_e, 0.0055, 16)

    # Pancreas: body at the pylorus, right lobe along the descending duodenum
    # (ventral to the right kidney), left lobe caudal to the stomach towards
    # the left kidney and spleen.
    kl = out["dog.visceral.kidneys.L"][0]
    kr = out["dog.visceral.kidneys.R"][0]
    pyl = pyl + [0.0, -0.01, 0.008]  # body of the pancreas: caudoventral to the pylorus
    right = spline([pyl + [-0.004, 0.004, 0.004], [kr[:, 0].mean() + 0.006, kr[:, 1].min() - 0.004, kr[:, 2].mean()], [kr[:, 0].mean() + 0.004, kr[:, 1].min() - 0.002, kr[:, 2].max() + 0.01]], 12)
    left = spline([pyl + [-0.006, 0.004, 0.004], [-0.004, kl[:, 1].min() + 0.004, kl[:, 2].min() - 0.004], [kl[:, 0].mean(), kl[:, 1].min() + 0.012, kl[:, 2].min() + 0.004]], 12)
    res["dog.visceral.pancreas"] = merge([tube(right, np.linspace(0.006, 0.004, len(right)), 14), tube(left, np.linspace(0.0065, 0.0045, len(left)), 14)])

    # Spleen: head lateral to the left kidney's cranial pole, caudal to the
    # fundus; body down the left flank along the greater curvature; tail on
    # the ventral floor, caudal to the stomach.
    head = np.array([min(stomach[:, 0].min(), kl[:, 0].min()) + 0.007, kl[:, 1].max() - 0.004, kl[:, 2].min() + 0.004])
    tail = np.array([-0.012, stomach[:, 1].min() + 0.004, stomach[:, 2].max() + 0.012])
    mid = np.array([head[0] + 0.002, (head[1] + tail[1]) / 2, (head[2] + tail[2]) / 2 - 0.008])
    path_s = spline([head, mid, tail], 14)
    u = np.linspace(0, 1, len(path_s))
    width = 0.014 * np.sin(np.pi * (0.08 + 0.84 * u)) ** 0.6
    res["dog.visceral.spleen"] = ribbon(path_s, width, 0.0045 * np.sin(np.pi * (0.08 + 0.84 * u)) ** 0.5, [1.0, 0.0, 0.0])

    # Large intestine: cecum and ascending colon on the right, transverse colon
    # cranial to the root of the mesentery, descending colon on the left, then
    # rectum through the pelvic inlet to the anus below the tail.
    ox = sk["dog_skeletal_os-coxae_L"][0]
    xr, xl = kr[:, 0].mean(), kl[:, 0].mean()
    y_mid = (kr[:, 1].min() + kl[:, 1].min()) / 2 - 0.02
    y_pelvis = lm["pubis"][1] + 0.022
    # Rectum through the middle of the pelvic canal; anus below the tail base,
    # just caudal to the ischial arch and ventral to the first caudal vertebrae.
    z_in, z_out = lm["pubis"][2] - 0.012, ox[:, 2].max() + 0.012
    canal = [pelvic_canal(sk, z) for z in np.linspace(lm["pubis"][2] - 0.004, ox[:, 2].max() - 0.004, 6)]
    canal = [c for c in canal if c is not None]
    tail = [m[0] for k, m in sk.items() if k.startswith("dog_skeletal_vertebrae-caudal")]
    if len(canal) >= 2 and tail:
        y_pelvis = canal[0][1]
        tail = np.concatenate(tail)
        near = tail[np.abs(tail[:, 2] - z_out) < 0.01]
        anus = [0.0, min(canal[-1][1] - 0.006, near[:, 1].min() - 0.012), z_out]
        rectum = [[-0.003, y_pelvis, z_in]] + canal + [anus]
    else:  # skeleton without a scanned sacrum and tail
        rectum = [[-0.004, y_pelvis, z_in], [0.0, y_pelvis, z_out]]
    ileocolic = np.array([xr * 0.5, y_mid - 0.006, kr[:, 2].max() - 0.008])
    y_desc = lm["L1_ventral"] - 0.03  # ventral to the sublumbar muscles
    colon = spline([
        ileocolic,
        [xr * 0.75, y_mid + 0.004, kr[:, 2].mean() - 0.008],
        [xl * 0.75, y_mid + 0.012, kl[:, 2].min() + 0.002],
        [xl * 0.8, y_desc, kl[:, 2].max() + 0.008],
        [-0.01, (y_desc + y_pelvis) / 2, lm["crest"][2] + 0.012],
    ] + rectum, 12)
    cecum = spline([ileocolic, ileocolic + [0.004, -0.006, 0.010], ileocolic + [-0.003, -0.010, 0.016], ileocolic + [-0.006, -0.006, 0.020]], 8)
    radii = np.full(len(colon), 0.0085)
    radii[-30:] = np.linspace(0.0085, 0.006, 30)
    res["dog.visceral.large-intestine"] = merge([tube(colon, radii, 18), tube(cecum, np.linspace(0.0075, 0.005, len(cecum)), 14)])

    # Urinary bladder (moderately full) cranial to the pubis, prostate around
    # the neck at the pelvic inlet.
    neck = np.array([0.0, lm["pubis"][1] + 0.006, lm["pubis"][2] - 0.016])
    axis = np.array([0, -0.5, -1.0])
    axis /= np.linalg.norm(axis)
    up = np.cross(axis, [1, 0, 0])
    res["dog.visceral.urinary-bladder"] = merge([
        ellipsoid(neck + axis * 0.04, [0.019, 0.017, 0.030], np.array([[1, 0, 0], up, axis]), 28),
        tube(spline([neck + axis * 0.012, neck + [0, 0, 0.012]], 4), 0.004, 12),
    ])
    res["dog.visceral.prostate"] = ellipsoid(neck + [0, 0.001, 0.008], [0.011, 0.009, 0.010], np.eye(3), 20)
    return res


def main(work):
    src = read(os.path.join(work, "abdomen"))
    sk = read(os.path.join(work, "skeleton"))
    lm = skeleton_landmarks(sk)
    warp = Warp(lm)
    print(f"warp: sx {warp.sx:.3f} sy {warp.sy:.3f} sz thorax {warp.k_thorax:.3f} lumbar {warp.slope(-1.0):.3f} pelvis {warp.slope(-0.3):.3f}")
    out = {}

    kidneys, vessels, kmask = kidneys_and_vessels(src)
    out["dog.visceral.liver"] = warp.place(liver(src, kmask))

    out["dog.visceral.kidneys.L"] = warp.place(kidneys[0])
    out["dog.visceral.kidneys.R"] = warp.place(kidneys[1])
    # Long and thin, so it follows the warp itself (bent along the spine).
    out["dog.visceral.great-vessels"] = (warp(vessels[0]), vessels[1])

    body, duo = stomach_parts(src)
    gut = intestine(src)
    to_gut = warp.rigid(gut[0])
    out["dog.visceral.small-intestine"] = (to_gut(gut[0]), gut[1])
    pyl = to_gut(pylorus(duo))[0]

    heart = read(os.path.join(work, "heart"))["all"]
    heart = trim_heart(outward(heart_fit(src, weld(*heart))))
    out["dog.visceral.heart"] = clear_of(warp.place(heart), out["dog.visceral.liver"][0])

    lungs = build_lungs(src, warp, lm, out["dog.visceral.heart"])
    out["dog.visceral.lungs.L"], out["dog.visceral.lungs.R"] = (main_part(m) for m in lungs)

    stomach = stomach_mesh(body, duo)
    out["dog.visceral.stomach"] = warp.place(stomach)

    brain = read(os.path.join(work, "brain"))
    placed, _ = brain_in_skull(brain, sk["dog_skeletal_skull"])
    for k, m in placed.items():
        out[f"dog.visceral.brain.{k}"] = m

    out.update(procedural(lm, out, sk, pyl))
    for k, m in out.items():
        out[k] = outward(m)
        print(f"{k}: {len(m[1])} triangles, centre {np.round(m[0].mean(0), 3)}, size {np.round(np.ptp(m[0], 0), 3)}")
    write(os.path.join(work, "organs"), out)


if __name__ == "__main__":
    main(sys.argv[1])
