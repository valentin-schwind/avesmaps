const assert = require("assert");

// The client half of the permission channel that replaced `?landschaften=1` on 2026-08-01.
//
// 💣 What is tested here is the DECISION, not the fetch: given whatever GET /api/app/session.php
// answered -- including nothing, garbage, or an error page -- does this visitor get the landscape
// layer? Every wrong answer here is a public inventory change, so every wrong answer is asserted.
//
// Run (Windows), from the repo root:
//   node js/app/__tests__/session.test.js
const {
	normalizeSessionPayload,
	sessionGrantsEcosystem,
} = require("../session.js");

const ANONYMOUS = { authenticated: false, username: null, role: null,
	capabilities: { admin: false, edit: false, review: false, social: false } };

// ---- the gate --------------------------------------------------------------------------------------

assert.strictEqual(sessionGrantsEcosystem({ capabilities: { admin: true } }), true,
	"an admin gets the landscape layer");
// 🔴 Seit 2026-08-04 auch der EDITOR (Owner: „editoren können es jetzt editieren, nicht nur admins").
// Das holt den Client nur dorthin, wo der Server längst steht: api/edit/map/ecosystem.php verlangt seit
// je die Fähigkeit `edit`. Der Client war ENGER als das Schloss.
assert.strictEqual(sessionGrantsEcosystem({ capabilities: { admin: false, edit: true } }), true,
	"an editor gets it too now -- the write endpoint has always asked for `edit`");
assert.strictEqual(sessionGrantsEcosystem({ capabilities: { review: true } }), false,
	"and neither does a reviewer -- 'zur gegebenen Zeit', not today");
// 💣 Auch hier zählt nur echtes `true`: dieselbe Falle wie bei `admin`, eine Zeile tiefer im selben Gatter.
assert.strictEqual(sessionGrantsEcosystem({ capabilities: { admin: false, edit: "1" } }), false,
	"the string '1' does not open the gate for an editor either");
assert.strictEqual(sessionGrantsEcosystem(ANONYMOUS), false, "an anonymous visitor never does");

// 🔴 Fail CLOSED on every shape the network can hand us. The old gate was a url parameter, so a
// missing answer used to mean "off" by accident; here it has to mean "off" on purpose.
assert.strictEqual(sessionGrantsEcosystem(null), false, "no answer -> no layer");
assert.strictEqual(sessionGrantsEcosystem(undefined), false, "no answer -> no layer");
assert.strictEqual(sessionGrantsEcosystem({}), false, "an empty object -> no layer");
assert.strictEqual(sessionGrantsEcosystem("admin"), false, "a string is not a capability set");
assert.strictEqual(sessionGrantsEcosystem({ capabilities: null }), false, "null capabilities -> no layer");
// 💣 A truthy non-boolean must not open the gate: an html error page parsed as JSON, or a proxy that
// answers `{"capabilities":{"admin":"0"}}`, would otherwise walk every visitor into the layer.
assert.strictEqual(sessionGrantsEcosystem({ capabilities: { admin: "0" } }), false,
	"the string '0' is not true");
assert.strictEqual(sessionGrantsEcosystem({ capabilities: { admin: 1 } }), false,
	"only a real boolean true opens the gate");
// The role alone is not the gate -- the capability flags are. One decision, server-side, mirrored here.
assert.strictEqual(sessionGrantsEcosystem({ role: "admin", capabilities: { admin: false } }), false,
	"the capability flag wins over the role string");

// ---- normalising whatever came back ----------------------------------------------------------------

assert.deepStrictEqual(normalizeSessionPayload(null), ANONYMOUS, "no answer normalises to anonymous");
assert.deepStrictEqual(normalizeSessionPayload({ ok: false }), ANONYMOUS,
	"an error envelope normalises to anonymous");
assert.deepStrictEqual(
	normalizeSessionPayload({ ok: true, authenticated: true, username: "vali", role: "admin",
		capabilities: { admin: true, edit: true, review: true, social: true } }),
	{ authenticated: true, username: "vali", role: "admin",
		capabilities: { admin: true, edit: true, review: true, social: true } },
	"a good answer travels through unchanged, minus the envelope");
assert.strictEqual(normalizeSessionPayload({ ok: true, authenticated: true, capabilities: { admin: "yes" } })
	.capabilities.admin, false, "a non-boolean capability normalises to false, not to truthy");

// ---- 'social': publishing in the name of the project ------------------------------------------------

// 💣 Same rule as admin/edit/review, and it matters more here: this one opens a window that posts
// PUBLICLY and irreversibly. A JSON-parsed error page or a proxy writing "1" must never open it.
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: { social: true } })
	.capabilities.social, true, "social passes when the server really says true");
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: { social: "1" } })
	.capabilities.social, false, "a string is not a permission");
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: { social: 1 } })
	.capabilities.social, false, "nor is a 1");
assert.strictEqual(normalizeSessionPayload({ ok: true, capabilities: {} })
	.capabilities.social, false, "missing means no");
assert.strictEqual(normalizeSessionPayload(null).capabilities.social, false, "no payload means no");
// Being an admin in the answer is not enough on its own -- the flag is the gate, the role is not.
assert.strictEqual(normalizeSessionPayload({ ok: true, role: "admin", capabilities: { admin: true } })
	.capabilities.social, false, "the role string alone does not grant social");

console.log("session.test.js: all asserts passed");
