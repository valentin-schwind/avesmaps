const assert = require("assert");

const {
	ecosystemAutoNamePrefix,
	nextEcosystemRegionAutoName,
	isEcosystemRegionAutoName,
	ecosystemRegionDisplayName,
} = require("../map-features-ecosystem-naming.js");

// ---------------------------------------------------------------------------- THE PREFIX ---
// The generated name is built from the Art LABEL, not the type key: the owner's own example is
// "Wald-001", and a key would read "wald-001" / "suempfe_moore-001".
assert.strictEqual(ecosystemAutoNamePrefix("Wald"), "Wald");
assert.strictEqual(ecosystemAutoNamePrefix("  Wald  "), "Wald");
// A region without an Art is a valid state (the dialog offers "— ohne Art —"), so it still needs a
// handle. "Fläche" is the neutral fallback -- never an empty prefix, which would generate "-001".
assert.strictEqual(ecosystemAutoNamePrefix(""), "Fläche");
assert.strictEqual(ecosystemAutoNamePrefix(null), "Fläche");

// ------------------------------------------------------------------------- THE GENERATOR ---
// Shape copied from getNextPathDisplayName (map-features-path-domain.js:96): scan for the pattern,
// take the highest number, add one. Zero-padded to three, matching the owner's "Wald-001".
assert.strictEqual(nextEcosystemRegionAutoName("Wald", []), "Wald-001");
assert.strictEqual(nextEcosystemRegionAutoName("Wald", ["Wald-001"]), "Wald-002");
assert.strictEqual(nextEcosystemRegionAutoName("Wald", ["Wald-001", "Wald-007"]), "Wald-008");

// Real names are ignored -- they carry no number to continue from.
assert.strictEqual(nextEcosystemRegionAutoName("Wald", ["Farindel", "Wald-003"]), "Wald-004");

// Another Art's run is a separate run. Steppe-009 must not push the forests to 010.
assert.strictEqual(nextEcosystemRegionAutoName("Wald", ["Steppe-009", "Wald-001"]), "Wald-002");

// Unpadded legacy names still count: \d+ matches "7" as readily as "007", so a hand-typed "Wald-7"
// cannot be silently overwritten by a freshly generated "Wald-001".
assert.strictEqual(nextEcosystemRegionAutoName("Wald", ["Wald-7"]), "Wald-008");

// Past 999 the run keeps going rather than wrapping or re-padding into a collision.
assert.strictEqual(nextEcosystemRegionAutoName("Wald", ["Wald-999"]), "Wald-1000");

// An Art label with regex metacharacters must be matched literally, not as a pattern.
assert.strictEqual(nextEcosystemRegionAutoName("Sümpfe und Moore", ["Sümpfe und Moore-002"]), "Sümpfe und Moore-003");

// Junk in the name list is data, not a crash: null/undefined/numbers can reach here from a partly
// loaded region list.
assert.strictEqual(nextEcosystemRegionAutoName("Wald", [null, undefined, 42, "Wald-002"]), "Wald-003");

// ------------------------------------------------------------------------- THE PREDICATE ---
// 🔴 This is the whole point of the feature: the NAME encodes whether it is a real name. Nothing is
// stored, exactly as with the ways -- checking the box renames to the pattern, clearing it types a
// real name over it. So the predicate is also the checkbox's state on reopening.
assert.strictEqual(isEcosystemRegionAutoName("Wald-001", "Wald"), true);
assert.strictEqual(isEcosystemRegionAutoName("Wald-7", "Wald"), true);
assert.strictEqual(isEcosystemRegionAutoName("Farindel", "Wald"), false);
assert.strictEqual(isEcosystemRegionAutoName("", "Wald"), false, "an empty name is not an auto-name");
// Anchored at both ends: a real name that merely ENDS in a number stays a real name.
assert.strictEqual(isEcosystemRegionAutoName("Wald der Wälder-2", "Wald"), false);
assert.strictEqual(isEcosystemRegionAutoName("Nebelwald-001", "Wald"), false);
// The Art has to agree. A steppe called "Wald-001" is a leftover, and reading it as auto-named would
// hide a name the editor can still see in the field.
assert.strictEqual(isEcosystemRegionAutoName("Wald-001", "Steppe"), false);
assert.strictEqual(isEcosystemRegionAutoName("Fläche-001", ""), true, "the no-Art fallback round-trips");

// ---------------------------------------------------------------------- THE DISPLAY NAME ---
// What the infobox will ask for. An auto-name is internal bookkeeping and must never reach a reader:
// they get the Art instead.
assert.strictEqual(ecosystemRegionDisplayName("Wald-001", "Wald"), "Wald");
assert.strictEqual(ecosystemRegionDisplayName("Farindel", "Wald"), "Farindel");
assert.strictEqual(ecosystemRegionDisplayName("", "Wald"), "Wald", "no name at all also falls back to the Art");
assert.strictEqual(ecosystemRegionDisplayName("Fläche-001", ""), "Fläche");

// ------------------------------------------------------------- DER GRIFF, WIE EIN LESER IHN SIEHT ---
// 🔴 14.09.2026: 1.136 von 1.980 Regionen trugen live einen Griff, und Tooltip wie Infopanel zeigten
// ihn roh („Wald-218 (Wald)"). Zwölf davon rutschten zusätzlich durch die alte Regel: „Fläche-048" wurde
// vergeben, als die Region noch keine Art hatte, und seit sie ein Urwald ist, sah der Haken darin einen
// echten Namen. Die ANZEIGE kennt deshalb beide Griffe -- den der jetzigen Art und den Rückfall-Griff.
const { ecosystemRegionNameIsGriff, ecosystemRegionLeserName } = require("../map-features-ecosystem-naming.js");

assert.strictEqual(ecosystemRegionNameIsGriff("Wald-218", "Wald"), true);
assert.strictEqual(ecosystemRegionNameIsGriff("Fläche-048", "Urwald"), true,
	"der Griff aus der Zeit vor der Art bleibt ein Griff");
assert.strictEqual(ecosystemRegionNameIsGriff("fläche-012", "See"), true,
	"ohne Rücksicht auf Gross- und Kleinschreibung -- die sichere Richtung ist verbergen");
assert.strictEqual(ecosystemRegionNameIsGriff("Sümpfe (alt)-3", "Sümpfe (alt)"), true,
	"eine Art mit Klammer ist Inhalt, kein Muster");
assert.strictEqual(ecosystemRegionNameIsGriff("Wald-003", "Urwald"), false,
	"der Griff einer FREMDEN Art verbirgt erst die Suche -- die Anzeige kennt keinen Artenkatalog");
assert.strictEqual(ecosystemRegionNameIsGriff("Wald der Wälder-2", "Wald"), false);
assert.strictEqual(ecosystemRegionNameIsGriff("Nebelwald-001", "Wald"), false, "beidseitig verankert");
assert.strictEqual(ecosystemRegionNameIsGriff("", "Wald"), false, "ein leerer Name ist kein Griff");
assert.strictEqual(ecosystemRegionNameIsGriff(null, null), false);

// 💣 Der HAKEN bleibt, wie er ist -- er ist eine eigene Entscheidung mit gespeichertem Merker
// (avesmapsEcosystemAutoNameAusMerker). Wer die Anzeige an ihn koppelt, ändert, wie der Haken beim
// Öffnen steht.
assert.strictEqual(isEcosystemRegionAutoName("Fläche-048", "Urwald"), false, "der Haken ist unberührt");
assert.strictEqual(isEcosystemRegionAutoName("wald-004", "Wald"), false, "auch in der Schreibweise");

// Der Name, den ein Leser sieht -- oder "", wenn es weder Namen noch Art zu sagen gibt. Der Aufrufer
// entscheidet, was dann steht („Ohne Namen" im Tooltip, gar nichts in „Führt durch").
assert.strictEqual(ecosystemRegionLeserName("Farindel", "Wald"), "Farindel");
assert.strictEqual(ecosystemRegionLeserName("  Farindel ", "Wald"), "Farindel");
assert.strictEqual(ecosystemRegionLeserName("Wald-218", "Wald"), "Wald");
assert.strictEqual(ecosystemRegionLeserName("Fläche-048", "Urwald"), "Urwald");
assert.strictEqual(ecosystemRegionLeserName("", "Wald"), "Wald");
assert.strictEqual(ecosystemRegionLeserName("Fläche-021", ""), "", "ein Griff ohne Art sagt nichts");
assert.strictEqual(ecosystemRegionLeserName("", ""), "");
assert.strictEqual(ecosystemRegionLeserName(undefined, null), "");

// ecosystemRegionDisplayName folgt der Anzeige und behält seinen Rückfall „Fläche".
assert.strictEqual(ecosystemRegionDisplayName("Fläche-048", "Urwald"), "Urwald");
assert.strictEqual(ecosystemRegionDisplayName("wald-004", "Wald"), "Wald");
assert.strictEqual(ecosystemRegionDisplayName("Fläche-021", ""), "Fläche");

console.log("ecosystem naming tests passed");
