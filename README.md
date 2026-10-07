# Osmose Pole Review

A browser dashboard for reviewing Osmose grid resiliency pole inspection workbooks (CenterPoint).
Open `index.html` (or the GitHub Pages site) and drop one or more Osmose `.xlsx` workbooks onto the page, one per circuit. Nothing is uploaded; the workbooks are read in the browser and kept in this browser so they can be reopened.

**Circuits**: each workbook becomes a circuit (named from its CIRCUIT column). Switch circuits from the drop-down next to the title or the Uploaded circuits table on the Overview; add more with **Add circuit sheets**. Uploading a circuit again replaces it.

**What it reads**
- The pole data sheet (found by its `POLE_NO` header), including the TechServ designer and CNP recommendation columns.
- Any other sheet with a `Pole ID` column (Resiliency Replaces, Resiliency Braces, AddlOVH), tied back to each pole.

**Tabs**
- **Overview**: CNP final recommendation, inspection status, recommendation by circuit section, conditions found, % load, age, height/class, treatment. Click any bar to list those poles.
- **Map**: every pole with GPS, colored by CNP final, Osmose rec, designer rec, status, % load, findings or review state. Shows the selected circuit by default, or all uploaded circuits (with circuit labels). Full screen mode, find a pole by number, and fit-to-poles.
- **Poles**: filterable list with a full detail view per pole (recommendation path, findings, structure, inspection, location, equipment, guying, conditions, work-list entries, photo file names, every filled-in column). Mark poles reviewed and add notes (saved in this browser).
- **Over 99% load**: poles whose Osmose load is over 99% but Osmose did not recommend Replace, with a printable list or a page per pole.
- **Recommendations**: Osmose → CNP final and designer → CNP final matrices, plus every pole where the CNP final differs from Osmose.
- **Findings**: automatic checks (duplicate pole numbers: identical rows are shown once, differing rows are each shown with their sheet row and a side-by-side comparison; priority rejects not replaced, high % load / low remaining strength / poor guying / woodpecker damage kept as Pole OK, height/class and circuit section mismatches, GPS outliers, work-list differences).
- **Work lists** and **All data**: the source sheets as sortable tables.

**Download review (Excel)** opens a dialog to pick the circuit (current or all uploaded) and the sheets: circuit summary, pole review (with your review marks and notes), over 99% load, findings (optionally with notes), recommendation changes, Osmose work lists and the full Osmose data.

## Hosting
Upload `index.html`, `styles.css` and `app.js` to a GitHub repository and turn on GitHub Pages. Keep the files at the top level.
