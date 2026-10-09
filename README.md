# Osmose Pole Review

A browser dashboard for reviewing Osmose grid resiliency pole inspection workbooks (CenterPoint).
Open `index.html` (or the GitHub Pages site) and drop one or more Osmose `.xlsx` workbooks onto the page, one per circuit. Nothing is uploaded; the workbooks are read in the browser and kept in this browser so they can be reopened.

**Circuits**: each workbook becomes a circuit (named from its CIRCUIT column). Switch circuits from the drop-down next to the title or the Uploaded circuits table on the Overview; add more with **Add circuit sheets**. Uploading a circuit again replaces it.

**What it reads**
- The pole data sheet (found by its `POLE_NO` header), including the TechServ designer and CNP recommendation columns.
- Any other sheet with a `Pole ID` column (Resiliency Replaces, Resiliency Braces, AddlOVH), tied back to each pole.

**Linked SharePoint folder (Chrome or Edge)**: sync the SharePoint library to your computer with OneDrive, then click **Link a synced SharePoint folder** and pick it. Link the top folder (e.g. "Osmose Data" with one subfolder per circuit). Every Osmose workbook in it, up to three levels of subfolders deep, is loaded as a circuit; other Excel files are skipped, folders named Archive, Old, Superseded or Backup are ignored, and if two files hold the same circuit the newest wins. The app checks the folder on a timer (every minute by default; 30 seconds to 15 minutes, or off) and when a workbook changes it reloads just that circuit in place, keeping your tab, selected pole and map view, and tells you how many poles changed (changed poles are marked *Updated* in the pole list). New workbooks are added and deleted ones removed. A file that can't be read (open in Excel, still syncing) keeps its last good data and is retried. Click the folder chip in the top bar to change the interval, check now, see the files, or unlink. When you reopen the app the folder reconnects automatically, or with one click if the browser asks for permission again.

**Filling in the designer and CNP columns**: blank survey columns (major equipment, scenario, composition, height/class, woodpecker, crossing, tree trimming, truck access, valid feeder, circuit section, permit, notes, designer recommendation) and the CNP review columns can be edited from each pole's page (**Fill in** section) or in the **Fill in** tab, a grid where you click a cell to edit (Enter moves down, Tab moves right) and can set a field on many selected poles at once or fill blanks from the Osmose data (height/class, circuit section, pole composition). Drop-down choices come from the workbook's Lookups sheet. The CNP Initial Recommendation columns follow the workbook's Sheet Rules as you fill in. Edits are kept in this browser until you save: **Save to workbook** writes them into the linked folder's workbook (OneDrive uploads it to SharePoint); for an uploaded sheet, **Download updated workbook** gives you a copy to upload. Only the edited cells are changed, so formatting, drop-downs, tables and formulas stay intact. If someone changed a cell in the file after you edited it, the app shows both values and skips that cell unless you choose to overwrite.

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
