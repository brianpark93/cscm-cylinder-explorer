# CSCM Cylinder Explorer

Interactive companion to a study of how the constants of the LS-DYNA Continuous Surface Cap Model
(`*MAT_CSCM_CONCRETE`, MAT_159) shape the response of a concrete cylinder in uniaxial compression.

Pick a constant, drag its slider, and compare with the default card and the tests:
- the load history (force against time or stroke);
- the damage field, rendered in 3D for the default card and for the selected level side by side, with a time slider
  and playback.

## What is in the data

- **Specimen and model.** 100 × 200 mm cylinder, quarter model, 8-node solids with element size 5 mm, rigid loading
  platen and elastic steel base plate in penalty contact (μ = 0.3).
- **Loading.** The platen moves at 10 mm/s, so time (s) × 10 = stroke (mm). Force is for the full specimen.
- **Material.** `*MAT_CSCM_CONCRETE` with f<sub>c</sub>′ = 31.2 MPa and d<sub>agg</sub> = 19 mm, written out as the
  explicit MAT_159 constants it generates.
- **Sensitivity design.** One at a time: each run changes a single constant (or a generator input) from that
  default card. Strain-rate constants are not varied because the card has no rate effects (IRATE = 0).
- **Tests.** T1–T3, toe-corrected; the stroke is as measured, so it includes the compliance of the testing machine.
- **Damage.** CSCM's scalar damage, 0 to 1. Eroded elements are hidden. Displacements are not drawn: at most 3 mm on a
  200 mm specimen, they would not be visible.

## Run locally

The page loads its data with `fetch`, so serve the folder instead of opening the file directly:

```
python -m http.server 8000
# open http://localhost:8000
```

A level can be linked directly by its case name, for example `#D_gfc_x0.25`. Add `?view=full` to open the mirrored
full-cylinder view.

## Files

| file | content |
| --- | --- |
| `data/cases.json` | parameters, levels, force histories, metrics, test curves |
| `data/geom.bin` | quarter-model faces (mm), shared by all cases |
| `data/dmg/<case>.bin` | damage, `uint8[n_state × n_element]`: 0–254 for damage × 254, 255 for eroded |

The data are exported from the LS-DYNA results (d3plot, rcforc, nodout) by `export_web.py`.
