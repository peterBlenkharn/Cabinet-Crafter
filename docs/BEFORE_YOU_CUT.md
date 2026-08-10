# Before You Cut

Cabinet Crafter generates design and fabrication geometry. It does not generate machine-specific G-code, choose tools, control a CNC machine, or verify a physical workshop setup.

Complete this checklist for every material, machine, CAM setup, or important design revision.

## Design And Project

- Save the project with a clear name and keep a backup.
- Confirm the units, overall dimensions, material assignments, and measured sheet thickness.
- Confirm every required panel is included in fabrication and every intentionally omitted panel is understood.
- Inspect internal supports, cable slots, service access, hardware bodies, fastener paths, and assembly clearances in 3D.
- Complete Hardware and Review. Resolve every error and understand every acknowledged warning.

## Drawings And Sheet Plan

- Confirm the selected material, grain direction, finished face, allowed rotations, sheet size, trim margin, and part spacing.
- Check every placed part, including small rails, supports, doors, and duplicated parts.
- Confirm that no part crosses a stock boundary and that reusable offcuts are physically useful.
- Print or measure the included 100 x 100 mm calibration contour at 100 percent scale.
- Compare critical dimensions in the exported files with the project and with a supplier drawing.

## CAM

- Import in millimetres and verify the imported size before creating toolpaths.
- Distinguish through-cuts, pockets, drills, and reference-only geometry.
- Keep reference annotations out of production toolpaths.
- Select tools, cut direction, depth per pass, tabs, leads, feeds, speeds, compensation, and safe heights for the actual machine and material.
- Check internal-corner requirements and add CAM-specific dogbones or relief only where the intended joint needs them.
- Simulate every toolpath and inspect the machining order.

## Machine And Workshop

- Use appropriate guarding, extraction, workholding, personal protective equipment, and emergency-stop access.
- Confirm the stock is flat, secured, and clear of clamps along every toolpath.
- Set and independently verify the machine origin, work coordinate system, tool length, and material thickness.
- Perform an air cut or safe-height preview when practical.
- Make a representative test cut for fit-critical joints, holes, pockets, and hardware before cutting final sheets.
- Never leave a running machine unattended.

## Assembly

- Dry-fit before final fastening or adhesive.
- Check screw length and pilot size against the real material.
- Deburr edges and protect wiring from sharp cutouts.
- Confirm ventilation, electrical earthing, mains isolation, strain relief, fuse selection, and component clearances using qualified guidance.
- Stop if the physical result differs from the drawing, the calibration contour, or the expected fit. Find the cause before continuing.

The user remains responsible for CAM choices, machine operation, materials, electrical work, structural suitability, and safe assembly.
