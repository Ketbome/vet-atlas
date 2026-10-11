"""
Organ geometry for scripts/build-cat-visceral.ts (which exports the inputs,
runs this script and writes the GLB).

    .venv/bin/python -I scripts/ct/cat_visceral.py <work-dir>

Inputs in <work-dir> (json index + bin, same layout as greyhound_hindlimb.py):
source (pixelbeaker feline CT, one entry per source node named
"<material>/<node>", millimetres), skeleton (our skeletal.glb, atlas frame)
and brain (scripts/ct/cat_brain.py). Output: organs.json/.bin, one mesh per
mesh id in the atlas frame (metres, Y up, animal faces -Z, left side -X).

Feline CT. The cat lay on its back; node x runs cranial -> caudal, y ventral
-> dorsal, z right -> left (the caudal vena cava lies right of the aorta, the
right kidney is the cranial one and the stomach, spleen and descending colon
are on the +z side). Materials as used here:
- Liver: every node except Object_19 (liver lobes, gall bladder, the hepatic
  vessels inside). Object_19, a band caudal to the stomach running from the
  pylorus to the left kidney and the spleen, is the body and left lobe of the
  pancreas; its right lobe (not segmented) is modelled along the descending
  duodenum.
- Pancreas: by shape and position this material is the spleen (dorsal
  extremity at the fundus, body and tail down the left flank along the
  greater curvature); it is used as the spleen.
- Stomach: stomach with the abdominal esophagus (cut off at the cardia; it
  is collapsed flat, so only its course guides the modelled esophagus) and the descending duodenum (cut off caudal
  to the pyloric part, it goes to the small intestine).
- Kidneys, Bladder: as named.
- Intestines: thin, open shells. Filled slice by slice (a voxel is inside
  when its contour closes in at least two of the three slice directions),
  then split: the large intestine is the union of the maximal balls of the
  thick part of the tube (radius >= 3.5 mm: colon and rectum, a hairpin on
  the left); the rest is small intestine.
- Blood_Volume: Object_15 (aorta, caudal vena cava, renal and iliac vessels,
  trimmed at the pelvic inlet) is the abdominal part of the great vessels;
  the portal, mesenteric, splenic and hepatic trees are not used.
- Skin: not used (no bones in the CT); its outline set the scale factors.

Registration. The source has no skeleton, so a landmark map W sends the
oriented CT (x right, y dorsal, z caudal, mm) to the atlas: z is linear with
unit scale through the origin of the celiac artery (L1; the aortic
bifurcation then lands at L6/L7 and the bladder neck at the pecten of the
pubis, as in a cat); y maps the depth from the dorsal border of the aorta
(the ventral line of the vertebral bodies) to the ventral wall onto the depth
from our vertebral bodies to the line xiphoid-pecten; x is scaled by the
ratio of the abdominal cavity (CT skin outline minus the body wall) to our
rib cage and eased into the cavity half-width (rib cage sections, then the
flank). W is one to one, so the organs keep their CT topography and do not
run into each other; touching organs are separated by two voxels before
meshing (priority: kidneys, great vessels, spleen, stomach, esophagus,
liver, large intestine, small intestine, pancreas, bladder). Whatever still
runs into bone is cut away.

Brain: fitted into the cranial cavity of our skull scan (the space enclosed
by bone in most directions): principal axes of the cavity, its volume (shared
between the axes by their extents), then the pitch, shift and size that keep
most of the template inside it, then cut
to the cavity with a small gap, so it follows the bony tentorium.

Procedural organs (fidelity "illustrative"), built from skeletal landmarks
and the scanned organs: heart (feline proportions, long axis tilted towards
the sternum, base ventral to the tracheal bifurcation at T4-T5, apex on the
sternum at the 6th costal cartilage, left of the median plane), lungs (the
rib cage sections from a rounded cupula at the first rib to the
diaphragmatic surface of the liver, stomach and spleen, carved by the heart
with cardiac notches, the mediastinum, airways, esophagus and great
vessels), trachea and principal bronchi, esophagus (one tube to the cardia
along the course of the scanned abdominal part), thoracic aorta with brachiocephalic
trunk and left subclavian artery, thoracic caudal vena cava (on through the
liver to the scanned one), thyroid lobes, urethra, prostate and rectum (the
CT colon ends at the pelvic inlet; a thin duct on the caudal end of the
bladder is dropped). The liver mask is grown by four voxels into free space
(the registration flattens its lobes).
"""
import itertools
import os
import sys

import numpy as np
from scipy import ndimage as ndi

# -I leaves the script's directory off sys.path; the helpers live next door.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from visceral import Grid, ellipsoid, largest, merge, outward, read, spline, taubin, tube, write  # noqa: E402

# --- source frame ---------------------------------------------------------------

# Measured once on the CT (node frame, mm).
SRC = {
    "mid": 5.0,  # median plane (between the kidneys, at the aorta)
    "celiac": 235.0,  # origin of the celiac artery
    # Ventral body wall (flat: the cat lay on its back), less part of the
    # falciform and omental fat, so the viscera reach the wall.
    "floor": 143.0,
    "cage": 66.0,  # half-width of the abdominal cavity at the kidneys (skin minus wall)
    # Dorsal border of the aorta along x (the ventral line of the vertebral bodies).
    "spine_x": np.array([180.0, 200.0, 217.0, 228.0, 245.0, 280.0, 320.0, 345.0, 420.0]),
    "spine_y": np.array([237.0, 236.5, 234.0, 229.0, 223.0, 222.5, 223.5, 224.0, 224.0]),
}


def oriented(p):
    """Node coordinates -> oriented CT frame: x = animal's right, y = dorsal,
    z = caudal (mm)."""
    return np.stack([-(p[:, 2] - SRC["mid"]), p[:, 1], p[:, 0]], 1)


def source_meshes(src, material, nodes=None, skip=()):
    out = []
    for k, (p, f) in src.items():
        mat, node = k.split("/")
        if material in mat and node not in skip and (nodes is None or node in nodes):
            out.append((oriented(p), f))
    return merge(out)


# --- skeleton -----------------------------------------------------------------------


def skeleton_landmarks(sk):
    def pts(name):
        return sk[f"cat_skeletal_{name}"][0]

    def ventral(name):
        q = pts(name)
        near = q[np.abs(q[:, 0]) < 0.004]
        return near[:, 1].min()

    lm = {}
    verts = [f"vertebrae-thoracic_t{i}" for i in range(1, 14)] + [f"vertebrae-lumbar_l{i}" for i in range(1, 8)] + ["sacrum"]
    lm["spine_z"] = np.array([pts(n)[:, 2].mean() for n in verts])
    lm["spine_y"] = np.array([ventral(n) for n in verts])
    lm["T"] = {i: pts(f"vertebrae-thoracic_t{i}")[:, 2].mean() for i in range(1, 14)}
    lm["L"] = {i: pts(f"vertebrae-lumbar_l{i}")[:, 2].mean() for i in range(1, 8)}
    ribs = np.concatenate([m[0] for k, m in sk.items() if k.startswith("cat_skeletal_ribs")])
    lm["ribs"] = ribs
    lm["cage"] = np.abs(ribs[:, 0]).max()
    sternum = [pts(f"sternum_s{i}") for i in range(1, 9)]
    lm["sternum"] = sternum
    lm["manubrium"] = sternum[0].mean(0)
    lm["xiphoid"] = sternum[-1][np.argmax(sternum[-1][:, 2])]
    ox = np.concatenate([pts("os-coxae_L"), pts("os-coxae_R")])
    near = ox[np.abs(ox[:, 0]) < 0.004]
    lm["pecten"] = near[np.argmin(near[:, 2])]  # cranial end of the pelvic symphysis
    return lm


def spine_atlas(lm, z):
    return np.interp(z, lm["spine_z"], lm["spine_y"])


def floor_atlas(lm, z):
    """Inside of the ventral body wall: straight from the xiphoid to the
    cranial end of the pelvic symphysis."""
    x0, x1 = lm["xiphoid"], lm["pecten"]
    t = (np.asarray(z) - x0[2]) / (x1[2] - x0[2])
    return x0[1] + t * (x1[1] - x0[1])


class Cage:
    """Cross-sections of the thoracic cavity: for each z (1 mm steps), the
    convex hull of the ribs and sternebrae within a rib space of it (made
    symmetric), shrunk by the thickness of the wall."""

    def __init__(self, lm, sk, wall=0.0035, step=0.001):
        from scipy.spatial import ConvexHull

        pts = np.concatenate([m[0] for k, m in sk.items() if any(b in k for b in ("ribs", "sternum"))])
        self.zs = np.arange(pts[:, 2].min(), pts[:, 2].max() + step, step)
        self.step = step
        self.planes = []
        for z in self.zs:
            q = pts[np.abs(pts[:, 2] - z) < 0.006][:, :2]
            q = np.concatenate([q, q * [-1, 1]])
            if len(q) < 10:
                self.planes.append(None)
                continue
            eq = ConvexHull(q).equations  # n . p + d <= 0 inside, |n| = 1
            self.planes.append(eq + [0, 0, wall])

    def _slices(self, z):
        iz = np.round((z - self.zs[0]) / self.step).astype(int)
        for k in np.unique(iz):
            if 0 <= k < len(self.zs) and self.planes[k] is not None:
                yield iz == k, self.planes[k]

    def inside(self, x, y, z):
        x, y, z = np.broadcast_arrays(*(np.asarray(a, float) for a in (x, y, z)))
        out = np.zeros(x.shape, bool)
        for sel, eq in self._slices(z):
            out[sel] = np.all(eq[:, 0][:, None] * x[sel] + eq[:, 1][:, None] * y[sel] + eq[:, 2][:, None] <= 0, axis=0)
        return out

    def halfwidth(self, y, z):
        """Half-width of the section at height y (nan outside it)."""
        y, z = np.broadcast_arrays(np.asarray(y, float), np.asarray(z, float))
        out = np.full(y.shape, np.nan)
        for sel, eq in self._slices(z):
            nx, ny, d = eq[:, 0][:, None], eq[:, 1][:, None], eq[:, 2][:, None]
            # x limit of each half-plane n_x x + n_y y + d <= 0, for x > 0.
            lim = np.where(nx > 1e-9, -(ny * y[sel] + d) / np.maximum(nx, 1e-9), np.inf)
            ok = np.all(np.where(np.abs(nx) <= 1e-9, ny * y[sel] + d <= 0, True), axis=0)
            w = lim.min(0)
            w[~ok | (w <= 0)] = np.nan
            out[sel] = w
        return out


def cavity_width(lm, cage):
    """Half-width of the body cavity on a (y, z) grid: the rib cage section
    where there is one, elsewhere the flank, narrowing from the last ribs to
    the pelvic inlet."""
    ys = np.arange(0.10, 0.28, 0.001)
    zs = np.arange(-0.14, 0.26, 0.001)
    Y, Z = np.meshgrid(ys, zs, indexing="ij")
    w = cage.halfwidth(Y, Z)
    flank = np.interp(Z, [lm["T"][13], lm["pecten"][2] - 0.04, lm["pecten"][2]], [lm["cage"] - 0.002, 0.03, 0.02])
    return ys, zs, np.where(np.isnan(w), flank, w)


class Warp:
    """Landmark map from the oriented CT frame (mm) to the atlas frame (m).

    z: linear, unit scale, through the celiac artery. y: the depth between
    the dorsal border of the aorta and the ventral wall is mapped onto the
    depth between our vertebral bodies (less a millimetre) and the ventral
    wall line, so the belly follows the skeleton's tuck-up. x: scaled by the
    cavity width ratio, then eased into the cavity half-width at each (y, z)
    (identity in the middle, asymptotic to the ribs and flank). Each output
    coordinate is monotone in its own input given the previous ones, so the
    map is one to one."""

    def __init__(self, lm, cage):
        self.lm = lm
        self.z0 = lm["L"][1]  # celiac artery
        self.sz = 0.001
        self.sx = lm["cage"] / SRC["cage"]
        self.ys, self.zs, self.w = cavity_width(lm, cage)

    def width(self, y, z):
        iy = np.clip(np.round((np.asarray(y) - self.ys[0]) / 0.001).astype(int), 0, len(self.ys) - 1)
        iz = np.clip(np.round((np.asarray(z) - self.zs[0]) / 0.001).astype(int), 0, len(self.zs) - 1)
        return self.w[iy, iz]

    def z(self, zs):
        return self.z0 + (np.asarray(zs) - SRC["celiac"]) * self.sz

    def top(self, z):
        return spine_atlas(self.lm, z) - 0.0012

    def __call__(self, p):
        p = np.atleast_2d(p)
        z = self.z(p[:, 2])
        spine = np.interp(p[:, 2], SRC["spine_x"], SRC["spine_y"])
        sy = (self.top(z) - floor_atlas(self.lm, z)) / (spine - SRC["floor"])
        y = self.top(z) + sy * (p[:, 1] - spine)
        x = self.sx * p[:, 0]
        w = self.width(y, z)
        a, knee = np.abs(x), 0.8 * w
        eased = np.where(a < knee, a, knee + (w - knee) * np.tanh((a - knee) / np.maximum(w - knee, 1e-6)))
        return np.stack([np.sign(x) * eased, y, z], 1)


# --- CT organs ----------------------------------------------------------------------


def slice_fill(shell):
    """Fills tubes whose surface is open at the ends or full of small holes:
    a voxel is inside when it lies in a closed contour in at least two of the
    three slice directions."""
    votes = np.zeros(shell.shape, np.uint8)
    for axis in range(3):
        filled = np.zeros_like(shell)
        for i in range(shell.shape[axis]):
            sl = [slice(None)] * 3
            sl[axis] = i
            filled[tuple(sl)] = ndi.binary_fill_holes(shell[tuple(sl)])
        votes += filled
    return (votes >= 2) | shell


def colon_split(gut, h, core=3.5):
    """Large intestine = union of the maximal balls of the thick part of the
    tube (one connected core, the largest)."""
    dt = ndi.distance_transform_edt(gut) * h
    seed = largest(ndi.binary_opening(dt >= core, iterations=1))
    colon = np.zeros_like(gut)
    for r in np.arange(core, dt.max() + 0.5, 0.5):
        level = seed & (dt >= r) & (dt < r + 0.5)
        if level.any():
            colon |= ndi.distance_transform_edt(~level) * h <= r + 0.5
    return colon & gut


def sweep(g, path, radii):
    """Voxels of grid g within the balls swept along a polyline."""
    path = np.asarray(path, float)
    r = np.broadcast_to(np.asarray(radii, float), (len(path),))
    out = np.zeros(g.shape, bool)
    lo = np.floor((path.min(0) - r.max() - g.lo) / g.h).astype(int).clip(0)
    hi = np.minimum(np.ceil((path.max(0) + r.max() - g.lo) / g.h).astype(int) + 1, g.shape)
    axes = [g.lo[d] + g.h * np.arange(lo[d], hi[d]) for d in range(3)]
    q = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, 3)
    m = np.zeros(len(q), bool)
    for a, b, ra, rb in zip(path[:-1], path[1:], r[:-1], r[1:]):
        ab = b - a
        t = np.clip(((q - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
        m |= np.linalg.norm(q - (a + t[:, None] * ab), axis=1) <= ra + t * (rb - ra)
    out[lo[0] : hi[0], lo[1] : hi[1], lo[2] : hi[2]] = m.reshape(hi - lo)
    return out


def keep_main(mask, frac):
    lab, n = ndi.label(mask)
    if n == 0:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    return np.isin(lab, np.nonzero(sizes >= frac * sizes.max())[0] + 1)


def ct_organs(src, h=0.6):
    """Solid masks of the CT organs on one voxel grid (oriented CT frame)."""
    parts = {
        "liver": source_meshes(src, "Liver", skip=("Object_19",)),
        "pancreas": source_meshes(src, "Liver", nodes=("Object_19",)),
        "spleen": source_meshes(src, "Pancreas"),
        "stomach": source_meshes(src, "Stomach"),
        "kidneys": source_meshes(src, "Kidneys", skip=("Object_46",)),
        "bladder": source_meshes(src, "Bladder"),
        "vessels": source_meshes(src, "Blood_Volume", nodes=("Object_15",)),
        "gut": source_meshes(src, "Intestines"),
    }
    allp = np.concatenate([m[0] for m in parts.values()])
    g = Grid(allp.min(0), allp.max(0), h)
    masks = {}
    for name, close in (("liver", 2), ("pancreas", 2), ("spleen", 1), ("stomach", 2), ("kidneys", 2), ("bladder", 1), ("vessels", 1)):
        # The surfaces are open where vessels and ducts leave and around the
        # pylorus: the slice fill closes what the 3D fill cannot.
        m = g.solid(*parts[name], close) | slice_fill(g.splat(*parts[name]))
        # Speckle of loose fragments (the kidneys are two pieces).
        masks[name] = keep_main(m, 0.05)
        if name == "bladder":  # a thin duct leaves its caudal end dorsally: dropped
            masks[name] = largest(ndi.binary_opening(masks[name], iterations=3))
        print(f"  {name}: {masks[name].sum() * h**3 / 1000:.1f} ml")
    shell = ndi.binary_closing(np.pad(g.splat(*parts["gut"]), 2), iterations=1)[2:-2, 2:-2, 2:-2]
    gut = slice_fill(shell)
    gut = ndi.binary_fill_holes(ndi.binary_closing(np.pad(gut, 3), iterations=2)[3:-3, 3:-3, 3:-3])
    gut = ndi.binary_opening(gut, iterations=1)
    lab, n = ndi.label(gut)
    sizes = ndi.sum(gut, lab, range(1, n + 1))
    gut = np.isin(lab, np.nonzero(sizes > 500)[0] + 1)
    colon = colon_split(gut, h)
    masks["large-intestine"] = colon
    masks["small-intestine"] = gut & ~colon
    print(f"  intestines: {gut.sum() * h**3 / 1000:.1f} ml, colon {colon.sum() * h**3 / 1000:.1f} ml")

    # Abdominal esophagus: the stomach mask cranial to the cardia, where the
    # cross-section grows from the tube to the fundus.
    st = masks["stomach"]
    area = st.sum(axis=(0, 1)).astype(float)
    ks = np.nonzero(area)[0]
    tube_area = np.median(area[ks[0] : ks[0] + 10])
    cardia = ks[np.argmax(area[ks] > 4 * tube_area)]
    masks["esophagus"] = st.copy()
    masks["esophagus"][:, :, cardia:] = False
    st[:, :, :cardia] = False
    # The material also holds the descending duodenum (right, caudal to the
    # pyloric part): it goes to the small intestine.
    X, Y, Z = g.coords()
    duo = st & (X > 10) & (Z > 236)
    st &= ~duo
    masks["small-intestine"] |= duo
    # Right lobe of the pancreas (not segmented): from the body, at the right
    # end of the scanned part, caudally along the medial side of the
    # descending duodenum, ventral to the right kidney.
    body = np.argwhere(masks["pancreas"]) * h + g.lo
    body = body[body[:, 0] > body[:, 0].max() - 3].mean(0)
    lobe = spline([body, body + [6, -4, 6], body + [11, -7, 16], body + [13, -9, 28]], 8)
    masks["pancreas"] |= sweep(g, lobe, np.linspace(3.0, 2.2, len(lobe)))

    # Touching organs: lower priority gives way, with a two-voxel gap.
    order = ["kidneys", "vessels", "spleen", "stomach", "esophagus", "liver", "large-intestine", "small-intestine", "pancreas", "bladder"]
    taken = np.zeros_like(st)
    for name in order:
        masks[name] &= ~ndi.binary_dilation(taken, iterations=2)
        masks[name] = keep_main(masks[name], 0.02 if name != "kidneys" else 0.3)
        taken |= masks[name]
    return g, masks


def mesh(g, mask, warp, sigma=0.8, smooth=6):
    p, f = g.surface(mask, sigma)
    return taubin((warp(p), f), smooth)


def carve(m, bones, h=0.0004):
    """Re-meshes an organ without the parts that run into bone (plus a
    voxel); untouched organs are returned as they are."""
    p, f = m
    lo, hi = p.min(0), p.max(0)
    near = [b for b in bones if (b[0].max(0) > lo).all() and (b[0].min(0) < hi).all()]
    if not near:
        return m
    g = Grid(lo, hi, h)
    bone = np.zeros(g.shape, bool)
    for b in near:
        bone |= g.solid(*b, 1)
    organ = g.solid(p, f, 1)
    hit = organ & ndi.binary_dilation(bone, iterations=1)
    if hit.sum() < 4:
        return m
    print(f"    carved {hit.sum() * h**3 * 1e6:.2f} ml out of bone")
    return taubin(g.surface(keep_main(organ & ~ndi.binary_dilation(bone, iterations=2), 0.05), 0.7), 4)


# --- brain ----------------------------------------------------------------------------


def enclosed(shell):
    """Fraction of the 26 grid directions in which each voxel sees the shell."""
    hits = np.zeros(shell.shape, np.uint8)
    dirs = [d for d in itertools.product((-1, 0, 1), repeat=3) if any(d)]
    for d in dirs:
        acc = shell.copy()
        step = 1
        while step < max(shell.shape):
            sh = np.zeros_like(acc)
            src = tuple(slice(s * step, None) if s > 0 else (slice(0, s * step) if s < 0 else slice(None)) for s in d)
            dst = tuple(slice(0, -s * step) if s > 0 else (slice(-s * step, None) if s < 0 else slice(None)) for s in d)
            sh[dst] = acc[src]
            acc |= sh
            step *= 2
        hits += acc
    return hits / len(dirs)


def brain_in_skull(brain, skull, h=0.0006):
    p, f = skull
    g = Grid(p.min(0), p.max(0), h)
    shell = ndi.binary_dilation(g.splat(p, f), iterations=1)
    inside = (enclosed(shell) >= 0.9) & ~shell
    cav = largest(ndi.binary_opening(inside, iterations=1))
    q = np.argwhere(cav) * h + g.lo
    c = q.mean(0)
    axis = np.linalg.svd(q - c, full_matrices=False)[2][0]
    axis = axis if axis[2] < 0 else -axis  # rostral
    lat = np.cross(axis, [0.0, 1.0, 0.0])
    lat /= np.linalg.norm(lat)
    up = np.cross(lat, axis)
    cavity = np.array([axis, up, np.cross(axis, up)])
    template = np.array([[0, 0, -1.0], [0, 1.0, 0], np.cross([0, 0, -1.0], [0, 1.0, 0])])
    allp = np.concatenate([m[0] for m in brain.values()])
    bc = allp.mean(0)

    # Size: the template volume brought to the cavity volume, shared out
    # between the axes by the ratio of their extents (within 12% of uniform).
    tg = Grid(allp.min(0), allp.max(0), 0.0008)
    vox = np.zeros(tg.shape, bool)
    for m in brain.values():
        vox |= tg.solid(*m, 1)
    tp = (np.argwhere(vox)[::5] * tg.h + tg.lo - bc) @ template.T

    def extent(pts):
        return np.ptp(np.percentile(pts, [2, 98], axis=0), axis=0)

    k = extent((q - c) @ cavity.T) / extent(tp)
    k = np.clip(k / np.exp(np.log(k).mean()), 0.88, 1.12)
    k *= (cav.sum() * h**3 / (vox.sum() * tg.h**3) * 0.97) ** (1 / 3) / np.exp(np.log(k).mean())

    def pose(pitch, shift, size):
        c_, s_ = np.cos(pitch), np.sin(pitch)
        rot = np.array([[c_, -s_, 0], [s_, c_, 0], [0, 0, 1.0]])  # about the lateral axis
        return lambda q: c + ((q * k * size) @ rot.T) @ cavity + shift

    def kept(f):
        q = f(tp)
        ok = np.all((q >= g.lo) & (q < g.lo + h * np.array(g.shape)), 1)
        return (g.lookup(inside, q) & ok).mean()

    best = max(
        ((pitch, np.array(shift), size) for pitch in np.radians(np.arange(-10, 10.1, 2.5)) for size in (0.92, 0.96, 1.0)
         for shift in itertools.product(*[np.arange(-0.002, 0.0021, 0.001)] * 3)),
        key=lambda a: kept(pose(*a)) + 0.1 * a[2],
    )
    print(f"  brain: pitch {np.degrees(best[0]):.1f} deg, shift {np.round(best[1] * 1000, 1)} mm, size {best[2]}, inside {kept(pose(*best)):.3f}")
    to = pose(*best)
    placed = {n: (to((m[0] - bc) @ template.T), m[1]) for n, m in brain.items()}
    # Cut every part to the enclosed space (one voxel off the bone): the
    # brain then follows the cavity, the bony tentorium and the foramen magnum.
    allp = np.concatenate([m[0] for m in placed.values()])
    bg = Grid(allp.min(0), allp.max(0), h * 0.7)
    pts = np.stack([a.ravel() for a in bg.coords()], 1)
    room = g.lookup(inside, pts).reshape(bg.shape)
    room &= np.all((pts >= g.lo) & (pts < g.lo + h * np.array(g.shape)), axis=1).reshape(bg.shape)
    out = {}
    for n, m in placed.items():
        s = largest(bg.solid(*m, 1) & room)
        out[n] = taubin(bg.surface(s, 1.0), 6)
    return out


# --- procedural organs -------------------------------------------------------------------


def frame(axis, hint):
    """Orthonormal rows (axis, hint made orthogonal, their cross product)."""
    a = np.asarray(axis, float) / np.linalg.norm(axis)
    b = np.asarray(hint, float) - a * (a @ hint)
    b /= np.linalg.norm(b)
    return np.array([a, b, np.cross(a, b)])


class Box:
    """Voxel grid in the atlas frame for building organs from solid parts."""

    def __init__(self, lo, hi, h):
        self.g = Grid(lo, hi, h)
        self.pts = np.stack([c.ravel() for c in self.g.coords()], 1)
        self.shape = self.g.shape

    def ellipsoid(self, centre, radii, axes=np.eye(3)):
        d = (self.pts - centre) @ np.asarray(axes).T / np.asarray(radii)
        return ((d**2).sum(1) <= 1).reshape(self.shape)

    def tube(self, path, radii):
        return sweep(self.g, path, radii)

    def solid(self, mesh):
        return self.g.solid(*mesh, 1)

    def surface(self, mask, sigma=1.0, smooth=4):
        return taubin(self.g.surface(mask, sigma), smooth)


def heart_parts(lm):
    """Base (centre of the atrioventricular junction, ventral to the tracheal
    bifurcation at T4-T5) and apex (on the sternum at the 6th sternebra, left
    of the median plane)."""
    T, st = lm["T"], lm["sternum"]
    zb = (T[4] + T[5]) / 2
    base = np.array([0.001, spine_atlas(lm, zb) - 0.034, zb])
    s6 = st[5]
    apex = np.array([-0.007, s6[:, 1].max() + 0.004, s6[:, 2].mean() + 0.002])
    return base, apex


def heart_mesh(lm, clear=()):
    """Feline heart: ventricular cone from base to apex, flattened from side
    to side, with atria, auricles and the pulmonary trunk on the base.
    `clear`: (path, radius) tubes the heart gives way to (airways,
    esophagus), with a small gap."""
    base, apex = heart_parts(lm)
    L = np.linalg.norm(apex - base)
    F = frame(apex - base, [0, 0, -1.0])  # rows: to apex, cranial, side
    left = np.sign(F[2] @ [-1, 0, 0]) * F[2]
    box = Box(np.minimum(base, apex) - 0.025, np.maximum(base, apex) + 0.025, 0.00035)
    d = box.pts - base
    u = d @ F[0] / L  # 0 at the base, 1 at the apex
    v = d @ F[1]
    w = d @ left
    R = 0.33 * L
    r = R * np.clip(1 - u, 0, 1) ** 0.45 * np.clip((u + 0.16) / 0.36, 0, 1) ** 0.45
    m = ((u >= -0.05) & (u <= 1) & (v**2 + (w / 0.86) ** 2 <= r**2)).reshape(box.shape)
    up = -F[0]
    axes = [F[1], up, left]
    m |= box.ellipsoid(base + up * 0.005 - F[1] * 0.007 + left * 0.002, [0.0095, 0.008, 0.0085], axes)  # left atrium
    m |= box.ellipsoid(base + up * 0.004 + F[1] * 0.006 - left * 0.006, [0.0085, 0.008, 0.008], axes)  # right atrium
    m |= box.ellipsoid(base + F[1] * 0.010 + left * 0.010 + F[0] * 0.003, [0.0065, 0.004, 0.0045], axes)  # left auricle
    m |= box.ellipsoid(base + F[1] * 0.012 - left * 0.008 + up * 0.002, [0.006, 0.004, 0.0045], axes)  # right auricle
    trunk = spline([base + F[1] * 0.011 + left * 0.003 + F[0] * 0.010, base + F[1] * 0.010 + left * 0.004 + up * 0.002, base + F[1] * 0.004 + left * 0.004 + up * 0.012], 6)
    m |= box.tube(trunk, 0.0036)  # pulmonary trunk
    m = ndi.binary_closing(np.pad(m, 4), iterations=3)[4:-4, 4:-4, 4:-4]
    for path, rad in clear:
        m &= ~box.tube(path, rad + 0.0012)
    return box.surface(largest(m), 1.4, 6), base, F, left


def ventral_body(q):
    """Ventral point of a vertebral body on the median plane."""
    near = q[np.abs(q[:, 0]) < 0.004]
    return np.array([0.0, near[:, 1].min(), near[near[:, 1] < near[:, 1].min() + 0.003][:, 2].mean()])


def thorax(lm, sk, out, cage):
    """Trachea, thyroid lobes, cervical and thoracic esophagus, heart,
    thoracic great vessels and lungs (atlas frame)."""
    res = {}
    T = lm["T"]
    spine = lambda z: spine_atlas(lm, z)

    # Trachea: from the larynx (caudal to the basihyoid, between the
    # thyrohyoid bones and the mandibular angles) down the neck under the
    # cervical vertebral bodies, through the thoracic inlet to the
    # bifurcation dorsal to the heart base at T5; principal bronchi.
    neck = [ventral_body(sk[f"cat_skeletal_{n}"][0]) for n in ["axis"] + [f"vertebrae-cervical_c{i}" for i in range(3, 8)]]
    hy = sk["cat_skeletal_hyoid"][0]
    body = hy[np.abs(hy[:, 0]) < 0.004]  # basihyoid
    larynx = np.array([0.0, body[:, 1].min() + 0.002, hy[:, 2].max() + 0.0015])  # cricoid, at the thyrohyoid tips
    glottis = np.array([0.0, body[:, 1].min() + 0.0025, body[:, 2].max() + 0.0045])
    inlet = np.array([0.0, (lm["manubrium"][1] + spine(T[1])) / 2 + 0.004, lm["manubrium"][2]])
    carina = np.array([0.0, spine(T[5]) - 0.018, T[5]])
    r_tr = 0.003
    trachea = spline([glottis, larynx, neck[0] + [0, -0.0105, 0]] + [q + [0, -0.0105 - 0.0002 * i, 0] for i, q in enumerate(neck[1:])] + [inlet, (inlet + carina) / 2 + [0, 0.0015, 0], carina], 10)
    bronchi = [spline([carina, carina + [s * 0.006, -0.001, 0.004], carina + [s * 0.012, -0.003, 0.009]], 6) for s in (-1, 1)]
    # The laryngeal end is a little wider.
    radii = r_tr + 0.0006 * np.clip((larynx[2] - trachea[:, 2]) / (larynx[2] - glottis[2]), 0, 1)
    res["cat.visceral.trachea"] = merge([tube(trachea, radii, 20)] + [tube(b, 0.002, 14) for b in bronchi])

    # Thyroid lobes beside the first tracheal rings.
    i = int(np.argmin(np.abs(trachea[:, 2] - (larynx[2] + 0.010))))
    d = trachea[i + 3] - trachea[i - 3]
    d /= np.linalg.norm(d)
    for side, key in ((-1, "L"), (1, "R")):
        lat = np.array([side * 1.0, 0, 0])
        c = trachea[i] + lat * (r_tr + 0.0028) + np.cross(d, lat) * side * 0.0005
        res[f"cat.visceral.thyroid.{key}"] = ellipsoid(c, [0.002, 0.0065, 0.003], np.array([lat, d, np.cross(lat, d)]), 16)

    # Esophagus: from the pharynx dorsal to the larynx, dorsal to the trachea, to the left of the trachea
    # in the caudal neck, dorsal to the bifurcation and ventral to the aorta
    # in the thorax, then along the scanned abdominal esophagus (collapsed
    # flat in the CT: only its course is kept) into the cardia.
    ab = out["cat.visceral.esophagus"][0]
    end = ab[ab[:, 2] < ab[:, 2].min() + 0.002].mean(0)
    course = [ab[np.abs(ab[:, 2] - z) < 0.001].mean(0) for z in np.arange(end[2] + 0.008, ab[:, 2].max() - 0.003, 0.008)]
    cardia = ab[ab[:, 2] > ab[:, 2].max() - 0.002].mean(0)
    r_es = 0.0027
    path_e = spline(
        [larynx + [0, 0.0075, -0.001], neck[0] + [0, -0.0035, 0], neck[1] + [-0.0015, -0.0033, 0], neck[3] + [-0.003, -0.0035, 0], neck[5] + [-0.005, -0.004, 0],
         inlet + [-0.004, 0.0078, 0.002], np.array([-0.001, spine(T[3]) - 0.007, T[3]]), carina + [0.0, 0.0074, 0],
         np.array([0.0, spine(T[7]) - 0.012, T[7]]), (np.array([0.0, spine(T[7]) - 0.012, T[7]]) + end) / 2 + [0, 0.002, 0],
         end + [0, 0.001, -0.005], end] + course + [cardia + [0, 0, 0.002]], 10)
    res["cat.visceral.esophagus"] = tube(path_e, r_es, 16)

    heart, base, F, left = heart_mesh(lm, [(trachea, r_tr)] + [(b, 0.002) for b in bronchi] + [(path_e, r_es)])
    res["cat.visceral.heart"] = heart

    # Thoracic aorta: root at the base of the heart, arch to the left of the
    # trachea and esophagus at T3-T4, descending along the left of the
    # vertebral bodies to the scanned abdominal aorta (its cranial end, at
    # the aortic hiatus). Brachiocephalic trunk and left subclavian artery to
    # the inlet; caudal vena cava from the right atrium to the liver.
    gv = out["cat.visceral.great-vessels"][0]
    hiatus = gv[gv[:, 2] < gv[:, 2].min() + 0.003].mean(0)
    r_ao = 0.0026
    root = base + F[1] * 0.002 - F[0] * 0.004
    ctrl = [root, root + [-0.001, 0.010, -0.006], np.array([-0.0065, spine(T[3]) - 0.008, T[3] + 0.002]),
            np.array([-0.0055, spine(T[5]) - r_ao - 0.0016, T[5] + 0.002])]
    ctrl += [np.array([-0.004, spine(T[n]) - r_ao - 0.0016, T[n]]) for n in (7, 9, 11) if T[n] < hiatus[2] - 0.006]
    aorta = spline(ctrl + [hiatus + [0, 0, 0.002]], 12)
    arch = aorta[aorta[:, 2] < T[4]]
    top = arch[np.argmax(arch[:, 1])]
    bct = spline([top + [-0.0005, -0.003, -0.001], top + [0.0, -0.013, -0.008], inlet + [0.002, -0.0095, 0.004]], 8)
    lsa = spline([top + [-0.002, 0, -0.001], top + [-0.006, 0.001, -0.009], inlet + [-0.010, 0.002, 0.006]], 8)
    liver = out["cat.visceral.liver"][0]
    start = base + F[1] * 0.002 - left * 0.006 - F[0] * 0.002
    near = liver[np.linalg.norm(liver[:, :2] - [0.004, start[1] - 0.002], axis=1) < 0.003]
    stop = near[np.argmin(near[:, 2])] - [0, 0, 0.0008]
    # It runs on through the dorsal part of the liver to the cranial end of
    # the scanned caudal vena cava (right of the aorta), narrowing to it.
    right = gv[(gv[:, 0] > 0.003) & (gv[:, 2] > stop[2])]
    head = right[right[:, 2] < right[:, 2].min() + 0.0015]
    ring = right[np.abs(right[:, 2] - head[:, 2].mean() - 0.002) < 0.0005]
    r_cvc = max(0.0015, np.sqrt(np.ptp(ring[:, 0]) * np.ptp(ring[:, 1])) / 2) if len(ring) > 3 else 0.002
    head = head.mean(0)
    cvc = spline([start, (start + stop) / 2 + [0.002, 0, 0], stop, stop + (head - stop) * 0.35 + [0, 0.004, 0], stop + (head - stop) * 0.7 + [0, 0.002, 0], head + [0, 0, 0.002]], 10)
    # The aorta and caudal vena cava leave the heart: their paths start one
    # millimetre inside its surface.
    hb = Box(heart[0].min(0) - 0.002, heart[0].max(0) + 0.002, 0.0004)
    deep = ndi.binary_erosion(hb.solid(heart), iterations=3)

    def emerge(path):
        within = np.all((path > hb.g.lo) & (path < hb.g.lo + hb.g.h * np.array(hb.shape)), 1)
        inside = hb.g.lookup(deep, path) & within
        return path[max(int(np.argmax(~inside)) - 1, 0) :]

    cvc = emerge(cvc)
    vessels = [(emerge(aorta), r_ao), (bct, 0.0016), (lsa, 0.0013), (cvc, np.interp(np.arange(len(cvc)), [0, len(cvc) * 0.45, len(cvc) - 1], [0.003, 0.003, r_cvc]))]
    res["cat.visceral.great-vessels"] = merge([out["cat.visceral.great-vessels"]] + [tube(p, r, 16) for p, r in vessels])

    res.update(lungs(lm, out, cage, res, base))
    return res


def lungs(lm, out, cage, res, base, h=0.0005):
    """The rib cage sections from a rounded cupula at the first rib to the
    diaphragm (a gap cranial to the liver, stomach and spleen, and a plane
    through the costal arch and T12 where they do not reach), less the heart
    with its cardiac notches, the mediastinum, airways, esophagus and great
    vessels."""
    ribs = lm["ribs"]
    lo = np.array([-lm["cage"], lm["xiphoid"][1] - 0.004, ribs[:, 2].min() - 0.006])
    hi = np.array([lm["cage"], ribs[:, 1].max(), lm["T"][13]])
    box = Box(lo, hi, h)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    floor = np.interp(Z, *zip(*sorted((s[:, 2].mean(), s[:, 1].max()) for s in lm["sternum"])))
    spine = spine_atlas(lm, Z)
    # Cupula: over the first rib spaces the section shrinks towards its
    # centre, so the cranial lobes end in a rounded apex at the first rib.
    z0 = ribs[:, 2].min() + 0.002
    k = 0.35 + 0.65 * np.sqrt(np.clip((Z - z0) / 0.016, 0, 1))
    yc = spine - 0.022
    s = cage.inside(X / k, yc + (Y - yc) / k, Z) & (Z > z0)
    # The sections step from one rib space to the next: smooth along z.
    s = ndi.gaussian_filter(s.astype(np.float32), (1, 1, 7)) > 0.5
    s &= Y > floor - 0.003
    s &= ~((np.abs(X) < 0.0095) & (Y > spine - 0.0015))  # vertebral bodies, longus colli
    s &= np.abs(X) > 0.0012  # mediastinum
    plane = np.interp(Y, [lm["xiphoid"][1], spine_atlas(lm, lm["T"][12])], [lm["xiphoid"][2] - 0.004, lm["T"][12]])
    s &= Z < plane
    # Diaphragm: cranial to the abdominal organs in every column, and clear
    # of them all round.
    dome = np.full(box.shape[:2], np.inf)
    for name in ("liver", "stomach", "spleen"):
        m = box.solid(out[f"cat.visceral.{name}"])
        first = np.where(m.any(2), np.argmax(m, 2), box.shape[2])
        dome = np.minimum(dome, box.g.lo[2] + first * h)
        s &= ~ndi.binary_dilation(m, iterations=5)
    dome = ndi.minimum_filter(ndi.uniform_filter(dome, 3), 3)
    s &= Z < dome[:, :, None] - 0.003
    heart = box.solid(res["cat.visceral.heart"])
    s &= ~ndi.binary_dilation(heart, iterations=3)
    # Cardiac notches: the heart lies on the sternum below its widest part,
    # broadly on the right (4th-5th intercostal spaces), narrowly on the left.
    foot = heart.any(1)
    mid = base[1] - 0.012
    for side, grow in ((1, 8), (-1, 0)):
        f = ndi.binary_dilation(foot, iterations=grow) if grow else foot
        s &= ~(f[:, None, :] & (np.sign(X) == side) & (Y < mid))
    for name in ("trachea", "esophagus", "great-vessels"):
        s &= ~ndi.binary_dilation(box.solid(res[f"cat.visceral.{name}"]), iterations=2)
    return {
        "cat.visceral.lungs.L": box.surface(largest(s & (X < 0)), 1.6, 8),
        "cat.visceral.lungs.R": box.surface(largest(s & (X > 0)), 1.6, 8),
    }


def pelvis(lm, sk, out):
    """Rectum (the CT colon ends at the pelvic inlet): continues the scanned
    colon (same direction and calibre) through the dorsal part of the pelvic
    canal, under the sacrum and first caudal vertebrae, narrowing to the
    anus caudal to the ischial arch. Urethra: from the neck of the bladder
    (a long preprostatic part, as in the tom) along the pelvic floor to the
    ischial arch. Prostate: small and bilobed, on the dorsal and lateral
    faces of the urethra just caudal to the pecten, not round its ventral
    face."""
    ox = np.concatenate([m[0] for k, m in sk.items() if "os-coxae" in k])
    roof = np.concatenate([m[0] for k, m in sk.items() if "sacrum" in k or "vertebrae-caudal" in k])

    def ventral(q, z):
        q = q[(np.abs(q[:, 2] - z) < 0.003) & (np.abs(q[:, 0]) < 0.006)]
        return q[:, 1].min()

    li = out["cat.visceral.large-intestine"][0]
    zmax = li[:, 2].max()
    end = li[li[:, 2] > zmax - 0.003].mean(0)
    back = li[np.abs(li[:, 2] - (zmax - 0.010)) < 0.002].mean(0)
    d = (end - back) / np.linalg.norm(end - back)
    ring = li[np.abs(li[:, 2] - (zmax - 0.006)) < 0.0006]
    r0 = np.clip(np.sqrt(np.ptp(ring[:, 0]) * np.ptp(ring[:, 1])) / 2, 0.003, 0.0045)
    anus_z = ox[:, 2].max() + 0.006
    zs = np.arange(end[2] + 0.014, anus_z - 0.004, 0.01)
    path = [end - d * 0.004, end + d * 0.005] + [np.array([0.0, ventral(roof, z) - 0.0075, z]) for z in zs]
    path.append(np.array([0.0, ventral(roof, anus_z) - 0.009, anus_z]))
    rectum = spline(path, 8)
    u = np.linspace(0, 1, len(rectum))
    rectum = tube(rectum, np.interp(u, [0, 0.25, 0.85, 1], [r0, 0.0034, 0.0032, 0.0026]), 18)

    mid = ox[np.abs(ox[:, 0]) < 0.003]

    def floor(z):
        q = mid[np.abs(mid[:, 2] - z) < 0.002]
        return q[:, 1].max() if len(q) else None

    bl = out["cat.visceral.urinary-bladder"][0]
    neck = bl[bl[:, 2] > bl[:, 2].max() - 0.002].mean(0) * [0, 1, 1]
    arch = mid[mid[:, 2] > mid[:, 2].max() - 0.002]
    arch = np.array([0.0, arch[:, 1].max(), arch[:, 2].max()])
    r_ur = 0.0013
    zp = lm["pecten"][2] + 0.006
    on_floor = [np.array([0.0, floor(z) + r_ur + 0.0016, z]) for z in np.arange(zp, arch[2] - 0.002, 0.006) if floor(z) is not None]
    urethra = spline([neck - [0, 0, 0.003], (neck + on_floor[0]) / 2 + [0, 0.001, 0]] + on_floor + [np.array([0.0, on_floor[-1][1] - 0.002, arch[2] + 0.006])], 8)
    centre = urethra[np.argmin(np.abs(urethra[:, 2] - zp))]
    box = Box(centre - 0.008, centre + 0.008, 0.0002)
    m = box.ellipsoid(centre + [-0.0022, 0.001, 0], [0.0026, 0.0024, 0.004]) | box.ellipsoid(centre + [0.0022, 0.001, 0], [0.0026, 0.0024, 0.004])
    m &= ~box.tube(urethra, r_ur + 0.0003)
    m &= box.pts[:, 1].reshape(box.shape) > centre[1] - 0.0008
    prostate = box.surface(largest(m), 1.0, 4)
    return rectum, tube(urethra, r_ur, 12), prostate


# --- main ---------------------------------------------------------------------------------


def main(work):
    src = read(os.path.join(work, "source"))
    sk = read(os.path.join(work, "skeleton"))
    lm = skeleton_landmarks(sk)
    cage = Cage(lm, sk)
    warp = Warp(lm, cage)
    print(f"warp: sx {warp.sx * 1000:.3f} sz {warp.sz * 1000:.3f}, celiac at z {warp.z0:.3f}")
    out = {}
    g, masks = ct_organs(src)
    names = {
        "liver": "liver",
        "pancreas": "pancreas",
        "spleen": "spleen",
        "stomach": "stomach",
        "bladder": "urinary-bladder",
        "vessels": "great-vessels",
        "large-intestine": "large-intestine",
        "small-intestine": "small-intestine",
        "esophagus": "esophagus",
        "kidneys.L": "kidneys.L",
        "kidneys.R": "kidneys.R",
    }
    X, _, Z = g.coords()
    # The iliac vessels end at the pelvic inlet (they leave the abdomen there).
    masks["vessels"] = keep_main(masks["vessels"] & (warp.z(Z) < lm["pecten"][2] - 0.008), 0.05)
    masks["kidneys.L"] = masks["kidneys"] & (X < 0)
    masks["kidneys.R"] = masks["kidneys"] & (X > 0)
    del X, Z
    # The liver lobes come out of the CT thin (the y map flattens them):
    # grown by four voxels into the space no other organ takes.
    others = np.zeros_like(masks["liver"])
    for k in ("pancreas", "spleen", "stomach", "kidneys", "bladder", "vessels", "large-intestine", "small-intestine", "esophagus"):
        others |= masks[k]
    masks["liver"] = keep_main(ndi.binary_dilation(masks["liver"], iterations=4) & ~ndi.binary_dilation(others, iterations=2), 0.02)
    bones = [m for k, m in sk.items() if not any(b in k for b in ("skull", "mandible", "hyoid"))]
    for k, n in names.items():
        print(f"  {n}")
        out[f"cat.visceral.{n}"] = carve(mesh(g, masks[k], warp), bones)

    print("  thorax")
    for k, m in thorax(lm, sk, out, cage).items():
        out[k] = carve(m, bones)
    rectum, urethra, out["cat.visceral.prostate"] = pelvis(lm, sk, out)
    out["cat.visceral.large-intestine"] = merge([out["cat.visceral.large-intestine"], carve(rectum, bones)])
    out["cat.visceral.urinary-bladder"] = merge([out["cat.visceral.urinary-bladder"], carve(urethra, bones)])

    brain = read(os.path.join(work, "brain"))
    for k, m in brain_in_skull(brain, sk["cat_skeletal_skull"]).items():
        out[f"cat.visceral.brain.{k}"] = m

    for k, m in out.items():
        out[k] = outward(m)
        print(f"{k}: {len(m[1])} triangles, centre {np.round(m[0].mean(0), 3)}, size {np.round(np.ptp(m[0], 0), 3)}")
    write(os.path.join(work, "organs"), out)


if __name__ == "__main__":
    main(sys.argv[1])
