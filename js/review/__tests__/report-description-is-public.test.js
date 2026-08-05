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
const blockHelpers = reportFlowCode.slice(reportFlowCode.indexOf("function showLocationEditChangeRequest"));
assert.ok(
	!/innerHTML/.test(blockHelpers.slice(0, blockHelpers.indexOf("function hideLocationEditChangeRequest"))),
	"the request is written with textContent -- it is a stranger's prose"
);

// 5. It must not survive into the next report the editor opens.
assert.ok(
	/function clearChangeReportFieldMarks\(\)[\s\S]*?hideLocationEditChangeRequest\(\);/.test(reportFlowCode),
	"resetting the dialog clears the block, or the previous reporter's request is read as this one's"
);

// 6. The prefill for a NEW place stays: there the reporter's own field is labelled "Kommentar (zur
// näheren Beschreibung)", so it IS meant as one. What changed is that the editor can now see it.
assert.ok(
	/document\.getElementById\("location-edit-description"\)\.value = \[/.test(reportFlowCode),
	"a new place still prefills the description from the report -- now in a field that is visible"
);

console.log("report-description-is-public ok");
