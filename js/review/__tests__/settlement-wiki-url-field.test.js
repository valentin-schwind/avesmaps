const assert = require("assert");

// ===== THE RULE UNDER TEST =====
// "Ort bearbeiten" carries a HIDDEN wiki_url input (#location-edit-wiki-url, index.html). Two things
// write it and they must agree:
//   - openLocationEditDialog seeds it from location.wikiUrl (review-locations.js:515) -- and that value
//     is the ENRICHED one from the map-features payload, which for a place with an empty wiki_url column
//     is guessed by name (avesmapsEnrichMapFeatureWikiUrl) and can point at a foreign page.
//   - buildLocationEditPayload sends it back verbatim on every save (review-locations.js:607); omitting
//     it would unset properties.wiki_url, so "" is written as "" -- a real, persisted empty value.
// Picking a settlement from the wiki picker therefore has to update that hidden field too, or the next
// save silently rewrites the just-made connection back to the stale/guessed/empty URL.
// Discord #38 (Nottel, Baldmarsfeld): "Gewaehlter Eintrag aus der Auswahlliste wird ignoriert und ein
// anderer eingetragen. Leerer Eintrag wird gespeichert."

const fields = new Map();
function putField(id, value) {
	const element = { value, textContent: "", innerHTML: "", hidden: false, disabled: false, focus() {} };
	fields.set(id, element);
	return element;
}

global.document = {
	addEventListener() {},
	getElementById(id) {
		return fields.get(id) || null;
	},
	// settlementWikiEscapeText round-trips text through a detached div; the picker render path uses it.
	createElement() {
		return {
			set textContent(value) { this._text = String(value); },
			get textContent() { return this._text || ""; },
			get innerHTML() { return String(this._text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"); },
		};
	},
};
global.window = {};
global.showFeedbackToast = () => {};
global.apiErrorMessage = (_response, fallback) => fallback;

// The place under edit: Baldmarsfeld, not yet connected to a wiki settlement.
global.locationEditMarkerEntry = { publicId: "3d99b2af-c4ac-4a14-b8a7-af520d9fb539", name: "Baldmarsfeld", location: { name: "Baldmarsfeld" } };

// assign_to answers with the canonical page URL in settlement.wiki_url
// (avesmapsWikiSettlementParseInfobox, api/_internal/wiki/settlements.php:570).
const CHOSEN_URL = "https://de.wiki-aventurica.de/wiki/Baldmarsfeld_(Weiden)";
let lastPostBody = null;
global.fetch = (_url, options) => {
	lastPostBody = JSON.parse(options.body);
	return Promise.resolve({
		json: () => Promise.resolve({
			ok: true,
			wiki_name: "Baldmarsfeld (Weiden)",
			revision: 4712,
			settlement: { title: "Baldmarsfeld (Weiden)", name: "Baldmarsfeld", wiki_url: CHOSEN_URL },
		}),
	});
};

const { selectSettlementWikiResult, removeSettlementWiki } = require("../review-settlement-wiki.js");

(async () => {
	// ---- Case 1: the hidden field still holds a WRONG guessed URL --------------------------------------
	// This is the reported shape: the enrichment guessed a foreign page, the dialog seeded it, and the
	// user picks the correct settlement to fix exactly that.
	putField("location-edit-wiki-url", "https://de.wiki-aventurica.de/wiki/Baldmarsfeld_(Andergast)");
	putField("settlement-wiki-picker-status", "");
	putField("settlement-wiki-reference-list", "");

	await selectSettlementWikiResult("Baldmarsfeld (Weiden)");

	assert.strictEqual(lastPostBody.action, "assign_to", "picking still writes through assign_to");
	assert.strictEqual(lastPostBody.title, "Baldmarsfeld (Weiden)");
	// Before the fix this stayed on the Andergast URL, and the next save persisted THAT -- the chosen
	// entry was ignored and "ein anderer eingetragen", exactly as reported.
	assert.strictEqual(
		fields.get("location-edit-wiki-url").value,
		CHOSEN_URL,
		"the chosen settlement's URL must land in the hidden field, or the next save overwrites it"
	);
	assert.strictEqual(global.locationEditMarkerEntry.location.wikiSettlement.title, "Baldmarsfeld (Weiden)");

	// ---- Case 2: the hidden field was EMPTY ------------------------------------------------------------
	// Second half of the report: saving wrote an empty wiki_url ("Leerer Eintrag wird gespeichert"),
	// which then let the server-side name guess invent a link again on the very next payload.
	putField("location-edit-wiki-url", "");
	await selectSettlementWikiResult("Baldmarsfeld (Weiden)");
	assert.strictEqual(fields.get("location-edit-wiki-url").value, CHOSEN_URL, "an empty field must be filled too");

	// ---- Case 3: removing stays removed ---------------------------------------------------------------
	// Guard against the fix breaking the opposite direction: clear_assign deliberately empties the field
	// so auto-connect cannot silently restore the connection on the next save (owner rule).
	global.fetch = () => Promise.resolve({ json: () => Promise.resolve({ ok: true, revision: 4713 }) });
	await removeSettlementWiki();
	assert.strictEqual(fields.get("location-edit-wiki-url").value, "", "removing must still clear the field");

	console.log("OK - picking a wiki settlement writes its URL into the hidden field; removing clears it");
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
