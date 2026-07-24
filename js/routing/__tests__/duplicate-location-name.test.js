const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Parity test for the location duplicate-name rule (Discord #46).
//
// The SERVER owns the rule (avesmapsNormalizeDuplicateLocationName, api/_internal/map/features.php);
// routing.js only mirrors it so the editor gets an instant, ACCURATE preview of the server verdict.
// The two had silently drifted: the old client normalizer also stripped accents, so it folded
// "Grötz" onto "Grotz" and reported "already exists" for a name the server would have accepted.
// The corpus below is byte-for-byte the one in
// api/_internal/map/__tests__/duplicate-location-name-test.php -- if either side is changed alone,
// one of the two tests fails.
//
// routing.js is a browser global script with no module.exports (it depends on jQuery, Leaflet and a
// pile of globals), so requiring it is not possible. Instead the two pure declarations are cut out
// of the REAL source text and evaluated -- a copy pasted into this file would test nothing.
//
// Run from the repo root:  node js/routing/__tests__/duplicate-location-name.test.js

const ROUTING_SOURCE = fs.readFileSync(path.join(__dirname, "..", "routing.js"), "utf8");

function extractTopLevelDeclaration(source, startsWith, endsWith) {
	const start = source.indexOf(startsWith);
	assert.notStrictEqual(start, -1, `declaration not found in routing.js: ${startsWith}`);
	const end = source.indexOf(endsWith, start);
	assert.notStrictEqual(end, -1, `end of declaration not found in routing.js: ${startsWith}`);
	return source.slice(start, end + endsWith.length);
}

const normalizerSource = extractTopLevelDeclaration(
	ROUTING_SOURCE,
	"const normalizeServerDuplicateLocationName =",
	"\n};"
);
const messageSource = extractTopLevelDeclaration(
	ROUTING_SOURCE,
	"function duplicateLocationNameMessage(",
	"\n}"
);

const { normalizeServerDuplicateLocationName, duplicateLocationNameMessage } = new Function(
	`${normalizerSource}\n${messageSource}\n`
	+ "return { normalizeServerDuplicateLocationName, duplicateLocationNameMessage };"
)();

// name => expected normalized key. MUST match AVESMAPS_DUPLICATE_NAME_CORPUS in the PHP test.
const CORPUS = {
	"Neu-Sirensteen": "neusirensteen",
	"neusirensteen": "neusirensteen",
	"Neu Sirensteen": "neusirensteen",
	"Havena": "havena",
	"  Havena  ": "havena",
	"Punin (Horasreich)": "puninhorasreich",
	// Accents are PRESERVED -- this is the pair the client used to fold together.
	"Grötz": "grötz",
	"Grotz": "grotz",
	"Ödland": "ödland",
	"Odland": "odland",
	"Straße": "straße",
	"Strasse": "strasse",
	"Ort-42": "ort42",
	"": "",
	"---": "",
};

for (const [input, expected] of Object.entries(CORPUS)) {
	assert.strictEqual(
		normalizeServerDuplicateLocationName(input),
		expected,
		`normalize(${JSON.stringify(input)}) must equal ${JSON.stringify(expected)} (server parity)`
	);
}
console.log(`client normalizer matches the server on all ${Object.keys(CORPUS).length} corpus inputs ok`);

// Non-strings must not throw -- the callers pass raw form values.
assert.strictEqual(normalizeServerDuplicateLocationName(undefined), "");
assert.strictEqual(normalizeServerDuplicateLocationName(null), "");
assert.strictEqual(normalizeServerDuplicateLocationName(42), "");
console.log("non-string input returns '' instead of throwing ok");

// The verdicts that decide whether a second place may be created.
assert.strictEqual(
	normalizeServerDuplicateLocationName("Neu-Sirensteen"),
	normalizeServerDuplicateLocationName("neusirensteen"),
	"punctuation/case only -> same name"
);
assert.notStrictEqual(
	normalizeServerDuplicateLocationName("Grötz"),
	normalizeServerDuplicateLocationName("Grotz"),
	"REGRESSION GUARD: accents must NOT be folded (that was the false block)"
);
assert.notStrictEqual(
	normalizeServerDuplicateLocationName("Sirensteen"),
	normalizeServerDuplicateLocationName("Sirensteen (Almada)"),
	"a parenthetical qualifier frees the name -- the whole point of the fix"
);
console.log("collision verdicts ok (qualifier frees the name)");

// The message must name the blocking place and show the copyable pattern.
const message = duplicateLocationNameMessage("Sirensteen");
assert.ok(message.includes("Sirensteen (Region)"), "message shows the qualifier pattern");
assert.ok(message.includes("Klammern"), "message says what to do");
assert.strictEqual(message.split("Sirensteen").length - 1, 2, "name appears twice: the blocker and the pattern");
console.log("message names the blocker and shows the qualifier pattern ok");

console.log("ALL OK");
