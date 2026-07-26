const assert = require("assert");

// The intro module is one IIFE; everything in it except this decision is DOM wiring that needs a
// document (plan, global rule 7). What IS worth locking down is the "einmalig" contract itself -- four
// independent reasons NOT to show a notice, and every one of them has a way of getting dropped in a
// later edit.
const { shouldShowEcosystemIntro } = require("../map-features-ecosystem-intro.js");

assert.strictEqual(
	shouldShowEcosystemIntro({ seen: false, dismissedInSession: false, modeActive: true, dialogOpen: false }),
	true,
	"first entry into the layer, nothing seen yet: this is the one case that shows the notice"
);

assert.strictEqual(
	shouldShowEcosystemIntro({ seen: true, dismissedInSession: false, modeActive: true, dialogOpen: false }),
	false,
	"localStorage says it was read once -- 'einmalig' means across page loads, not per session"
);

// 💣 The session flag is NOT redundant next to `seen`. With storage blocked (private mode, hardened
// profile) the read keeps answering false, and without this the notice would come back on EVERY mode
// entry -- and switching modes is something an editor does constantly. Dropping it as "duplicate state"
// is the plausible cleanup, and it turns a one-time notice into a recurring one for exactly the users
// who cannot make it stop.
assert.strictEqual(
	shouldShowEcosystemIntro({ seen: false, dismissedInSession: true, modeActive: true, dialogOpen: false }),
	false,
	"dismissed in this page load: stays dismissed even when the localStorage write never landed"
);

// syncEcosystemVisibility() runs on every mode change, not only on the first. Without this the second
// call would re-open a dialog the editor is currently reading and throw focus back to its button.
assert.strictEqual(
	shouldShowEcosystemIntro({ seen: false, dismissedInSession: false, modeActive: true, dialogOpen: true }),
	false,
	"already on screen: a second sync must not re-open it"
);

// The three gates (mode + IS_EDIT_MODE + IS_ECOSYSTEM_ENABLED) are folded into modeActive by the caller.
// A notice about a tool nobody can reach would burn the one-time flag on a visitor who never draws.
assert.strictEqual(
	shouldShowEcosystemIntro({ seen: false, dismissedInSession: false, modeActive: false, dialogOpen: false }),
	false,
	"layer not actually active: no notice, and the flag stays unspent"
);

// Called during a mode change that happens before the DOM or the switch module is up: answer no rather
// than throw. Same reflex as ecosystemMapMenuVisibility() with no arguments.
assert.strictEqual(shouldShowEcosystemIntro(), false, "called with nothing: shows nothing instead of throwing");
assert.strictEqual(shouldShowEcosystemIntro({}), false, "called with an empty bag: same");

console.log("ecosystem-intro.test.js: all assertions passed");
