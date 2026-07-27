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

console.log("ecosystem naming tests passed");
