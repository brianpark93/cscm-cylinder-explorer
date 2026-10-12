"""Export the OAT study (runs/110_oat_cons) for the interactive web viewer in web/.

    python scripts/export_web.py [--force]

Writes
  web/data/geom.bin      faces of the concrete and of the two platens (quarter model, mm), shared by all cases
  web/data/cases.json    parameters, levels, curves (force vs time and stroke), metrics, test curves
  web/data/dmg/<case>.bin  uint8 [n_state x n_concrete_elem]: damage 0..254 (x/254), 255 = eroded

The geometry is undeformed (strokes of 1-3 mm on a 200 mm specimen are invisible at screen scale); erosion is shown by
hiding the faces of deleted elements and revealing the faces of their surviving neighbours.
"""
import json, os, re, sys
import numpy as np
import pandas as pd
from lasso.dyna import D3plot

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import cscm, post
from run_queue import status
sys.path.insert(0, os.path.join(ROOT, "studies"))
from s100_oat import GRID          # three steps each side of the default; other levels are not shown

RUNS = os.path.join(ROOT, "runs", "110_oat_cons")
WEB = os.path.join(ROOT, "web", "data")
BASE = cscm.read(os.path.join(ROOT, "model", "mat", "cscm_default_fc31_explicit.k"))
HEX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]

# parameter key -> (group, html label, unit, short description); order = display order
PARAMS = {
    "E_g": ("elasticity", "G", "GPa", "shear modulus"),
    "E_k": ("elasticity", "K", "GPa", "bulk modulus"),
    "E_gk": ("elasticity", "G and K", "", "G and K scaled together (Poisson ratio kept)"),
    "S_alpha": ("shear surface (TXC)", "&alpha;", "MPa", "constant term of the TXC meridian (strength level)"),
    "S_theta": ("shear surface (TXC)", "&theta;", "", "linear term of the TXC meridian (pressure sensitivity)"),
    "S_lamda": ("shear surface (TXC)", "&lambda;", "MPa", "nonlinear term of the TXC meridian"),
    "S_beta": ("shear surface (TXC)", "&beta;", "1/MPa", "exponent of the TXC meridian"),
    "T_alpha1": ("torsion scaling (TOR)", "&alpha;<sub>1</sub>", "", "TOR/TXC ratio, constant term"),
    "T_theta1": ("torsion scaling (TOR)", "&theta;<sub>1</sub>", "", "TOR/TXC ratio, linear term"),
    "T_lamda1": ("torsion scaling (TOR)", "&lambda;<sub>1</sub>", "", "TOR/TXC ratio, nonlinear term"),
    "T_beta1": ("torsion scaling (TOR)", "&beta;<sub>1</sub>", "", "TOR/TXC ratio, exponent"),
    "X_alpha2": ("extension scaling (TXE)", "&alpha;<sub>2</sub>", "", "TXE/TXC ratio, constant term"),
    "X_theta2": ("extension scaling (TXE)", "&theta;<sub>2</sub>", "", "TXE/TXC ratio, linear term"),
    "X_lamda2": ("extension scaling (TXE)", "&lambda;<sub>2</sub>", "", "TXE/TXC ratio, nonlinear term"),
    "X_beta2": ("extension scaling (TXE)", "&beta;<sub>2</sub>", "", "TXE/TXC ratio, exponent"),
    "H_nh/ch": ("shear hardening", "N<sub>H</sub>, C<sub>H</sub>", "", "initial yield fraction and hardening rate"),
    "C_xd": ("cap", "X<sub>0</sub>", "MPa", "initial cap position (pressure axis intercept)"),
    "C_r": ("cap", "R", "", "cap aspect ratio"),
    "C_w": ("cap", "W", "", "maximum plastic volume compaction"),
    "C_d1": ("cap", "D<sub>1</sub>", "", "linear cap hardening"),
    "C_d2": ("cap", "D<sub>2</sub>", "", "quadratic cap hardening"),
    "D_gfc": ("damage", "G<sub>fc</sub>", "J/m&sup2;", "compressive fracture energy (softening)"),
    "D_b": ("damage", "B", "", "ductile (compressive) damage shape"),
    "D_d": ("damage", "D", "", "brittle (tensile) damage shape"),
    "D_gft": ("damage", "G<sub>ft</sub>", "J/m&sup2;", "tensile fracture energy"),
    "D_gfs": ("damage", "G<sub>fs</sub>", "J/m&sup2;", "shear fracture energy"),
    "D_gftgfs": ("damage", "G<sub>ft</sub> and G<sub>fs</sub>", "J/m&sup2;", "tensile and shear fracture energy together"),
    "D_pwrc": ("damage", "pwrc", "", "shear-to-compression transition"),
    "D_pwrt": ("damage", "pwrt", "", "shear-to-tension transition"),
    "D_pmod": ("damage", "pmod", "", "modify moderate-pressure softening"),
    "D_repow": ("damage", "repow", "", "power on fracture energy for rate effects"),
    "R_erode": ("erosion", "ERODE", "", "erosion (damage > 0.99 and max principal strain > ERODE-1)"),
    "I_fpc": ("generator input", "f<sub>c</sub>&prime;", "MPa", "MAT_CSCM_CONCRETE input: regenerates all constants"),
    "I_dagg": ("generator input", "d<sub>agg</sub>", "mm", "MAT_CSCM_CONCRETE input: aggregate size (fracture energies)"),
    "B_free_mu": ("platen boundary", "friction, free ends", "", "end faces free to slide, Coulomb friction &mu;"),
}
DISPLAY_SCALE = {"g": 1e-9, "k": 1e-9, "alpha": 1e-6, "lamda": 1e-6, "xd": 1e-6, "beta": 1e6}


def level_of(case, param):
    """(numeric value for ordering/slider, text label) of one OAT case within its parameter family."""
    name = param.split("_", 1)[1]
    rest = case.split("_", 1)[1]
    m = re.search(r"_x([0-9.]+)$", case)
    if m:
        f = float(m.group(1))
        key = name if name in BASE else None
        if key:
            v = BASE[key] * f * DISPLAY_SCALE.get(key, 1)
            return f, f"&times;{f:g} ({v:.4g})"
        return f, f"&times;{f:g}"
    if param == "H_nh/ch":
        nh, ch = re.match(r"nh([0-9.]+)_ch([-0-9.e]+)", rest).groups()
        return float(nh) * 10 + np.log10(float(ch)) / 100, f"N<sub>H</sub> = {nh}, C<sub>H</sub> = {float(ch):g}"
    m = re.search(r"(fpc|dagg|mu)([0-9.]+)$", rest)
    if m:
        v = float(m.group(2))
        return v, {"fpc": f"{v:g} MPa", "dagg": f"{v:g} mm", "mu": f"&mu; = {v:g}"}[m.group(1)]
    v = float(rest.rsplit("_", 1)[1])
    return v, f"{v:g}"


def base_level(param):
    name = param.split("_", 1)[1]
    if param == "H_nh/ch":
        return 100.0, "N<sub>H</sub> = 1 (none)"
    if param == "I_fpc":
        return 31.2, "31.2 MPa (default)"
    if param == "I_dagg":
        return 19.0, "19 mm (default)"
    if param == "B_free_mu":
        return -1.0, "restrained ends, &mu; = 0.3 (default)"
    if name in ("b", "pwrc", "pwrt", "pmod", "repow", "erode"):
        return BASE[name], f"{BASE[name]:g} (default)"
    key = name if name in BASE else None
    v = f" ({BASE[key] * DISPLAY_SCALE.get(key, 1):.4g})" if key else ""
    return 1.0, f"&times;1{v} (default)"


def param_of(case):
    g, rest = case.split("_", 1)
    if g == "H":
        return "H_nh/ch"
    rest = re.sub(r"_x[0-9.]+$", "", rest)
    rest = re.sub(r"_[-0-9.e]+$", "", rest)
    rest = re.sub(r"(fpc|dagg|mu)[0-9.]+$", r"\1", rest)
    return f"{g}_{rest}"


def concrete_part_index(d):
    titles = [t.decode().strip().lower() for t in d.arrays["part_titles"]]
    return [i for i, t in enumerate(titles) if "concrete" in t][0], titles


def export_geometry(d3, out):
    d = D3plot(d3, state_array_filter=["element_solid_is_alive"])
    xyz = d.arrays["node_coordinates"] * 1e3                    # m -> mm
    conn = d.arrays["element_solid_node_indexes"]
    part = d.arrays["element_solid_part_indexes"]
    ic, titles = concrete_part_index(d)
    conc = np.nonzero(part == ic)[0]
    # concrete: every face of every element with its (up to two) owners -> visible iff exactly one owner is alive
    faces = {}
    for local, e in enumerate(conc):
        for f in HEX_FACES:
            q = tuple(conn[e, list(f)])
            key = tuple(sorted(q))
            if key in faces:
                faces[key][2] = local
            else:
                faces[key] = [q, local, -1]
    cq = np.array([v[0] for v in faces.values()], dtype=np.int32)
    own = np.array([[v[1], v[2]] for v in faces.values()], dtype=np.int32)
    # platens: outer faces only (static)
    pfaces = []
    for e in np.nonzero(part != ic)[0]:
        for f in HEX_FACES:
            pfaces.append(tuple(conn[e, list(f)]))
    cnt = {}
    for q in pfaces:
        cnt[tuple(sorted(q))] = cnt.get(tuple(sorted(q)), 0) + 1
    pq = np.array([q for q in pfaces if cnt[tuple(sorted(q))] == 1], dtype=np.int32)
    used = np.unique(np.concatenate([cq.ravel(), pq.ravel()]))
    remap = -np.ones(len(xyz), dtype=np.int32); remap[used] = np.arange(len(used))
    header = np.array([len(used), len(cq), len(pq), len(conc)], dtype=np.int32)
    with open(out, "wb") as fh:
        fh.write(header.tobytes())
        fh.write(xyz[used].astype(np.float32).tobytes())
        fh.write(remap[cq].astype(np.int32).tobytes())
        fh.write(own.astype(np.int32).tobytes())
        fh.write(remap[pq].astype(np.int32).tobytes())
    return dict(n_nodes=int(len(used)), n_faces=int(len(cq)), n_plate_faces=int(len(pq)), n_elem=int(len(conc)),
                parts=titles), conc


def export_damage(d3, conc_ref, out):
    d = D3plot(d3, state_array_filter=["element_solid_effective_plastic_strain", "element_solid_is_alive", "timesteps"])
    ic, _ = concrete_part_index(d)
    conc = np.nonzero(d.arrays["element_solid_part_indexes"] == ic)[0]
    if len(conc) != len(conc_ref) or np.any(conc != conc_ref):
        raise RuntimeError(f"mesh differs from the reference: {d3}")
    dmg = d.arrays["element_solid_effective_plastic_strain"][:, conc, 0]
    alive = d.arrays["element_solid_is_alive"][:, conc] > 0.5
    q = np.round(np.clip(dmg, 0, 1) * 254).astype(np.uint8)
    q[~alive] = 255
    q.tofile(out)
    return d.arrays["timesteps"].tolist()


def main(force=False):
    os.makedirs(os.path.join(WEB, "dmg"), exist_ok=True)
    geom, conc = export_geometry(os.path.join(RUNS, "base", "d3plot"), os.path.join(WEB, "geom.bin"))
    exp = post.load_exp(0.0)
    cases, params = {}, {}
    names = sorted(n for n in os.listdir(RUNS) if os.path.isdir(os.path.join(RUNS, n)))
    for n in names:
        c = os.path.join(RUNS, n)
        if n.startswith("_") or status(c) != "done" or not os.path.exists(os.path.join(c, "d3plot")):
            continue
        p = "base" if n == "base" else param_of(n)
        if p != "base" and p not in PARAMS:
            print("skip (unknown parameter)", n); continue
        if p in GRID and n not in GRID[p]:
            continue                                   # off-grid level (earlier designs)
        r = os.path.join(c, "response.csv")
        if not os.path.exists(r) or os.path.getmtime(r) < os.path.getmtime(os.path.join(c, "messag")):
            post.case_response(c)
        df = pd.read_csv(r)
        grid = np.round(np.arange(0, df.disp_mm.max() + 1e-9, 0.01), 2)
        f = np.interp(grid, df.disp_mm, df.force_kN)
        t = np.interp(grid, df.disp_mm, df.time)
        m = post.metrics(df.disp_mm, df.force_kN)
        b = os.path.join(WEB, "dmg", f"{n}.bin")
        if force or not os.path.exists(b) or os.path.getmtime(b) < os.path.getmtime(os.path.join(c, "messag")):
            times = export_damage(os.path.join(c, "d3plot"), conc, b)
        else:
            times = (np.arange(os.path.getsize(b) // geom["n_elem"]) * 0.01).tolist()
        cases[n] = dict(param=p, d=grid.tolist(), t=np.round(t, 5).tolist(), f=np.round(f, 2).tolist(),
                        states=np.round(times, 4).tolist(),
                        peak=round(float(m["peak_kN"]), 1), d_peak=round(float(m["disp_at_peak_mm"]), 3),
                        ductility=None if pd.isna(m.get("ductility_mm")) else round(float(m["ductility_mm"]), 3),
                        rmse_aligned=round(post.aligned_rmse(df.disp_mm, df.force_kN, exp), 1))
        if p != "base":
            v, lab = level_of(n, p)
            params.setdefault(p, []).append(dict(case=n, v=v, label=lab))
        print("ok", n, flush=True)
    out_params = []
    for p, (grp, lab, unit, desc) in PARAMS.items():
        if p not in params:
            continue
        bv, blab = base_level(p)
        lv = sorted(params[p] + [dict(case="base", v=bv, label=blab)], key=lambda x: x["v"])
        out_params.append(dict(key=p, group=grp, label=lab, unit=unit, desc=desc, levels=lv))
    tests = {k: dict(d=np.round(v.disp_mm.values[::5], 3).tolist(), f=np.round(v.force_kN.values[::5], 2).tolist())
             for k, v in exp.items()}
    meta = dict(geom=geom, params=out_params, cases=cases, tests=tests, rate_mm_per_s=10.0,
                note="OAT around the MAT_CSCM_CONCRETE defaults (fc' 31.2 MPa, dagg 19 mm), quarter model, h = 5 mm")
    json.dump(meta, open(os.path.join(WEB, "cases.json"), "w"), separators=(",", ":"))
    for f in os.listdir(os.path.join(WEB, "dmg")):              # drop damage files of levels no longer shown
        if f[:-4] not in cases:
            os.remove(os.path.join(WEB, "dmg", f))
    print(f"{len(cases)} cases, {len(out_params)} parameters ->", WEB)


if __name__ == "__main__":
    main("--force" in sys.argv)
