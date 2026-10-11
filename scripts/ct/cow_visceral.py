"""
Organ geometry for scripts/build-cow-visceral.ts (which exports the inputs,
runs this script and writes the GLB).

    .venv/bin/python -I scripts/ct/cow_visceral.py <work-dir>

Inputs in <work-dir> (json index + bin, same layout as greyhound_hindlimb.py):
stomach (rumen, reticulum, omasum, abomasum of the OVC model, its own frame:
+z cranial, +x the animal's left, metres at 5 cm per unit), heart (Visible
Heart Lab scan, metres, base up) and skeleton (our skeletal.glb, atlas frame).
Output: organs.json/.bin, one mesh per mesh id in the atlas frame (metres,
Y up, animal faces -Z, left side -X).

Scanned organs (fidelity "scan", placement "modeled"):
- Stomach: turned to face -z, scaled as one so that it reaches from the
  diaphragm (the reticulum against it at the level of the xiphoid, opposite
  the 6th-7th ribs) to the pelvic inlet (the caudal blind sacs), its ventral
  surface on the abdominal floor and the rumen against the left wall.
- Heart: long axis from the base (ventral to T4, about 40% of the way down
  the thorax) to the apex (on the sternum at the 5th rib, left of the median
  plane), scaled so the ventricles fill that span.

Procedural organs (fidelity "illustrative"), from skeletal landmarks and
bovine topography:
- Lungs: the rib cage sections cranial to the diaphragm (cranial to the
  liver, reticulum, rumen and spleen, and an oblique plane from the xiphoid
  to T11), less heart, mediastinum, airways, esophagus and great vessels;
  the right lung larger (the mediastinum lies left of the median plane).
- Trachea from the larynx (between the mandibular angles) along the ventral
  neck to the bifurcation at T5, with the tracheal bronchus to the right
  cranial lobe at T2-T3; esophagus dorsal and then left of the trachea to the
  cardia on the reticulum; thyroid lobes on the first tracheal rings joined by
  a glandular isthmus; aorta (arch to the left, along the vertebral bodies
  to L5) and caudal vena cava (right atrium, through the liver, right of the
  aorta).
- Liver: entirely right, a thick plate on the diaphragm from the 7th rib
  space to the last rib, caudal to it the right kidney; pancreas along the
  duodenum. Spleen: flat, on the left dorsal rumen against the diaphragm.
- Kidneys lobed (fissured surface): the right ventral to T13-L2, the left
  ventral to L3-L5 and pushed right of the median plane by the rumen.
- Small intestine: one tube packed into the free space on the right,
  caudal to the omasum and abomasum (the supraomental recess); large
  intestine: cecum with its blind end towards the pelvic inlet, spiral colon
  as a disc in a sagittal plane (two centripetal and two centrifugal turns)
  in the largest free space of the right flank, descending colon and a
  rectum sagging a little at the pelvic inlet, under the sacrum to the anus.
- Urinary bladder on the pelvic floor, uterus (body and coiled horns over the
  pubis) and ovaries at the pelvic inlet (a heifer).
- Brain: cerebrum, cerebellum and brainstem modeled in the caudal skull from
  the foramen magnum (the skull scan has no inner surface).
"""
import os
import sys

import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

# -I leaves the script's directory off sys.path; the helpers live next door.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cat_visceral import Box, carve, frame, keep_main  # noqa: E402
from visceral import ellipsoid, largest, merge, outward, read, ribbon, spline, taubin, tube, write  # noqa: E402

H = 0.004  # voxel size of the procedural organs (m)


# --- skeleton -----------------------------------------------------------------------


def landmarks(sk):
    def pts(name):
        return sk[f"cow_skeletal_{name}"][0]

    def ventral(q):
        near = q[np.abs(q[:, 0]) < 0.015]
        return near[:, 1].min()

    lm = {"pts": pts, "mesh": lambda name: sk[f"cow_skeletal_{name}"]}
    verts = [f"vertebrae-thoracic_t{i}" for i in range(2, 14)] + [f"vertebrae-lumbar_l{i}" for i in range(1, 7)] + ["sacrum"]
    lm["spine_z"] = np.array([pts(n)[:, 2].mean() for n in verts])
    lm["spine_y"] = np.array([ventral(pts(n)) for n in verts])
    lm["T"] = {i: pts(f"vertebrae-thoracic_t{i}")[:, 2].mean() for i in range(1, 14)}
    lm["L"] = {i: pts(f"vertebrae-lumbar_l{i}")[:, 2].mean() for i in range(1, 7)}
    lm["ribs"] = {k: np.concatenate([pts(f"ribs_{k}_L"), pts(f"ribs_{k}_R")]) for k in range(1, 14)}
    allribs = np.concatenate(list(lm["ribs"].values()))
    lm["cage"] = np.abs(allribs[:, 0]).max()
    st = pts("sternum")
    lm["sternum"] = st
    lm["xiphoid"] = st[np.argmax(st[:, 2])]
    lm["manubrium"] = st[np.argmin(st[:, 2])]
    ox = np.concatenate([pts("os-coxae_L"), pts("os-coxae_R")])
    pubis = ox[(np.abs(ox[:, 0]) < 0.02) & (ox[:, 1] < ox[:, 1].min() + 0.05)]
    lm["pecten"] = pubis[np.argmin(pubis[:, 2])]
    lm["ox"] = ox
    lm["skull"] = sk["cow_skeletal_skull"]
    return lm


def spine(lm, z):
    """Ventral line of the vertebral bodies."""
    return np.interp(z, lm["spine_z"], lm["spine_y"])


def floor(lm, z):
    """Inside of the ventral body wall: the sternum, then the belly hanging
    below the xiphoid (deepest at a third of the way to the pubis), rising to
    the pelvic floor."""
    x0, p = lm["xiphoid"], lm["pecten"]
    z = np.asarray(z, float)
    t = np.clip((z - x0[2]) / (p[2] - x0[2]), 0, 1)
    sag = 0.07 * np.sin(np.pi * t) ** 0.8
    y = x0[1] + (p[1] - x0[1]) * t**1.6 - sag
    st = lm["sternum"]
    return np.where(z < x0[2], np.interp(z, *zip(*sorted((q[2], q[1]) for q in st[::40]))) + 0.012, y + 0.01)


def halfwidth(lm, z):
    """Half-width of the body cavity: the rib cage (less the wall), widening
    a little in the flank, narrowing to the pelvic inlet."""
    p = lm["pecten"]
    return np.interp(z, [lm["T"][1], lm["T"][6], lm["T"][13], lm["L"][4], p[2]], [lm["cage"] * 0.55, lm["cage"] - 0.012, lm["cage"] + 0.005, lm["cage"], 0.07])


# --- scanned organs ---------------------------------------------------------------------


def place_stomach(lm, parts):
    """Turned to face -z (x and z negated), scaled from the diaphragm to the
    pelvic inlet, on the floor and against the left wall."""
    turned = {k: (p * [-1, 1, -1], f[:, ::-1]) for k, (p, f) in parts.items()}
    allp = np.concatenate([m[0] for m in turned.values()])
    z0 = lm["xiphoid"][2] - 0.035  # reticulum against the diaphragm
    z1 = lm["pecten"][2] - 0.07  # caudal blind sacs at the pelvic inlet
    s = (z1 - z0) / np.ptp(allp[:, 2])
    q = allp * s
    shift = np.array([-halfwidth(lm, lm["L"][2]) + 0.006 - q[:, 0].min(), floor(lm, lm["T"][13]) + 0.004 - q[:, 1].min(), z0 - q[:, 2].min()])
    print(f"  stomach: scale {s:.3f}, size {np.round(np.ptp(q, 0), 3)}")
    return {k: (p * s + shift, f) for k, (p, f) in turned.items()}


def place_heart(lm, heart):
    p, f = heart
    T = lm["T"]
    ribs5 = lm["ribs"][5]
    st = lm["sternum"]
    apex_z = ribs5[ribs5[:, 1] < ribs5[:, 1].min() + 0.03][:, 2].mean()
    apex = np.array([-0.02, np.interp(apex_z, *zip(*sorted((q[2], q[1]) for q in st[::40]))) + 0.06, apex_z])
    top = spine(lm, T[4])
    base = np.array([0.005, top - 0.4 * (top - apex[1]), T[4] + 0.01])
    axis = apex - base
    L = np.linalg.norm(axis)
    # The scan: base up (+y), apex down; the ventricles are about 70% of its height.
    lo, hi = p[:, 1].min(), p[:, 1].max()
    k = L / (0.7 * (hi - lo))
    centre_src = np.array([p[:, 0].mean(), hi - 0.3 * (hi - lo), p[:, 2].mean()])
    F = frame(-axis, [0, 0, -1.0])  # rows: up the heart, cranial, side
    R = np.array([F[2], F[0], -F[1]]).T  # source x, y, z -> side, up, caudal
    if np.linalg.det(R) < 0:
        R[:, 0] *= -1
    q = ((p - centre_src) * k) @ R.T + base
    print(f"  heart: scale {k:.3f}, base {np.round(base, 3)}, apex {np.round(apex, 3)}")
    return q, f if np.linalg.det(R) > 0 else f[:, ::-1]


# --- procedural organs --------------------------------------------------------------


def box_for(lo, hi, h=H):
    return Box(np.asarray(lo, float), np.asarray(hi, float), h)


def solid_in(box, meshes, grow=0):
    m = np.zeros(box.shape, bool)
    for mesh in meshes:
        p = mesh[0]
        if (p.max(0) < box.g.lo).any() or (p.min(0) > box.g.lo + box.g.h * np.array(box.shape)).any():
            continue
        m |= box.solid(mesh)
    return ndi.binary_dilation(m, iterations=grow) if grow else m


def airways(lm):
    T = lm["T"]
    neck = []
    for n in ["axis"] + [f"vertebrae-cervical_c{i}" for i in range(3, 8)]:
        q = lm["pts"](n)
        near = q[np.abs(q[:, 0]) < 0.02]
        neck.append(np.array([0.0, near[:, 1].min(), near[near[:, 1] < near[:, 1].min() + 0.01][:, 2].mean()]))
    md = lm["pts"]("mandible")
    larynx = np.array([0.0, md[:, 1].min() + 0.02, md[:, 2].max() + 0.02])
    inlet = np.array([0.0, (lm["manubrium"][1] + spine(lm, T[2])) / 2 + 0.03, lm["manubrium"][2] + 0.01])
    carina = np.array([0.0, spine(lm, T[5]) - 0.06, T[5]])
    trachea = spline([larynx, neck[0] + [0, -0.05, 0.01]] + [q + [0, -0.045, 0] for q in neck[2:]] + [inlet, (inlet + carina) / 2 + [0, 0.01, 0], carina], 10)
    r = 0.021
    # Principal bronchi: short, curving caudoventrolaterally into the lungs
    # and tapering; the tracheal bronchus leaves the right wall cranial to
    # the carina for the right cranial lobe.
    bronchi = [spline([carina, carina + [s * 0.018, -0.008, 0.016], carina + [s * 0.032, -0.024, 0.036], carina + [s * 0.04, -0.045, 0.055]], 6) for s in (-1, 1)]
    tb = np.array([0.0, spine(lm, T[3]) - 0.055, (T[2] + T[3]) / 2])
    k = int(np.argmin(np.linalg.norm(trachea - tb, axis=1)))
    tracheal = spline([trachea[k] + [0.012, 0, 0], trachea[k] + [0.026, -0.006, -0.004], trachea[k] + [0.036, -0.02, -0.016]], 6)
    mesh = merge([tube(trachea, r, 20)] + [tube(b, np.linspace(0.014, 0.008, len(b)), 16) for b in bronchi] + [tube(tracheal, np.linspace(0.009, 0.006, len(tracheal)), 14)])
    return mesh, trachea, bronchi + [tracheal], larynx, inlet, carina, neck


def thyroid(trachea, larynx):
    i = int(np.argmin(np.abs(trachea[:, 2] - (larynx[2] + 0.04))))
    d = trachea[i + 2] - trachea[i - 2]
    d /= np.linalg.norm(d)
    parts = []
    for s in (-1, 1):
        lat = np.array([s * 1.0, 0, 0])
        c = trachea[i] + lat * 0.03 + np.array([0, 0.004, 0])
        parts.append(ellipsoid(c, [0.01, 0.03, 0.02], np.array([lat, d, np.cross(lat, d)]), 18))
    # Glandular isthmus ventral to the trachea.
    parts.append(tube(spline([trachea[i] + [-0.03, -0.012, 0.005], trachea[i] + [0, -0.026, 0.005], trachea[i] + [0.03, -0.012, 0.005]], 6), 0.005, 12))
    return merge(parts)


def esophagus(lm, larynx, neck, inlet, carina, cardia):
    """Dorsal to the trachea in the cranial neck, left of it at the thoracic
    inlet, then dorsal to the tracheal bifurcation and the heart base, always
    ventral to the vertebral bodies and the longus colli (kept 1.5 cm below
    their ventral line, so the vertebrae need not be carved out of it)."""
    T = lm["T"]
    r = 0.014
    path = spline(
        [larynx + [0, 0.03, -0.01], neck[0] + [-0.004, -0.04, 0.01], neck[2] + [-0.012, -0.045, 0], neck[4] + [-0.025, -0.05, 0],
         inlet + [-0.028, 0.03, 0.01], np.array([-0.012, spine(lm, T[3]) - 0.045, T[3]]), carina + [-0.004, 0.032, 0],
         np.array([-0.004, spine(lm, T[8]) - 0.06, T[8]]), cardia + [0, 0.035, -0.05], cardia], 10)
    # Ventral line of the vertebral bodies along the whole path: the neck
    # landmarks, then the thoracic spine.
    zs = np.array([q[2] for q in neck] + [lm["spine_z"][0]])
    ys = np.array([q[1] for q in neck] + [lm["spine_y"][0]])
    o = np.argsort(zs)
    roof = np.where(path[:, 2] < lm["spine_z"][0], np.interp(path[:, 2], zs[o], ys[o]), spine(lm, path[:, 2]))
    path[:, 1] = np.minimum(path[:, 1], roof - r - 0.015)
    for _ in range(6):
        path[1:-1] = (path[:-2] + 2 * path[1:-1] + path[2:]) / 4
    return tube(path, r, 16), path


def vessels(lm, base, liver_top):
    T, L = lm["T"], lm["L"]
    root = base + [0.0, 0.02, -0.02]
    aorta = spline([root, root + [-0.01, 0.07, -0.02], np.array([-0.03, spine(lm, T[4]) - 0.025, T[4]]),
                    np.array([-0.022, spine(lm, T[7]) - 0.022, T[7]]), np.array([-0.018, spine(lm, T[12]) - 0.02, T[12]]),
                    np.array([-0.015, spine(lm, L[3]) - 0.02, L[3]]), np.array([-0.012, spine(lm, L[5]) - 0.022, L[5]])], 10)
    bct = spline([root + [0.0, 0.08, -0.02], root + [0.01, 0.10, -0.08], np.array([0.0, (lm["manubrium"][1] + spine(lm, T[2])) / 2, lm["manubrium"][2] + 0.02])], 8)
    cvc = spline([base + [0.025, -0.02, 0.04], np.array([0.03, liver_top - 0.02, T[10]]), np.array([0.025, spine(lm, T[13]) - 0.035, T[13]]),
                  np.array([0.02, spine(lm, L[3]) - 0.03, L[3]]), np.array([0.015, spine(lm, L[5]) - 0.03, L[5]])], 10)
    return merge([tube(aorta, 0.017, 18), tube(bct, 0.012, 14), tube(cvc, 0.02, 18)]), aorta, cvc


def liver(lm, taken):
    """A thick plate on the right half of the diaphragm."""
    T = lm["T"]
    lo = [0.0, floor(lm, T[8]), T[6]]
    hi = [halfwidth(lm, T[12]) + 0.01, spine(lm, T[10]), lm["L"][2]]
    box = box_for(lo, hi)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    # Diaphragm: oblique, from the xiphoid ventrally to T11 dorsally, bulging cranially.
    zd = np.interp(Y, [lm["xiphoid"][1], spine(lm, T[11])], [lm["xiphoid"][2] - 0.02, T[11]]) - 0.035 * np.exp(-((Y - (lm["xiphoid"][1] + spine(lm, T[11])) / 2) ** 2) / 0.01)
    plate = (Z > zd) & (Z < zd + 0.085 - 0.03 * (X < 0.03)) & (X > 0.01) & (X < halfwidth(lm, Z) - 0.004)
    plate &= (Y < spine(lm, Z) - 0.02) & (Y > lm["xiphoid"][1] + 0.08)
    plate &= ~solid_in(box, taken, 2)
    m = largest(ndi.binary_opening(plate, iterations=1))
    return box.surface(m, 1.6, 8)


def spleen(lm):
    T = lm["T"]
    w = halfwidth(lm, T[11])
    path = spline([np.array([-w + 0.025, spine(lm, T[13]) - 0.03, T[13] + 0.01]), np.array([-w + 0.02, spine(lm, T[11]) - 0.13, T[10]]), np.array([-w + 0.03, spine(lm, T[9]) - 0.26, T[8] - 0.01])], 12)
    width = 0.055 * np.sin(np.linspace(0.25, np.pi - 0.25, len(path))) ** 0.5
    # Against the inside of the left ribs (1 cm off), not cut by them.
    ribs = np.concatenate(list(lm["ribs"].values()))
    ribs = ribs[ribs[:, 0] < 0]
    for q in path:
        near = ribs[(np.abs(ribs[:, 2] - q[2]) < 0.03) & (np.abs(ribs[:, 1] - q[1]) < 0.04)]
        if len(near):
            q[0] = max(q[0], near[:, 0].max() + 0.019)
    for _ in range(4):
        path[1:-1] = (path[:-2] + 2 * path[1:-1] + path[2:]) / 4
    return ribbon(path, width, 0.009, [1.0, 0, 0.2], 20)


def kidney(centre, length, axes):
    """Lobed: a bean of small lobes."""
    rng = np.random.default_rng(int(abs(centre[2]) * 1e4))
    box = box_for(centre - length * 0.7, centre + length * 0.7, 0.003)
    m = box.ellipsoid(centre, [length * 0.28, length * 0.33, length * 0.5], axes)
    lobes = np.zeros(box.shape, bool)
    for _ in range(18):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        c = centre + (u * [length * 0.24, length * 0.28, length * 0.42]) @ np.asarray(axes)
        lobes |= box.ellipsoid(c, [length * 0.14] * 3)
    return box.surface(m | lobes, 1.1, 6)


def packed_tube(allowed, g, a, b, length, r, seed=3, iters=1500):
    """A tube of `length` from a to b, packed into the voxel region `allowed`
    (bead centres; already eroded by r) like the jejunum in the abdomen:
    a chain of beads, started on a tour through evenly spread points of the
    region and relaxed with bonds, bending stiffness, contact between beads
    of different stretches and confinement to the region (as in
    scripts/ct/visceral.py)."""
    rng = np.random.default_rng(seed)
    inside = g.lo + np.argwhere(allowed) * g.h
    k = max(8, int(length / (6 * r)))
    c = inside[rng.choice(len(inside), k, replace=False)]
    for _ in range(12):
        lab = cKDTree(c).query(inside)[1]
        c = np.array([inside[lab == i].mean(0) if np.any(lab == i) else c[i] for i in range(k)])
    order, cur, left = [], a, list(range(k))
    while left:
        j = min(left, key=lambda i: np.linalg.norm(c[i] - cur) + 0.3 * np.linalg.norm(c[i] - b) * (len(left) < k / 4))
        order.append(j)
        left.remove(j)
        cur = c[j]
    tour = np.concatenate([[a], c[order], [b]])
    for _ in range(20):
        better = False
        for i in range(1, len(tour) - 2):
            for j in range(i + 1, len(tour) - 1):
                d0 = np.linalg.norm(tour[i - 1] - tour[i]) + np.linalg.norm(tour[j] - tour[j + 1])
                d1 = np.linalg.norm(tour[i - 1] - tour[j]) + np.linalg.norm(tour[i] - tour[j + 1])
                if d1 < d0 - 1e-9:
                    tour[i : j + 1] = tour[i : j + 1][::-1].copy()
                    better = True
        if not better:
            break
    s = 0.7 * r
    n = int(length / s)
    seg = np.linalg.norm(np.diff(tour, axis=0), axis=1)
    u = np.concatenate([[0], np.cumsum(seg)])
    w = np.linspace(0, u[-1], n)
    P = np.stack([np.interp(w, u, tour[:, d]) for d in range(3)], 1)
    P[1:-1] += rng.normal(0, 0.2 * r, (n - 2, 3))
    _, near = ndi.distance_transform_edt(~allowed, return_indices=True)
    fixed = np.zeros(n, bool)
    fixed[:3] = fixed[-3:] = True
    ends = P[fixed].copy()
    for _ in range(iters):
        d = P[1:] - P[:-1]
        L = np.linalg.norm(d, axis=1)[:, None]
        corr = 0.5 * (L - s) / np.maximum(L, 1e-9) * d
        P[:-1] += corr
        P[1:] -= corr
        P[1:-1] += 0.15 * ((P[:-2] + P[2:]) / 2 - P[1:-1])
        pairs = cKDTree(P).query_pairs(2.1 * r, output_type="ndarray")
        pairs = pairs[np.abs(pairs[:, 0] - pairs[:, 1]) > 3]
        if len(pairs):
            d = P[pairs[:, 0]] - P[pairs[:, 1]]
            L = np.linalg.norm(d, axis=1)[:, None]
            push = 0.5 * (2.1 * r - L) / np.maximum(L, 1e-9) * d
            np.add.at(P, pairs[:, 0], push)
            np.add.at(P, pairs[:, 1], -push)
        q = np.clip(np.floor((P - g.lo) / g.h).astype(int), 0, np.array(g.shape) - 1)
        out = ~allowed[tuple(q.T)]
        if out.any():
            to = g.lo + np.stack([near[i][tuple(q[out].T)] for i in range(3)], 1) * g.h
            P[out] += 0.5 * (to - P[out])
        P[fixed] = ends
    return P


def route(path, allowed, g, iters=80):
    """Bends a path (ends fixed) into the voxel region `allowed`: points
    outside it move towards the nearest allowed voxel, then the path is
    smoothed; points outside the grid are left alone."""
    path = path.copy()
    _, near = ndi.distance_transform_edt(~allowed, return_indices=True)
    for _ in range(iters):
        q = np.floor((path - g.lo) / g.h).astype(int)
        ok = np.all((q >= 0) & (q < np.array(g.shape)), 1)
        ok[[0, -1]] = False
        idx = np.argwhere(ok)[:, 0]
        out = idx[~allowed[tuple(q[idx].T)]]
        if len(out):
            to = g.lo + np.stack([near[i][tuple(q[out].T)] for i in range(3)], 1) * g.h
            path[out] += 0.5 * (to - path[out])
        path[1:-1] += 0.3 * ((path[:-2] + path[2:]) / 2 - path[1:-1])
    return path


def colon_centre(lm, occupied, box, x_range, rad):
    """Centre of the spiral colon: the point of the right abdomen, over a
    slab as thick as the disc, furthest from the other organs (in its
    sagittal plane)."""
    xs = box.g.lo[0] + box.g.h * np.arange(box.shape[0])
    best = (-1.0, None)
    for cx in np.arange(x_range[0], x_range[1], 0.01):
        sel = (xs > cx - 0.012) & (xs < cx + 0.036)
        if not sel.any():
            continue
        slab = occupied[sel].any(0)
        d = ndi.distance_transform_edt(~slab) * box.g.h
        j, k = np.unravel_index(np.argmax(d), d.shape)
        if d[j, k] > best[0]:
            best = (d[j, k], np.array([cx, box.g.lo[1] + box.g.h * j, box.g.lo[2] + box.g.h * k]))
    room, c = best
    print(f"  spiral colon: centre {np.round(c, 3)}, room {room:.3f} m")
    return c, min(rad, room - 0.012)


def intestines(lm, taken):
    T, L = lm["T"], lm["L"]
    p = lm["pecten"]
    # Right half of the abdomen, caudal to the omasum and abomasum, inside
    # the body wall: the space the bowel shares.
    lo = np.array([0.0, floor(lm, L[2]) + 0.02, T[13]])
    hi = np.array([halfwidth(lm, L[3]) - 0.01, spine(lm, L[3]) - 0.03, p[2] - 0.05])
    box = box_for(lo, hi)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    wall = (X < halfwidth(lm, Z) - 0.012) & (Y > floor(lm, Z) + 0.012) & (Y < spine(lm, Z) - 0.035)
    occupied = solid_in(box, taken, 2) | ~wall
    # Spiral colon: a disc in a sagittal plane (two centripetal and two
    # centrifugal turns) in the largest free space of the right flank.
    c, R = colon_centre(lm, occupied, box, (0.012, hi[0] - 0.036), 0.085)
    turns = np.linspace(0, 2 * 2 * np.pi, 160)
    rad = R * (1 - turns / turns[-1] * 0.8)
    inward = c + np.stack([np.zeros_like(turns), rad * np.cos(turns), rad * np.sin(turns)], 1)
    outward_ = c + np.stack([np.full_like(turns, 0.025), (rad[::-1] - 0.012) * np.cos(turns[::-1] + 0.4), (rad[::-1] - 0.012) * np.sin(turns[::-1] + 0.4)], 1)
    # Cecum: from the ileocolic junction caudodorsally, its blind end towards
    # the pelvic inlet; proximal loop of the ascending colon to the spiral.
    ileum_end = np.array([c[0] + 0.02, c[1] - R - 0.03, c[2] + 0.04])
    cecum = spline([ileum_end, ileum_end + [0.01, 0.015, 0.07], np.array([c[0] + 0.02, spine(lm, L[6]) - 0.11, p[2] - 0.08])], 8)
    proximal = spline([ileum_end, ileum_end + [0.0, 0.03, -0.04], c + [0.0, R + 0.02, -0.05], inward[0]], 8)
    # Descending colon caudally along the roof of the abdomen, then the rectum
    # under the sacrum: a gentle ventral sag at the pelvic inlet, rising to
    # the anus under the first caudal vertebrae.
    roof = np.concatenate([lm["pts"]("sacrum")] + [lm["pts"](f"vertebrae-caudal_cd{i}") for i in (1, 2, 3)])

    def under(z):
        q = roof[(np.abs(roof[:, 2] - z) < 0.02) & (np.abs(roof[:, 0]) < 0.03)]
        return (q[:, 1].min() if len(q) else spine(lm, z)) - 0.045

    rz = np.linspace(L[6], lm["ox"][:, 2].max() + 0.01, 7)
    sag = 0.035 * np.sin(np.linspace(0, np.pi, len(rz))) ** 1.5
    rectum = [np.array([0.0, under(z) - d, z]) for z, d in zip(rz, sag)]
    descending = spline([outward_[-1], outward_[-1] + [-0.01, 0.03, 0.03], np.array([0.015, spine(lm, L[4]) - 0.065, L[4]]), np.array([0.005, spine(lm, L[5]) - 0.06, L[5]])] + rectum, 8)
    for _ in range(3):
        descending[1:-1] = (descending[:-2] + 2 * descending[1:-1] + descending[2:]) / 4
    lbox = box_for(np.minimum(cecum.min(0), descending.min(0)) - 0.05, np.maximum(np.maximum(cecum.max(0), descending.max(0)), c + R + 0.03) + 0.05)
    # The connecting stretches are bent around the rumen, kidneys and liver.
    # The cecum ends in the roomiest spot of the right dorsal flank towards
    # the pelvic inlet.
    free = ndi.distance_transform_edt(~solid_in(lbox, taken, 1)) * lbox.g.h
    Xl, Yl, Zl = (c_.reshape(lbox.shape) for c_ in lbox.pts.T)
    flank = (Xl > 0.01) & (Xl < halfwidth(lm, Zl) - 0.04) & (Yl > (floor(lm, Zl) + spine(lm, Zl)) / 2) & (Yl < spine(lm, Zl) - 0.05)
    blind = np.where(flank & (Zl > L[5]) & (Zl < p[2] - 0.03), free, 0)
    blind = lbox.g.lo + np.array(np.unravel_index(np.argmax(blind), blind.shape)) * lbox.g.h
    cecum = spline([ileum_end, (ileum_end + blind) / 2 + [0.0, 0.02, 0.0], blind], 8)
    cecum = route(cecum, free > 0.016, lbox.g)
    proximal = route(proximal, free > 0.012, lbox.g)
    descending = route(descending, free > 0.011, lbox.g)
    li = lbox.tube(cecum, np.linspace(0.03, 0.026, len(cecum))) | lbox.tube(proximal, 0.018) | lbox.tube(inward, 0.011) | lbox.tube(outward_, 0.01) | lbox.tube(descending, 0.016)
    li &= ~solid_in(lbox, taken)
    large = lbox.surface(keep_main(li, 0.02), 1.0, 6)
    # Small intestine: one tube packed into the free ventral space, from the
    # duodenum (caudal to the abomasum) to the ileocolic junction.
    r = 0.014
    space = ~occupied & ~solid_in(box, [large], 2)
    allowed = largest(ndi.distance_transform_edt(space) * box.g.h > r * 1.05)
    inside = box.g.lo + np.argwhere(allowed) * box.g.h
    start = inside[np.argmin(inside[:, 2] - 0.3 * inside[:, 1])]
    end = inside[np.argmin(np.linalg.norm(inside - ileum_end, axis=1))]
    length = 0.35 * space.sum() * box.g.h**3 / (np.pi * r * r)
    beads = packed_tube(allowed, box.g, start, end, length, r)
    jej = spline(beads[::2], 3)
    jej = np.concatenate([jej, [ileum_end]])
    print(f"  small intestine: {length:.2f} m packed")
    small = tube(jej, r, 14)
    return small, large


def pancreas(lm):
    T, L = lm["T"], lm["L"]
    path = spline([np.array([0.07, spine(lm, T[13]) - 0.07, T[12]]), np.array([0.05, spine(lm, L[1]) - 0.06, L[1]]), np.array([0.02, spine(lm, L[2]) - 0.05, L[2] + 0.02])], 8)
    return ribbon(path, 0.03, 0.008, [0, 1.0, 0], 16)


def pelvic(lm):
    p = lm["pecten"]
    roof = lm["pts"]("sacrum")
    canal_top = roof[np.abs(roof[:, 0]) < 0.03][:, 1].min()
    bladder = ellipsoid(p + [0, 0.03, -0.05], [0.04, 0.028, 0.06], np.eye(3), 24)
    cervix = np.array([0.0, canal_top - 0.028, p[2] + 0.06])
    bif = np.array([0.0, p[1] + 0.085, p[2] - 0.01])
    body = spline([cervix, (cervix + bif) / 2, bif], 6)
    horns, ovaries = [], []
    for s in (-1, 1):
        # Ram's horn: forward, down, back and up again, lateral.
        h = spline([bif, bif + [s * 0.025, 0.01, -0.04], bif + [s * 0.05, -0.03, -0.07], bif + [s * 0.065, -0.07, -0.04], bif + [s * 0.06, -0.06, 0.0]], 8)
        horns.append(h)
        ovaries.append(ellipsoid(h[-1] + [s * 0.015, 0.0, 0.015], [0.012, 0.018, 0.022], np.eye(3), 16))
    uterus = merge([tube(body, 0.016, 16)] + [tube(h, np.linspace(0.014, 0.006, len(h)), 14) for h in horns])
    return bladder, uterus, ovaries


def lungs(lm, cage_pts, taken, heart, mediastinal):
    T = lm["T"]
    ribs = np.concatenate(list(lm["ribs"].values()))
    lo = np.array([-lm["cage"], lm["xiphoid"][1] - 0.02, ribs[:, 2].min() - 0.01])
    hi = np.array([lm["cage"], ribs[:, 1].max(), T[13]])
    box = box_for(lo, hi)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    # Rib cage sections: convex hull of the ribs within 2 cm of each slice, less the wall.
    from scipy.spatial import ConvexHull

    inside = np.zeros(box.shape, bool)
    zs = box.g.lo[2] + box.g.h * np.arange(box.shape[2])
    for k, z in enumerate(zs):
        q = cage_pts[np.abs(cage_pts[:, 2] - z) < 0.02][:, :2]
        q = np.concatenate([q, q * [-1, 1]])
        if len(q) < 10:
            continue
        eq = ConvexHull(q).equations
        eq = eq + [0, 0, 0.01]
        xs, ys = X[:, :, k], Y[:, :, k]
        inside[:, :, k] = np.all(eq[:, 0][:, None, None] * xs + eq[:, 1][:, None, None] * ys + eq[:, 2][:, None, None] <= 0, axis=0)
    s = inside & (Y < spine(lm, Z) - 0.01) & (Y > floor(lm, Z) + 0.005)
    # Cupula at the first rib.
    s &= Z > ribs[:, 2].min() + 0.01
    # Diaphragm: oblique plane from the xiphoid to T11, and clear of the abdominal organs.
    zd = np.interp(Y, [lm["xiphoid"][1], spine(lm, T[11])], [lm["xiphoid"][2] - 0.03, T[11]])
    s &= Z < zd
    s &= ~solid_in(box, taken, 3)
    s &= ~solid_in(box, [heart], 3)
    s &= ~solid_in(box, mediastinal, 2)
    s &= ~((np.abs(X - 0.0) < 0.04) & (Y > spine(lm, Z) - 0.03))  # vertebral bodies, longus colli
    # The ribs, in this grid: the surface smoothing turns them into shallow
    # costal impressions instead of the saw-tooth of a fine carve.
    s &= ~solid_in(box, [lm["mesh"](f"ribs_{k}_{side}") for k in range(1, 14) for side in "LR"] + [lm["mesh"]("sternum")])
    s &= np.abs(X + 0.008) > 0.006  # mediastinum, left of the median plane
    return {
        "lungs.L": box.surface(largest(s & (X < -0.008)), 1.6, 8),
        "lungs.R": box.surface(largest(s & (X > -0.008)), 1.6, 8),
    }


def brain(lm):
    """Modeled: the photogrammetry skull has no inner surface (and the bovine
    frontal sinus would fill most of an enclosed volume anyway). Cerebrum,
    cerebellum and brainstem as smooth solids in the caudal skull: the
    brainstem ends at the foramen magnum (between the occipital condyles, the
    caudoventral end of the skull), the cerebellum dorsal to it under the
    nuchal crest, the cerebrum rostral to the cerebellum."""
    p = lm["skull"][0]
    # In cattle the poll is the caudal end of the skull; the condyles are the
    # caudal end of its ventral half.
    lo, hi = p[:, 1].min(), p[:, 1].max()
    low = p[(p[:, 1] < lo + 0.5 * (hi - lo)) & (np.abs(p[:, 0]) < 0.04)]
    zc = low[:, 2].max()
    magnum = np.array([0.0, low[low[:, 2] > zc - 0.015][:, 1].mean() + 0.01, zc - 0.012])
    cb = np.array([0.0, magnum[1] + 0.035, zc - 0.035])
    cr = np.array([0.0, magnum[1] + 0.03, cb[2] - 0.065])
    box = box_for(cr - 0.1, cb + 0.08, 0.002)
    X = box.pts[:, 0].reshape(box.shape)
    cerebrum = box.ellipsoid(cr, [0.048, 0.04, 0.058]) & ~((np.abs(X) < 0.0025) & (box.pts[:, 1].reshape(box.shape) > cr[1]))
    cerebellum = box.ellipsoid(cb, [0.036, 0.03, 0.024]) & ~cerebrum
    stem = box.tube(spline([cr + [0, -0.025, 0.035], cb + [0, -0.03, -0.005], magnum], 8), 0.014) & ~cerebrum & ~cerebellum
    return {n: box.surface(largest(m), 1.0, 6) for n, m in (("brain.cerebrum", cerebrum), ("brain.cerebellum", cerebellum), ("brain.brainstem", stem))}


# --- main ---------------------------------------------------------------------------------


def main(work):
    sk = read(os.path.join(work, "skeleton"))
    lm = landmarks(sk)
    print(f"cage half-width {lm['cage']:.3f}, xiphoid {np.round(lm['xiphoid'], 3)}, pecten {np.round(lm['pecten'], 3)}")
    out = {}
    stomach = place_stomach(lm, read(os.path.join(work, "stomach")))
    for k, m in stomach.items():
        out[f"cow.visceral.{k}"] = m
    heart = place_heart(lm, read(os.path.join(work, "heart"))["heart"])
    out["cow.visceral.heart"] = heart
    T = lm["T"]
    base = np.array([0.005, spine(lm, T[4]) - 0.4 * (spine(lm, T[4]) - lm["xiphoid"][1]), T[4] + 0.01])

    print("  airways")
    trachea_m, trachea, bronchi, larynx, inlet, carina, neck = airways(lm)
    out["cow.visceral.trachea"] = trachea_m
    out["cow.visceral.thyroid"] = thyroid(trachea, larynx)
    ret = stomach["reticulum"][0]
    cardia = ret[ret[:, 1] > ret[:, 1].max() - 0.02].mean(0)
    out["cow.visceral.esophagus"], esoph = esophagus(lm, larynx, neck, inlet, carina, cardia)

    print("  liver")
    gut = [stomach[k] for k in ("rumen", "reticulum", "omasum", "abomasum")]
    out["cow.visceral.liver"] = liver(lm, gut)
    liver_top = out["cow.visceral.liver"][0][:, 1].max()
    out["cow.visceral.great-vessels"], aorta, cvc = vessels(lm, base, liver_top)
    out["cow.visceral.spleen"] = spleen(lm)
    out["cow.visceral.pancreas"] = pancreas(lm)
    L = lm["L"]
    out["cow.visceral.kidneys.R"] = kidney(np.array([0.07, spine(lm, L[1]) - 0.045, (T[13] + L[2]) / 2]), 0.16, np.eye(3))
    out["cow.visceral.kidneys.L"] = kidney(np.array([0.035, spine(lm, L[4]) - 0.075, L[4]]), 0.15, np.eye(3))

    print("  intestines")
    taken = gut + [out[f"cow.visceral.{k}"] for k in ("liver", "kidneys.R", "kidneys.L", "pancreas")]
    out["cow.visceral.small-intestine"], out["cow.visceral.large-intestine"] = intestines(lm, taken)
    out["cow.visceral.urinary-bladder"], out["cow.visceral.uterus"], ovaries = pelvic(lm)
    out["cow.visceral.ovaries.L"], out["cow.visceral.ovaries.R"] = ovaries

    print("  lungs")
    cage_pts = np.concatenate([np.concatenate(list(lm["ribs"].values())), lm["sternum"]])
    mediastinal = [out["cow.visceral.trachea"], out["cow.visceral.esophagus"], out["cow.visceral.great-vessels"]]
    for k, m in lungs(lm, cage_pts, gut + [out["cow.visceral.liver"], out["cow.visceral.spleen"]], heart, mediastinal).items():
        out[f"cow.visceral.{k}"] = m

    print("  brain")
    for k, m in brain(lm).items():
        out[f"cow.visceral.{k}"] = m

    # Ribs, vertebrae and sternum are kept off by construction (the paths run
    # below the vertebral bodies and inside the ribs, the lungs are cut in
    # their own grid): carving against them bit notches into the organs.
    bones = [m for k, m in sk.items() if not any(b in k for b in ("skull", "mandible", "ribs", "vertebrae", "sternum", "atlas", "axis", "sacrum"))]
    for k in list(out):
        if "brain" in k:
            continue
        out[k] = outward(carve(out[k], bones, 0.003))
    for k, m in out.items():
        print(f"{k}: {len(m[1])} triangles, centre {np.round(m[0].mean(0), 3)}, size {np.round(np.ptp(m[0], 0), 3)}")
    write(os.path.join(work, "organs"), out)


if __name__ == "__main__":
    main(sys.argv[1])
