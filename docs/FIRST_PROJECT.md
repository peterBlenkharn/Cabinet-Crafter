# Build Your First Cabinet

Use the included **Workshop Upright** sample to learn Cabinet Crafter's complete workflow without starting from a blank design. Allow about ten minutes.

The committed sample opens as a completed reference: the Review preflight shows 0 errors, 0 warnings and 1 information finding; the Area plan uses three sheets at 81.9% utilisation; and the illustrative total cost is GBP 553.35. A design or stock change intentionally makes downstream confirmations stale until you recheck them.

![Cabinet Crafter showing the Workshop Upright sample in the design workspace](media/readme/hero-light.png)

## 1. Open a working copy

1. Start Cabinet Crafter.
2. Open the [Workshop Upright sample project](../examples/workshop-upright.cabinet.json) on GitHub and choose **Download raw** to save it to your computer.
3. Choose **More > Open** and select `workshop-upright.cabinet.json`.
4. Choose **More > Save as** and save a working copy somewhere suitable.

The sample is a Standard upright cabinet measuring 650 × 1,700 × 600 mm. It includes internal supports, a service door, a screen frame, controls and a costed MDF stock profile.

## 2. Inspect the design

![Workshop Upright with a structural panel selected in the design workspace](media/readme/design-structure.png)

- Use **3D**, **Front**, **Side** and **Top** to inspect the cabinet.
- Select a panel in the viewport or the cabinet-panel list. The Inspector shows its dimensions, material, operations and fabrication state.
- Try one reversible change: set the cabinet width from 650 mm to 660 mm, watch the model update, then choose **Undo**.
- Use **Frame selected**, **Isolate** and the **Explode** control to understand how parts relate.

**Show in viewport** affects only the 3D view. **Include in fabrication** controls whether the part enters manufacturing output.

When the design looks right, choose **Confirm design**.

## 3. Review hardware

![Hardware workspace showing the control layout, fitted components and purchasing fields](media/readme/hardware-bom.png)

The Hardware stage shows the control layout inferred from the design, fitted button and joystick bodies, keep-outs and the current component schedule.

The sample also contains advisory hardware findings. Review them before confirming the stage; they do not block fabrication preflight.

1. Check that the requested controls fit the deck and apron.
2. Inspect any fit or service-clearance finding.
3. Add unit costs, supplier references or BOM-only components if useful.
4. Choose **Confirm hardware & continue**.

A BOM-only component is a purchasing record. It does not place hardware, create a cut-out or prove physical fit.

## 4. Resolve fabrication findings

![Review workspace showing grouped fabrication findings and corrective actions](media/readme/review-ready.png)

Review separates findings into errors, warnings and information.

- An **error** blocks production output and cannot be overridden.
- A **warning** must be understood and acknowledged before production output.
- An **information** finding does not block export.

Open an actionable finding to return to the affected part or control. Recheck the design after every correction. When no errors remain and you understand any warnings, choose **Confirm review & continue**.

## 5. Generate the sheet plan

![Sheets workspace showing a validated true-shape layout and stock summary](media/readme/sheets-overview.png)

1. Check each stock profile's measured thickness, uncut sheet size, price, trim margin, spacing, grain and allowed rotations.
2. Confirm that every included part has the intended material assignment.
3. Choose **Regenerate layouts**.
4. Compare the ranked candidates, sheet count, utilisation, waste and material cost.
5. Inspect every sheet and resolve any overlap, bounds, spacing, quantity, rotation or grain finding.
6. Choose **Confirm sheet plan & continue** when the selected plan is valid.

If the design, stock or assignments change later, regenerate the layouts before export.

## 6. Export a review copy

![Export workspace showing draft, production and fabrication-pack readiness](media/readme/export-ready.png)

Start with **Export draft SVG**. The draft includes labels, dimensions, reference geometry and preflight context for human review. It is not a machine file.

Production options become available only after their checks pass:

- **Production SVG** contains clean nominal operations for downstream CAM.
- **Fabrication pack** adds material-grouped SVG/DXF sheets, calibration geometry, bills of materials, schedules, labels, drilling templates, reports and assembly guidance.

Save the project after reviewing the exported files.

## Before using workshop output

> [!CAUTION]
> Cabinet Crafter does not generate G-code or control machinery. Verify dimensions, material thickness, supplier drawings, CAM settings, tool compensation and machine behaviour. Import the 100 × 100 mm calibration contour at full scale and make a representative test cut before committing stock.

Continue with [Before You Cut](BEFORE_YOU_CUT.md) and [Exports and Project Files](EXPORTS.md) before fabricating. For a detailed description of every workspace, see [UI Workflows](UI_WORKFLOWS.md).
