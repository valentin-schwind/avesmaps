const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repo = path.join(__dirname, "..", "..", "..");
const indexHtml = fs.readFileSync(path.join(repo, "index.html"), "utf8");
const reportFlow = fs.readFileSync(path.join(repo, "js", "review", "review-report-flow.js"), "utf8");
// The comments deliberately quote the old wording to explain what went wrong, so the asserts below run
// against the CODE. Only whole comment lines are dropped -- never a "//" inside a string.
const reportFlowCode = reportFlow
	.split("\n")
	.filter((line) => !line.trim().startsWith("//"))
	.join("\n");

// ===== THE RULE UNDER TEST =====
// A place's description is PUBLIC -- it is served in the map payload and rendered in the infobox. Until
// 2026-08-05 the editor dialog carried it as <input type="hidden">, and two paths wrote reader-authored
// text into it when a community report was approved: the reporter's comment for a new place, and for a
// change suggestion the request PLUS a "— Community-Änderungswunsch von …:" header. Neither was ever
// shown to the editor doing the approving -- the red "changed" outline was even applied to an invisible
// element. So a stranger's text was published, unread, by someone who could not have known.

// 1. The field is visible, and it says where its content goes.
assert.ok(
	/<textarea id="location-edit-description"/.test(indexHtml),
	"the description is a textarea the editor can actually read and edit"
);
assert.ok(
	!/id="location-edit-description"[^>]*type="hidden"/.test(indexHtml),
	"and never a hidden input again -- that is what let a stranger's text through unread"
);
assert.ok(
	/Beschreibung <span class="location-report-form__hint">— öffentlich sichtbar<\/span>/.test(indexHtml),
	"the label says the content becomes public, because that is the fact the editor was missing"
);

// 2. The limit matches the server. avesmapsReadLocationDescription truncates at 1200
// (api/_internal/map/features.php); a larger maxlength lets an editor type text that is silently cut.
const descriptionField = indexHtml.match(/<textarea id="location-edit-description"[^>]*>/)[0];
assert.ok(
	/maxlength="1200"/.test(descriptionField),
	"maxlength matches the server's 1200, or the tail is silently dropped on save"
);

// 3. A change request is NOT a description. It goes into its own read-only block.
assert.ok(
	/id="location-edit-change-request"/.test(indexHtml),
	"the request has its own place to be read"
);
assert.ok(
	!/Community-Änderungswunsch/.test(reportFlowCode),
	"and the header that used to be prepended to the public description is gone"
);
assert.ok(
	!/descEl\.value\s*=/.test(reportFlowCode),
	"nothing writes the request into the description any more"
);
assert.ok(
	reportFlowCode.includes("showLocationEditChangeRequest(report);"),
	"the change path fills the block instead"
);

// 4. It is reader-authored text: set by textContent, never innerHTML.
const showAt = reportFlowCode.indexOf("function showLocationEditChangeRequest");
const hideAt = reportFlowCode.indexOf("function hideLocationEditChangeRequest");
assert.ok(showAt > 0 && hideAt > showAt, "both block helpers exist, in that order");
assert.ok(
	!/innerHTML/.test(reportFlowCode.slice(showAt, hideAt)),
	"the request is written with textContent -- it is a stranger's prose"
);

// 5. 💣 THE BLOCK MUST OUTLIVE THE DRAW. The red "changed" outlines are re-applied on every build, so
// markChangeReportFields clears them first -- but the block belongs to the OPEN DIALOG. Putting the
// hide in clearChangeReportFieldMarks meant showLocationEditChangeRequest displayed the request and
// the same synchronous pass blanked it 44 lines later, before anything was painted. The request was
// then visible NOWHERE: not in the description (rightly), not beside it. Shipped that way once.
assert.ok(
	!/function clearChangeReportFieldMarks\(\)\s*\{[^}]*hideLocationEditChangeRequest/.test(reportFlowCode),
	"clearChangeReportFieldMarks must NOT hide the block -- it runs while the dialog is being built"
);
const showCall = reportFlowCode.indexOf("showLocationEditChangeRequest(report);");
const markCall = reportFlowCode.indexOf("markChangeReportFields(changed);");
assert.ok(showCall > 0 && markCall > showCall, "the block is filled during the build, marks come last");

// 6. It is hidden when the DIALOG resets -- a different lifetime, in a different function.
const locations = fs.readFileSync(path.join(repo, "js", "review", "review-locations.js"), "utf8");
assert.ok(
	/function resetLocationEditForm\(\)[\s\S]*?hideLocationEditChangeRequest\(\);/.test(locations),
	"resetting the dialog hides the block, or the previous reporter's request is read as this one's"
);

// 7. 💣 The dialog must LOAD the stored description. It never did: the line read
// `presetDescription || ""`, and no caller in the project sets presetDescription -- so the field was
// always empty, the payload always sent "", and the server turns an empty description into
// unset($properties['description']) (api/_internal/map/features.php:1275). Every save of an existing
// place deleted its description, including a save that only fixed a typo in the name. Invisible while
// the field was hidden.
assert.ok(
	/location-edit-description"\)\.value = presetDescription \|\| location\.description \|\| ""/.test(locations),
	"the editor loads the description it is about to send back, or saving silently deletes it"
);

// 8. The prefill cannot exceed what the field accepts. Setting .value programmatically raises the
// dirty-value flag, so maxlength makes the field invalid, and the save handler's reportValidity()
// returns without a message -- the place would simply never be created.
assert.ok(
	/\.filter\(Boolean\)\.join\("\\n\\n"\)\.slice\(0, 1200\)/.test(reportFlowCode),
	"the prefill is capped at the same 1200 the field and the server use"
);

// 6. The prefill for a NEW place stays: there the reporter's own field is labelled "Kommentar (zur
// näheren Beschreibung)", so it IS meant as one. What changed is that the editor can now see it.
assert.ok(
	/document\.getElementById\("location-edit-description"\)\.value = \[/.test(reportFlowCode),
	"a new place still prefills the description from the report -- now in a field that is visible"
);

console.log("report-description-is-public ok");
