"""
Organ geometry for scripts/build-horse-visceral.ts (which exports the inputs,
runs this script and writes the GLB).

    .venv/bin/python -I scripts/ct/horse_visceral.py <work-dir>

Inputs in <work-dir> (json index + bin, same layout as greyhound_hindlimb.py):
heart (UNSA plastinate, metres, base up), stomach (shiftstudio model, centred,
stumps towards +z, blind sac +y), colon (OVC large colon, centred, open end
of the horseshoe +x, right ventral colon +y, ventral layer -z) and skeleton
(our skeletal.glb, atlas frame). Output: organs.json/.bin, one mesh per mesh
id in the atlas frame (metres, Y up, animal faces -Z, left side -X).

Scanned organs (placement "modeled"):
- Heart: long axis from the base (ventral to T4, a little above the middle of
  the thorax) to the apex (on the sternum at the 6th costal cartilage, left of
  the median plane), scaled so the ventricles fill that span.
- Stomach: in the left cranial abdomen against the diaphragm, the blind sac
  dorsal under the 15th-16th ribs, the cardia near the median plane, the
  pylorus to the right; its long axis turned to run from left dorsal to right
  ventral.
- Large colon: on the abdominal floor from the diaphragm (sternal and
  diaphragmatic flexures) to the pelvic inlet (pelvic flexure, left), scaled
  as one; the right colons on the right of the median plane.

Procedural organs (fidelity "illustrative"), from skeletal landmarks and
equine topography:
- Diaphragm: very oblique, attached from the xiphoid ventrally along the
  costal arch to the 17th rib dorsally, its dome bulging cranially to the 6th
  intercostal space. Lungs: the rib cage sections cranial to it, less heart,
  mediastinum, airways, esophagus and great vessels; not lobed (no
  interlobar fissures), the right lung a little larger (accessory lobe).
- Trachea from the larynx (between the mandibular angles) along the ventral
  neck to the bifurcation at T5-T6 (no tracheal bronchus in the horse);
  esophagus dorsal and then left of the trachea, through the hiatus at T14 to
  the cardia; thyroid lobes on the 2nd-3rd tracheal rings joined by a thin
  isthmus; aorta and caudal vena cava.
- Liver: a thick plate on the abdominal face of the diaphragm, most of it
  right of the median plane (the right lobe reaching the right kidney), the
  left lobes ventral. No gallbladder. Pancreas along the duodenum ventral to
  the right kidney.
- Spleen: sickle-shaped, its broad base dorsal under the last left ribs and
  the left kidney, its narrow apex cranioventral along the left wall.
- Kidneys smooth: the right heart-shaped under the last ribs (T16-T18), the
  left bean-shaped and more caudal (T18-L2).
- Cecum: comma-shaped, its base in the right flank, body running
  cranioventrally along the right wall to the apex on the abdominal floor near
  the xiphoid. Small colon coiled in the left dorsal caudal abdomen, then the
  rectum under the sacrum; jejunum coiled in the left dorsal abdomen with it,
  duodenum from the pylorus on the right around the base of the cecum.
- Urinary bladder on the pelvic floor, uterus (body and straight horns under
  the lumbar region, Y-shaped) and ovaries ventral to L4-L5 (a mare).
- Brain: cerebrum, cerebellum and brainstem modeled in the caudal skull from
  the foramen magnum (the CT's cranial cavity is open through its holes and
  sinuses, so it cannot be filled).
"""
import os
import sys

import numpy as np
from scipy import ndimage as ndi

# -I leaves the script's directory off sys.path; the helpers live next door.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cat_visceral import Box, carve, frame, keep_main  # noqa: E402
from visceral import ellipsoid, largest, merge, outward, packed_tube, read, ribbon, spline, tube, write  # noqa: E402

H = 0.006  # voxel size of the procedural organs (m)


# --- skeleton -----------------------------------------------------------------------


def landmarks(sk):
    def pts(name):
        return sk[f"horse_skeletal_{name}"][0]

    def ventral(q):
        near = q[np.abs(q[:, 0]) < 0.02]
        return near[:, 1].min()

    lm = {"pts": pts}
    verts = [f"vertebrae-thoracic_t{i}" for i in range(2, 19)] + [f"vertebrae-lumbar_l{i}" for i in range(1, 7)] + ["sacrum"]
    lm["spine_z"] = np.array([pts(n)[:, 2].mean() for n in verts])
    lm["spine_y"] = np.array([ventral(pts(n)) for n in verts])
    lm["T"] = {i: pts(f"vertebrae-thoracic_t{i}")[:, 2].mean() for i in range(1, 19)}
    lm["L"] = {i: pts(f"vertebrae-lumbar_l{i}")[:, 2].mean() for i in range(1, 7)}
    lm["ribs"] = {k: np.concatenate([pts(f"ribs_{k}_L"), pts(f"ribs_{k}_R")]) for k in range(1, 19)}
    allribs = np.concatenate(list(lm["ribs"].values()))
    lm["cage"] = np.abs(allribs[:, 0]).max()
    st = pts("sternum")
    lm["sternum"] = st
    lm["xiphoid"] = st[np.argmax(st[:, 2])]
    lm["manubrium"] = st[np.argmin(st[:, 2])]
    ox = np.concatenate([pts("os-coxae_L"), pts("os-coxae_R")])
    pubis = ox[(np.abs(ox[:, 0]) < 0.03) & (ox[:, 1] < ox[:, 1].min() + 0.07)]
    lm["pecten"] = pubis[np.argmin(pubis[:, 2])]
    lm["ox"] = ox
    lm["skull"] = sk["horse_skeletal_skull"]
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
    sag = 0.1 * np.sin(np.pi * t) ** 0.8
    y = x0[1] + (p[1] - x0[1]) * t**1.6 - sag
    st = lm["sternum"]
    return np.where(z < x0[2], np.interp(z, *zip(*sorted((q[2], q[1]) for q in st[::40]))) + 0.018, y + 0.015)


def halfwidth(lm, z):
    """Half-width of the body cavity: the rib cage (less the wall), widest at
    the last ribs, narrowing to the pelvic inlet."""
    p = lm["pecten"]
    T, L = lm["T"], lm["L"]
    return np.interp(z, [T[1], T[6], T[14], L[2], p[2]], [lm["cage"] * 0.45, lm["cage"] - 0.04, lm["cage"] - 0.02, lm["cage"] - 0.03, 0.1])


def diaphragm(lm, y, x=0.0):
    """Craniocaudal position of the diaphragm at height y and side x: the
    attachment runs from the xiphoid to T17, the dome bulges cranially in the
    middle and flattens towards the wall, leaving the costodiaphragmatic
    recess lateral to the abdominal organs."""
    T = lm["T"]
    y0, y1 = lm["xiphoid"][1], spine(lm, T[17])
    z0, z1 = lm["xiphoid"][2] - 0.03, T[17]
    t = np.clip((np.asarray(y, float) - y0) / (y1 - y0), 0, 1)
    dome = (z1 - lm["ribs"][7][:, 2].mean()) * 0.55
    side = np.clip((np.abs(x) / lm["cage"] - 0.45) / 0.55, 0, 1) ** 1.5
    return z0 + (z1 - z0) * t - dome * np.sin(np.pi * t) ** 1.2 * (1 - 0.7 * side)


# --- scanned organs ---------------------------------------------------------------------


def place_heart(lm, heart):
    p, f = heart
    T = lm["T"]
    r6 = np.concatenate([lm["pts"]("ribs_6_L"), lm["pts"]("ribs_6_R")])
    apex_z = r6[r6[:, 1] < r6[:, 1].min() + 0.05][:, 2].mean()
    st = lm["sternum"]
    apex = np.array([-0.03, np.interp(apex_z, *zip(*sorted((q[2], q[1]) for q in st[::40]))) + 0.08, apex_z])
    top = spine(lm, T[4])
    base = np.array([0.0, top - 0.42 * (top - apex[1]), T[4]])
    axis = apex - base
    L = np.linalg.norm(axis)
    # The plastinate: base up (+y); the ventricles are about 70% of its height.
    lo, hi = p[:, 1].min(), p[:, 1].max()
    k = L / (0.7 * (hi - lo))
    centre_src = np.array([p[:, 0].mean(), hi - 0.3 * (hi - lo), p[:, 2].mean()])
    F = frame(-axis, [0, 0, -1.0])  # rows: up the heart, cranial, side
    R = np.array([F[2], F[0], -F[1]]).T  # source x, y, z -> side, up, caudal
    if np.linalg.det(R) < 0:
        R[:, 0] *= -1
    q = ((p - centre_src) * k) @ R.T + base
    print(f"  heart: scale {k:.3f}, base {np.round(base, 3)}, apex {np.round(apex, 3)}, size {np.round(np.ptp(q, 0), 3)}")
    return (q, f if np.linalg.det(R) > 0 else f[:, ::-1]), base


def place_stomach(lm, stomach):
    """Turned 90 deg about y (stumps to the right, flattened craniocaudally),
    greatest length 0.36 m, the blind sac under the 15th-16th left ribs."""
    p, f = stomach
    T = lm["T"]
    a = np.radians(90)
    R = np.array([[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]])
    tilt = np.radians(-20)  # roll so the blind sac leans to the left
    Rz = np.array([[np.cos(tilt), -np.sin(tilt), 0], [np.sin(tilt), np.cos(tilt), 0], [0, 0, 1]])
    q = p @ R.T @ Rz.T
    q *= 0.36 / np.ptp(q, 0).max()
    top_y = spine(lm, T[15]) - 0.12
    centre_z = T[15] - 0.02
    shift = np.array([-0.06 - q[:, 0].mean(), top_y - q[:, 1].max(), centre_z - q[:, 2].mean()])
    q = q + shift
    print(f"  stomach: size {np.round(np.ptp(q, 0), 3)}, centre {np.round(q.mean(0), 3)}")
    return q, f


def place_colon(lm, colon):
    p, f = colon
    q = p[:, [1, 2, 0]].copy()  # model y, z, x -> atlas x, y, z (a proper rotation)
    z0 = lm["xiphoid"][2] + 0.02
    z1 = lm["pecten"][2] - 0.06
    s = (z1 - z0) / np.ptp(q[:, 2])
    q *= s
    # Narrowed to the abdomen if wider (a fixed specimen sags sideways).
    q[:, 0] *= min(1.0, (2 * halfwidth(lm, lm["L"][1]) - 0.06) / np.ptp(q[:, 0]))
    mid = (z0 + z1) / 2
    shift = np.array([0.02 - q[:, 0].mean(), floor(lm, mid) + 0.01 - q[:, 1].min(), z0 - q[:, 2].min()])
    q = q + shift
    print(f"  large colon: scale {s:.3f}, size {np.round(np.ptp(q, 0), 3)}")
    return q, f


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
        near = q[np.abs(q[:, 0]) < 0.03]
        neck.append(np.array([0.0, near[:, 1].min(), near[near[:, 1] < near[:, 1].min() + 0.015][:, 2].mean()]))
    md = lm["pts"]("mandible")
    larynx = np.array([0.0, md[md[:, 2] > md[:, 2].max() - 0.06][:, 1].min() + 0.02, md[:, 2].max() + 0.03])
    inlet = np.array([0.0, (lm["manubrium"][1] + spine(lm, T[2])) / 2 + 0.04, lm["manubrium"][2] + 0.02])
    carina = np.array([0.0, spine(lm, T[6]) - 0.1, (T[5] + T[6]) / 2])
    trachea = spline([larynx, neck[0] + [0, -0.08, 0.02]] + [q + [0, -0.07, 0] for q in neck[2:]] + [inlet, (inlet + carina) / 2 + [0, 0.015, 0], carina], 10)
    r = 0.028
    bronchi = [spline([carina, carina + [s * 0.04, -0.015, 0.035], carina + [s * 0.085, -0.04, 0.09]], 6) for s in (-1, 1)]
    mesh = merge([tube(trachea, r, 20)] + [tube(b, 0.018, 16) for b in bronchi])
    return mesh, trachea, larynx, inlet, carina, neck


def thyroid(trachea, larynx):
    i = int(np.argmin(np.abs(trachea[:, 2] - (larynx[2] + 0.07))))
    d = trachea[i + 2] - trachea[i - 2]
    d /= np.linalg.norm(d)
    parts = []
    for s in (-1, 1):
        lat = np.array([s * 1.0, 0, 0])
        c = trachea[i] + lat * 0.038 + np.array([0, 0.008, 0])
        parts.append(ellipsoid(c, [0.013, 0.03, 0.022], np.array([lat, d, np.cross(lat, d)]), 18))
    # Thin (mostly fibrous) isthmus ventral to the trachea.
    parts.append(tube(spline([trachea[i] + [-0.036, -0.012, 0.004], trachea[i] + [0, -0.032, 0.004], trachea[i] + [0.036, -0.012, 0.004]], 6), 0.003, 10))
    return merge(parts)


def esophagus(lm, larynx, neck, inlet, carina, cardia):
    T = lm["T"]
    path = spline(
        [larynx + [0, 0.05, -0.02], neck[0] + [0, -0.035, 0.02], neck[2] + [-0.015, -0.04, 0], neck[4] + [-0.04, -0.055, 0],
         inlet + [-0.04, 0.05, 0.01], np.array([-0.008, spine(lm, T[3]) - 0.045, T[3]]), carina + [0.0, 0.055, 0],
         np.array([0.0, spine(lm, T[10]) - 0.09, T[10]]), np.array([-0.02, spine(lm, T[14]) - 0.13, T[14]]), cardia + [0, 0.03, -0.03], cardia], 10)
    return tube(path, 0.018, 16), path


def vessels(lm, base, liver_top):
    T, L = lm["T"], lm["L"]
    root = base + [0.0, 0.03, -0.02]
    aorta = spline([root, root + [-0.01, 0.1, -0.02], np.array([-0.04, spine(lm, T[5]) - 0.035, T[5]]),
                    np.array([-0.03, spine(lm, T[9]) - 0.03, T[9]]), np.array([-0.022, spine(lm, T[16]) - 0.028, T[16]]),
                    np.array([-0.018, spine(lm, L[3]) - 0.028, L[3]]), np.array([-0.014, spine(lm, L[5]) - 0.03, L[5]])], 10)
    bct = spline([root + [0.0, 0.11, -0.02], root + [0.012, 0.14, -0.11], np.array([0.0, (lm["manubrium"][1] + spine(lm, T[2])) / 2, lm["manubrium"][2] + 0.03])], 8)
    cvc = spline([base + [0.035, -0.03, 0.05], np.array([0.04, liver_top - 0.03, diaphragm(lm, liver_top - 0.03) + 0.02]),
                  np.array([0.035, spine(lm, T[17]) - 0.05, T[17]]), np.array([0.025, spine(lm, L[3]) - 0.04, L[3]]),
                  np.array([0.02, spine(lm, L[5]) - 0.04, L[5]])], 10)
    return merge([tube(aorta, 0.024, 18), tube(bct, 0.016, 14), tube(cvc, 0.026, 18)]), aorta, cvc


def liver(lm, taken):
    """A thick plate on the abdominal face of the diaphragm: the right part
    reaches dorsally to the right kidney, the left lobes stay ventral."""
    T = lm["T"]
    hw = halfwidth(lm, T[14])
    lo = [-hw, floor(lm, T[10]), lm["xiphoid"][2] - 0.25]
    hi = [hw, spine(lm, T[12]), T[18]]
    box = box_for(lo, hi)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    zd = diaphragm(lm, Y, X)
    thick = 0.1 - 0.035 * (X < 0)
    plate = (Z > zd) & (Z < zd + thick) & (np.abs(X) < halfwidth(lm, Z) - 0.01)
    yspan = spine(lm, Z) - lm["xiphoid"][1]
    plate &= (Y < spine(lm, Z) - 0.05) & (Y > lm["xiphoid"][1] + 0.12)
    # Left lobes: ventral half only.
    plate &= ~((X < -0.02) & (Y > lm["xiphoid"][1] + 0.55 * yspan))
    plate &= ~solid_in(box, taken, 2)
    m = largest(ndi.binary_opening(plate, iterations=1))
    return box.surface(m, 1.6, 8)


def spleen(lm):
    T = lm["T"]
    w = halfwidth(lm, T[16])
    top, bottom = spine(lm, T[17]) - 0.05, floor(lm, T[11]) + 0.12
    path = spline([np.array([-w + 0.05, top, T[18] + 0.02]), np.array([-w + 0.025, top + (bottom - top) * 0.35, T[16]]),
                   np.array([-w + 0.03, top + (bottom - top) * 0.7, T[14]]), np.array([-w + 0.06, bottom, T[12]])], 12)
    width = np.linspace(0.1, 0.025, len(path)) * np.sin(np.linspace(0.35, np.pi - 0.15, len(path))) ** 0.4
    return ribbon(path, width, 0.022, [1.0, 0, 0.15], 20)


def kidneys(lm):
    T, L = lm["T"], lm["L"]
    out = {}
    # Right: heart-shaped, under the last ribs.
    c = np.array([0.1, spine(lm, T[17]) - 0.055, T[17]])
    box = box_for(c - 0.12, c + 0.12, 0.003)
    m = box.ellipsoid(c, [0.075, 0.035, 0.07]) | box.ellipsoid(c + [0.02, 0, -0.035], [0.06, 0.03, 0.05])
    m &= ~box.ellipsoid(c + [-0.075, 0, 0.0], [0.025, 0.02, 0.025])  # hilus
    out["kidneys.R"] = box.surface(m, 1.2, 6)
    # Left: bean-shaped, more caudal.
    c = np.array([-0.1, spine(lm, L[1]) - 0.065, (T[18] + L[2]) / 2])
    box = box_for(c - 0.12, c + 0.12, 0.003)
    m = box.ellipsoid(c, [0.05, 0.035, 0.09])
    m &= ~box.ellipsoid(c + [0.05, 0, 0.0], [0.022, 0.02, 0.03])
    out["kidneys.L"] = box.surface(m, 1.2, 6)
    return out


def coil_path(lo, hi, step, rng):
    """Serpentine through a box: back and forth along z, stepping in x and y."""
    pts = []
    xs = np.arange(lo[0] + step, hi[0] - step / 2, step * 1.4)
    ys = np.arange(lo[1] + step, hi[1] - step / 2, step * 1.3)
    flip = False
    for j, y in enumerate(ys):
        for x in (xs if j % 2 == 0 else xs[::-1]):
            zz = [lo[2] + step, hi[2] - step]
            if flip:
                zz = zz[::-1]
            flip = not flip
            for z in np.linspace(zz[0], zz[1], 5):
                pts.append([x + rng.normal(0, step * 0.15), y + rng.normal(0, step * 0.15), z])
    return spline(np.array(pts), 4)


def cecum(lm, taken):
    """Base in the right flank, body along the right wall, apex on the floor
    caudal to the xiphoid."""
    L = lm["L"]
    x0 = lm["xiphoid"]
    base = np.array([halfwidth(lm, L[2]) - 0.15, spine(lm, L[2]) - 0.17, L[2]])
    path = spline([base + [0, 0.02, 0.1], base, np.array([halfwidth(lm, L[1]) - 0.13, (spine(lm, L[1]) + floor(lm, L[1])) / 2, (L[1] + x0[2]) / 2 + 0.1]),
                   np.array([0.12, floor(lm, x0[2] + 0.35) + 0.09, x0[2] + 0.3]), np.array([0.05, floor(lm, x0[2] + 0.15) + 0.06, x0[2] + 0.13])], 10)
    radii = np.interp(np.linspace(0, 1, len(path)), [0, 0.2, 0.6, 1], [0.12, 0.12, 0.09, 0.045])
    box = box_for(path.min(0) - 0.13, path.max(0) + 0.13)
    m = box.tube(path, radii) & ~solid_in(box, taken, 1)
    return box.surface(keep_main(m, 0.05), 1.2, 6), base


def small_colon(lm, taken, bones):
    """Packed into the left dorsal caudal abdomen like the jejunum (a tube
    relaxed into the free space, not a lattice), then the rectum under the
    sacrum to the anus."""
    L = lm["L"]
    p = lm["pecten"]
    r = 0.034
    lo = np.array([-halfwidth(lm, L[3]) + 0.05, spine(lm, L[3]) - 0.4, L[1]])
    hi = np.array([-0.02, spine(lm, L[3]) - 0.11, p[2] - 0.05])
    box = box_for(lo - 0.04, hi + 0.04)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    space = (X > lo[0]) & (X < hi[0]) & (Y > lo[1]) & (Y < hi[1]) & (Z > lo[2]) & (Z < hi[2]) & ~solid_in(box, taken + bones, 1)
    allowed = largest(ndi.distance_transform_edt(space) * H > r * 1.05)
    inside = box.g.lo + np.argwhere(allowed) * H
    # From the transverse colon (cranial, near the median plane) to the
    # pelvic inlet.
    a = inside[np.argmin(np.linalg.norm(inside - [hi[0], hi[1], lo[2]], axis=1))]
    b = inside[np.argmin(np.linalg.norm(inside - [hi[0], (lo[1] + hi[1]) / 2, hi[2]], axis=1))]
    length = min(3.5, 0.35 * space.sum() * H**3 / (np.pi * r * r))
    beads = packed_tube(allowed, box.g, a, b, length, r, seed=11)
    coil = spline(beads[::2], 3)
    roof = np.concatenate([lm["pts"]("sacrum")] + [lm["pts"](f"vertebrae-caudal_cd{i}") for i in (1, 2, 3)])

    def under(z):
        q = roof[(np.abs(roof[:, 2] - z) < 0.03) & (np.abs(roof[:, 0]) < 0.04)]
        return (q[:, 1].min() if len(q) else spine(lm, z)) - 0.06

    rectum = spline([coil[-1]] + [np.array([0.0, under(z), z]) for z in np.linspace(p[2] - 0.02, lm["ox"][:, 2].max() + 0.02, 6)], 8)
    print(f"  small colon: {length:.2f} m")
    return merge([tube(coil, r, 16), tube(rectum, 0.038, 16)])


def small_intestine(lm, taken, pylorus, cecum_base):
    """Duodenum from the pylorus caudally on the right, around the base of the
    cecum and across to the left; jejunum coiled in the left dorsal abdomen;
    ileum to the medial side of the cecal base."""
    T, L = lm["T"], lm["L"]
    rng = np.random.default_rng(7)
    duo = spline([pylorus, pylorus + [0.06, 0.02, 0.06], np.array([0.15, spine(lm, T[17]) - 0.18, T[17]]),
                  np.array([0.12, spine(lm, L[2]) - 0.06, L[2] + 0.03]), np.array([0.0, spine(lm, L[2]) - 0.1, L[2] + 0.06]),
                  np.array([-0.08, spine(lm, L[1]) - 0.16, L[1]])], 10)
    lo = np.array([-halfwidth(lm, L[1]) + 0.06, spine(lm, L[1]) - 0.5, T[17]])
    hi = np.array([0.06, spine(lm, L[1]) - 0.18, L[5]])
    jej = coil_path(lo, hi, 0.05, rng)
    ileum = spline([jej[-1], cecum_base + [-0.12, -0.04, 0.0], cecum_base + [-0.08, -0.02, -0.02]], 8)
    box = box_for(np.minimum(lo, np.minimum(duo.min(0), ileum.min(0))) - 0.05, np.maximum(hi, np.maximum(duo.max(0), ileum.max(0))) + 0.05)
    m = (box.tube(duo, 0.028) | box.tube(jej, 0.025) | box.tube(ileum, 0.022)) & ~solid_in(box, taken, 1)
    return box.surface(keep_main(m, 0.02), 1.0, 6)


def pancreas(lm):
    T = lm["T"]
    path = spline([np.array([0.12, spine(lm, T[17]) - 0.15, T[16]]), np.array([0.04, spine(lm, T[17]) - 0.12, T[17]]),
                   np.array([-0.06, spine(lm, T[18]) - 0.1, T[18]])], 8)
    return ribbon(path, 0.04, 0.012, [0, 1.0, 0], 16)


def sweep_flat(box, path, r, k):
    """A tube along `path` of radius r, squashed to k r dorsoventrally."""
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    m = np.zeros(box.shape, bool)
    for q in path:
        m |= ((X - q[0]) / r) ** 2 + ((Y - q[1]) / (k * r)) ** 2 + ((Z - q[2]) / r) ** 2 <= 1
    return m


def pelvic(lm):
    p = lm["pecten"]
    L = lm["L"]
    roof = lm["pts"]("sacrum")
    canal_top = roof[np.abs(roof[:, 0]) < 0.04][:, 1].min()
    bladder = ellipsoid(p + [0, 0.06, -0.05], [0.06, 0.05, 0.09], np.eye(3), 24)
    # Body: from the cervix in the pelvic canal cranially over the bladder,
    # resting on it, a little flattened dorsoventrally.
    on = p[1] + 0.11 + 0.032
    cervix = np.array([0.0, min(canal_top - 0.06, on + 0.01), p[2] + 0.1])
    bif = np.array([0.0, on + 0.005, p[2] - 0.1])
    body = spline([cervix, (cervix + bif) / 2 + [0, -0.005, 0], bif], 8)
    horns, ovaries = [], []
    for s in (-1, 1):
        # Horns curve craniolaterally and dorsally under the lumbar region,
        # the ventral border convex, to the ovaries.
        ov = np.array([s * 0.11, spine(lm, L[4]) - 0.11, L[4]])
        mid = (bif + ov) / 2
        h = spline([bif + [0, 0, 0.02], bif + [s * 0.035, -0.008, -0.03], mid + [s * 0.04, -0.035, 0.0], ov + [-s * 0.02, -0.035, 0.035], ov + [-s * 0.012, -0.02, 0.012]], 10)
        horns.append(h)
        box = box_for(ov - 0.06, ov + 0.06, 0.002)
        m = box.ellipsoid(ov, [0.03, 0.025, 0.04]) & ~box.ellipsoid(ov + [0, -0.028, 0], [0.012, 0.01, 0.014])  # ovulation fossa
        ovaries.append(box.surface(m, 1.0, 6))
    pts = np.concatenate([body] + horns)
    box = box_for(pts.min(0) - 0.06, pts.max(0) + 0.06, 0.003)
    m = sweep_flat(box, body, 0.04, 0.7)
    for h in horns:
        m |= box.tube(h, np.linspace(0.03, 0.017, len(h)))
    uterus = box.surface(m & ~box.ellipsoid(p + [0, 0.06, -0.05], [0.06, 0.05, 0.09]), 1.3, 8)
    return bladder, uterus, ovaries


def lungs(lm, cage_pts, taken, heart, mediastinal, bones):
    """The rib cage sections from a rounded cupula at the first rib to the
    diaphragm, smoothed along the body so they do not step from one rib space
    to the next, less the abdominal organs, the heart, the mediastinum,
    airways, esophagus and great vessels; edges rounded. Kept clear of the
    bones here (carving afterwards would groove them along every rib)."""
    T = lm["T"]
    ribs = np.concatenate(list(lm["ribs"].values()))
    z0 = ribs[:, 2].min() + 0.01
    lo = np.array([-lm["cage"], lm["xiphoid"][1] - 0.02, z0 - 0.03])
    hi = np.array([lm["cage"], ribs[:, 1].max(), T[18]])
    box = box_for(lo, hi)
    X, Y, Z = (c.reshape(box.shape) for c in box.pts.T)
    from scipy.spatial import ConvexHull

    # Cupula: over the first rib spaces the section shrinks towards its
    # centre, so the cranial lobes end in a rounded apex at the first rib.
    length = T[18] - z0
    inside = np.zeros(box.shape, bool)
    zs = box.g.lo[2] + box.g.h * np.arange(box.shape[2])
    for k, z in enumerate(zs):
        q = cage_pts[np.abs(cage_pts[:, 2] - z) < 0.04][:, :2]
        q = np.concatenate([q, q * [-1, 1]])
        if len(q) < 10 or z < z0:
            continue
        shrink = 0.45 + 0.55 * np.sqrt(np.clip((z - z0) / (0.1 * length), 0, 1))
        c = np.array([0.0, (spine(lm, z) + floor(lm, z)) / 2 + 0.04])
        eq = ConvexHull(q).equations + [0, 0, 0.03]
        xs = c[0] + (X[:, :, k] - c[0]) / shrink
        ys = c[1] + (Y[:, :, k] - c[1]) / shrink
        inside[:, :, k] = np.all(eq[:, 0][:, None, None] * xs + eq[:, 1][:, None, None] * ys + eq[:, 2][:, None, None] <= 0, axis=0)
    s = inside & (Y < spine(lm, Z) - 0.015) & (Y > floor(lm, Z) + 0.01)
    # The sections step from one rib space to the next: smooth along z.
    s = ndi.gaussian_filter(s.astype(np.float32), (1, 1, 7)) > 0.5
    s &= Z < diaphragm(lm, Y, X) - 0.015
    s &= ~((np.abs(X) < 0.06) & (Y > spine(lm, Z) - 0.045))  # vertebral bodies, longus colli
    s &= np.abs(X + 0.01) > 0.01  # mediastinum
    organs = solid_in(box, taken, 2)
    hrt = solid_in(box, [heart], 2)
    med = solid_in(box, mediastinal, 2) | solid_in(box, bones, 1)
    s &= ~organs & ~hrt & ~med
    # Rounded edges and borders, then clear of the heart and organs again.
    s = ndi.gaussian_filter(s.astype(np.float32), 1.5) > 0.5
    s &= ~organs & ~hrt & ~med
    return {
        "lungs.L": box.surface(largest(s & (X < -0.01)), 1.6, 10),
        "lungs.R": box.surface(largest(s & (X > -0.01)), 1.6, 10),
    }


def brain(lm):
    """Modeled in a head frame (the head is carried nose down): f along the
    skull's long axis towards the nose, v ventral in the median plane. The
    brainstem ends at the foramen magnum (the caudal end of the skull, in its
    ventral half), the cerebellum rostrodorsal to it under the occipital
    bone, the cerebrum rostral to the cerebellum, caudal to the orbits."""
    p = lm["skull"][0]
    c = p.mean(0)
    axis = np.linalg.svd(p[::7] - c, full_matrices=False)[2][0]
    f = axis if axis[2] < 0 else -axis
    f = np.array([0.0, f[1], f[2]]) / np.linalg.norm(f[1:])
    v = np.array([0.0, f[2], -f[1]])
    if v[1] > 0:
        v = -v
    lat = np.cross(f, -v)
    along, down = (p - c) @ f, (p - c) @ v
    near = p[(np.abs(p[:, 0]) < 0.04) & (down > np.percentile(down, 40))]
    back = near[np.argsort((near - c) @ f)[: max(1, len(near) // 50)]].mean(0)
    magnum = back + f * 0.015 - v * 0.005
    cb = magnum + f * 0.05 - v * 0.035
    cr = magnum + f * 0.125 - v * 0.04
    axes = np.array([lat, -v, f])
    box = box_for(np.minimum(cr, magnum) - 0.12, np.maximum(cr, magnum) + 0.12, 0.002)
    q = (box.pts - cr) @ axes.T
    cerebrum = box.ellipsoid(cr, [0.05, 0.038, 0.065], axes) & ~((np.abs(q[:, 0]) < 0.0025) & (q[:, 1] > 0)).reshape(box.shape)
    cerebellum = box.ellipsoid(cb, [0.035, 0.03, 0.025], axes) & ~cerebrum
    stem = box.tube(spline([cr - v * 0.03 - f * 0.04, cb + v * 0.035 + f * 0.005, magnum], 8), 0.016) & ~cerebrum & ~cerebellum
    print(f"  brain: skull length {np.ptp(along):.3f}, magnum {np.round(magnum, 3)}")
    return {n: box.surface(largest(m), 1.0, 6) for n, m in (("brain.cerebrum", cerebrum), ("brain.cerebellum", cerebellum), ("brain.brainstem", stem))}


# --- main ---------------------------------------------------------------------------------


def main(work):
    sk = read(os.path.join(work, "skeleton"))
    lm = landmarks(sk)
    T, L = lm["T"], lm["L"]
    print(f"cage half-width {lm['cage']:.3f}, xiphoid {np.round(lm['xiphoid'], 3)}, pecten {np.round(lm['pecten'], 3)}, T1 {T[1]:.3f}, T18 {T[18]:.3f}, L6 {L[6]:.3f}")
    out = {}
    heart, base = place_heart(lm, read(os.path.join(work, "heart"))["heart"])
    out["horse.visceral.heart"] = heart
    stomach = place_stomach(lm, read(os.path.join(work, "stomach"))["stomach"])
    out["horse.visceral.stomach"] = stomach
    colon = place_colon(lm, read(os.path.join(work, "colon"))["colon"])
    out["horse.visceral.large-colon"] = colon

    print("  airways")
    trachea_m, trachea, larynx, inlet, carina, neck = airways(lm)
    out["horse.visceral.trachea"] = trachea_m
    out["horse.visceral.thyroid"] = thyroid(trachea, larynx)
    sp = stomach[0]
    # Cardia: the end of the esophageal stump (the most cranial dorsal stump vertex).
    top = sp[sp[:, 1] > sp[:, 1].max() - 0.12]
    cardia = top[np.argmin(top[:, 2])]
    out["horse.visceral.esophagus"], _ = esophagus(lm, larynx, neck, inlet, carina, cardia)
    # Pylorus: the end of the duodenal stump (the rightmost vertex).
    pylorus = sp[np.argmax(sp[:, 0])]

    print("  liver")
    out["horse.visceral.liver"] = liver(lm, [stomach, colon])
    liver_top = out["horse.visceral.liver"][0][:, 1].max()
    out["horse.visceral.great-vessels"], _, _ = vessels(lm, base, liver_top)
    out["horse.visceral.spleen"] = spleen(lm)
    out["horse.visceral.pancreas"] = pancreas(lm)
    for k, m in kidneys(lm).items():
        out[f"horse.visceral.{k}"] = m

    print("  intestines")
    taken = [stomach, colon] + [out[f"horse.visceral.{k}"] for k in ("liver", "kidneys.R", "kidneys.L", "pancreas", "spleen")]
    out["horse.visceral.cecum"], cecum_base = cecum(lm, taken)
    taken.append(out["horse.visceral.cecum"])
    out["horse.visceral.small-colon"] = small_colon(lm, taken, [m for k, m in sk.items() if "skull" not in k and "mandible" not in k])
    taken.append(out["horse.visceral.small-colon"])
    out["horse.visceral.small-intestine"] = small_intestine(lm, taken, pylorus, cecum_base)
    out["horse.visceral.urinary-bladder"], out["horse.visceral.uterus"], ovaries = pelvic(lm)
    out["horse.visceral.ovaries.L"], out["horse.visceral.ovaries.R"] = ovaries

    print("  lungs")
    cage_pts = np.concatenate([np.concatenate(list(lm["ribs"].values())), lm["sternum"]])
    mediastinal = [out["horse.visceral.trachea"], out["horse.visceral.esophagus"], out["horse.visceral.great-vessels"]]
    bones = [m for k, m in sk.items() if not any(b in k for b in ("skull", "mandible"))]
    for k, m in lungs(lm, cage_pts, [stomach, out["horse.visceral.liver"], out["horse.visceral.spleen"]], heart, mediastinal, bones).items():
        out[f"horse.visceral.{k}"] = m

    print("  brain")
    for k, m in brain(lm).items():
        out[f"horse.visceral.{k}"] = m

    for k in list(out):
        if "brain" in k or "lungs" in k or "small-colon" in k:
            continue
        out[k] = outward(carve(out[k], bones, 0.005))
    for k, m in out.items():
        print(f"{k}: {len(m[1])} triangles, centre {np.round(m[0].mean(0), 3)}, size {np.round(np.ptp(m[0], 0), 3)}")
    write(os.path.join(work, "organs"), out)


if __name__ == "__main__":
    main(sys.argv[1])
