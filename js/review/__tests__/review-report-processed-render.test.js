const assert = require("assert");
const fs = require("fs");
const path = require("path");

// review-panels.js cannot be require()d: it calls attachFilterMenu() at top level and reaches for DOM
// nodes, so Node throws before the first assert. The invariants below are therefore asserted against
// the source text -- which is the only proof available here, and it is proof of exactly the thing that
// broke.
const source = fs.readFileSync(path.join(__dirname, "..", "review-panels.js"), "utf8");

// ===== THE RULE UNDER TEST =====
// A processed report is rendered read-only: applyProcessedReviewReportPresentation EMPTIES the button
// box. Anything that labels the main button must therefore either run BEFORE that, or survive the
// button being gone. The first version of this feature did neither: it emptied the box in the middle of
// the builder, and two later `if`s -- Fundort "Ergänzen" and Änderung "Bearbeiten" -- then did
// `querySelector(".review-report__create").textContent = …` on a node that was no longer there.
// TypeError inside forEach, the list stopped half-built and looked complete, and on the 45s poll the
// catch swallowed it without a word.

assert.strictEqual(
	/querySelector\("\.review-report__create"\)\.textContent/.test(source),
	false,
	"every label write goes through setReviewReportCreateLabel -- a raw querySelector(...).textContent "
		+ "crashes the whole render as soon as the button is gone"
);

assert.ok(
	/function setReviewReportCreateLabel\(itemElement, label\) \{[\s\S]*?if \(createButton\) \{/.test(source),
	"and that helper null-checks the button rather than assuming it exists"
);

// Order matters as much as the guard: the transformation that removes the buttons must be the LAST
// thing the builder does.
// The trailing quote keeps this on the CALL sites -- the function definition further down reads
// `setReviewReportCreateLabel(itemElement, label)` and would otherwise be the last match.
const lastLabelCall = source.lastIndexOf('setReviewReportCreateLabel(itemElement, "');
const applyCall = source.indexOf("applyProcessedReviewReportPresentation(itemElement, report);");
const appendCall = source.indexOf("listElement.appendChild(itemElement);");
assert.ok(lastLabelCall > 0 && applyCall > 0 && appendCall > 0, "all three call sites exist");
assert.ok(
	lastLabelCall < applyCall,
	"the buttons are labelled before they are removed, not after"
);
assert.ok(
	applyCall < appendCall,
	"and they are removed just before the entry is appended"
);

// The read-only presentation must not assume the button box exists either -- the same class of crash,
// one level up.
assert.ok(
	/function applyProcessedReviewReportPresentation\(itemElement, report\) \{[\s\S]*?if \(!actionsElement\) \{[\s\S]*?return;/.test(source),
	"the read-only transformation checks the container before emptying it"
);

// The label: a deferred report ('in_review') is NOT finished, and the filter that shows it must not
// claim it is. "Bearbeitet" covers decided and deferred alike; "Erledigt" would be a false claim about
// a report someone deliberately put aside.
assert.ok(
	source.includes('{ value: "erledigt", label: "Bearbeitet" }'),
	"the filter says 'Bearbeitet', because a deferred report is not 'Erledigt'"
);

// The cap is stated truthfully per scope. 💣 Until A30 this asserted that with "Alle" the cap applied
// ONLY to the processed half and the open half was complete -- true then, false now: the open queue
// has its own cap (500) since an unauthenticated channel can fill it. Two halves, two caps, and the
// note must name whichever was actually cut rather than one sentence for both.
assert.ok(
	!source.includes("die offenen sind vollstaendig"),
	"the panel no longer promises the open list is complete"
);
assert.ok(
	/reviewReportsOpenTruncated[\s\S]{0,200}aeltesten \$\{reviewReportsOpenLimit\}/.test(source),
	"a cut open queue is announced with its own number"
);
assert.ok(
	/reviewReportsTruncated\) cutParts\.push\(`von den bearbeiteten nur die neuesten/.test(source),
	"and under 'Alle' the processed half is still named separately"
);
// ⚠️ Only what was really cut gets mentioned: an empty cutParts must produce no sentence at all, or
// every ordinary load would carry a warning about a truncation that did not happen.
assert.ok(
	/cutParts\.length > 0 \? [\s\S]{0,80} : ""/.test(source),
	"an uncut list says nothing about caps"
);
// ⭐ Oldest-first is what makes the queue cap safe -- a flood lands at the end and is what gets cut --
// so the note says "aeltesten", not "neuesten", for the open half. Naming the wrong end would tell an
// editor their oldest reports had been hidden.
assert.ok(
	!/offenen nur die neuesten/.test(source),
	"the open half is never described as cut from the old end"
);

console.log("review-report-processed-render ok");
