const assert = require("assert");

// place-extras renders through the app globals (tr/escapeHtml) and, for the link markers, through
// link-status.js. In the browser all three are plain globals loaded earlier by index.html, so the test
// installs the REAL implementations as globals rather than faking them -- a stubbed escaper would hide
// exactly the escaping bugs this markup can have.
const { escapeHtml } = require("../../app/utils.js");
const { avesmapsLinkStatusMarkup, avesmapsLinkStatusLinkClass } = require("../../app/link-status.js");

global.escapeHtml = escapeHtml;
global.avesmapsLinkStatusMarkup = avesmapsLinkStatusMarkup;
global.avesmapsLinkStatusLinkClass = avesmapsLinkStatusLinkClass;
// German path of the real tr(): return the German default with {placeholders} filled in.
global.tr = function (key, germanDefault, params) {
	let out = String(germanDefault == null ? "" : germanDefault);
	Object.keys(params || {}).forEach((name) => {
		out = out.split("{" + name + "}").join(String(params[name]));
	});
	return out;
};

const { advShopLinks, advBestLink, buildAdventureRowMarkup } = require("../map-features-place-extras.js");

// ---- advShopLinks: the server list wins (Spec §2.5) ----------------------------------------------
// avesmapsAdventureLinks() in api/_internal/app/adventures.php is the SINGLE definition of the priority
// rule. Whenever the payload carries it, the client must not re-derive its own -- that divergence is
// precisely what §2.5 exists to prevent, and only the server list carries the checked state.
const served = advShopLinks({
	title: "Siegelbruch",
	url: "https://de.wiki-aventurica.de/wiki/Siegelbruch",
	links: [
		{ key: "ulisses", label: "Ulisses eBook", url: "https://ulisses/1", state: "online" },
		{ key: "extra:7", label: "Rezension von XY", url: "https://example.org/r", state: "dead" },
	],
});
assert.deepStrictEqual(served.map((l) => l.key), ["ulisses", "extra:7"]);
assert.strictEqual(served[0].state, "online");
// The curated extras (§2.4) arrive through the same list -- the client does not know they are special.
assert.strictEqual(served[1].label, "Rezension von XY");

// No server list (placeholder data without a backend) -> the client builder still produces the same
// priority order, so the strip keeps working on a dev box.
const local = advShopLinks({ title: "Nedime", linkUlisses: "https://ulisses/2", isbn: "978-3" });
assert.deepStrictEqual(local.map((l) => l.key), ["ulisses", "wiki", "dnb"]);
// An empty (not absent) list means "this adventure genuinely has no links" and must NOT resurrect the
// client builder -- an adventure the server says has nothing must not sprout a guessed DNB search.
assert.deepStrictEqual(advShopLinks({ title: "X", links: [] }), []);

// advBestLink = the cover target = the highest-priority link, from whichever list won.
assert.strictEqual(advBestLink({ title: "X", links: [{ key: "fshop", label: "F", url: "https://f/1" }] }).url, "https://f/1");
assert.strictEqual(advBestLink({ title: "X", links: [] }), null);
assert.strictEqual(advBestLink({}), null);
console.log("advShopLinks ok");

// ---- buildAdventureRowMarkup: the dialog row (Spec §2.3) -----------------------------------------
const row = buildAdventureRowMarkup({
	public_id: "adv-1",
	title: "Siegelbruch",
	type: "Gruppenabenteuer",
	edition: "DSA5",
	yearLabel: "Travia 1044 BF",
	year: 1044,
	genre: "Intrige",
	complexity: "mittel",
	containedIn: "Im Namen des Thearchen",
	cover: "https://wiki/cover.jpg",
	url: "https://de.wiki-aventurica.de/wiki/Siegelbruch",
	links: [
		{ key: "ulisses", label: "Ulisses eBook", url: "https://ulisses/1", state: "online" },
		{ key: "wiki", label: "Wiki Aventurica", url: "https://wiki/S", state: "unchecked" },
		{ key: "extra:7", label: "Rezension", url: "https://example.org/r", state: "dead" },
	],
});

// Middle column: title -> wiki page, plus the meta lines.
assert.ok(row.includes("Siegelbruch"), "row shows the title");
assert.ok(row.includes('href="https://de.wiki-aventurica.de/wiki/Siegelbruch"'), "title links to the wiki page");
assert.ok(row.includes("DSA5") && row.includes("Travia 1044 BF") && row.includes("Gruppenabenteuer"), "row shows edition/year/type");
assert.ok(row.includes("Intrige") && row.includes("mittel"), "row shows genre + complexity");
assert.ok(row.includes("Im Namen des Thearchen"), "row shows the containing product");

// Left column: the cover is the PRIMARY link (unchanged from the card) -- not the wiki page.
assert.ok(row.includes('href="https://ulisses/1"'), "cover opens the highest-priority link");

// Right column: every link with its combined "(status, kostenpflichtig)" note. The status word is
// coloured (online=green, offline=red, "Status unbekannt"=neutral); paid shops add "kostenpflichtig" in
// the SAME bracket. The neutral word is deliberately NOT "ungeprüft" (Owner 2026-07-18): the state also
// covers links we probed and were refused on (401/403), which is not our omission -- see link-status.js.
assert.ok(row.includes("Ulisses eBook") && row.includes("Wiki Aventurica") && row.includes("Rezension"), "all links listed");
assert.ok(row.includes("online") && row.includes("link-status--online"), "online marker is the green word");
assert.ok(row.includes("Status unbekannt") && row.includes("link-status--unchecked"), "unchecked marker is the neutral word");
assert.ok(row.includes("offline") && row.includes("link-status--dead"), "offline marker is the red word");
assert.ok(row.includes("kostenpflichtig") && row.includes("avesmaps-adv-row__linkmeta"), "the paid shop link shows kostenpflichtig in the shared bracket");
// A dead link stays clickable but must read as dead.
assert.ok(row.includes('href="https://example.org/r"'), "dead link stays clickable");
assert.ok(row.includes("link-status-dead-target"), "dead link carries the struck-through class");

// The row must be filterable/sortable by the SAME data attributes as the card -- the dialog's shared
// sort + filter handlers read these, so a missing one silently breaks a control rather than the row.
assert.ok(row.includes('data-title="Siegelbruch"'), "data-title");
assert.ok(row.includes('data-year="1044"'), "data-year");
assert.ok(row.includes('data-type="Gruppenabenteuer"'), "data-type");
assert.ok(row.includes('data-edition="DSA5"'), "data-edition");
assert.ok(row.includes('data-genre="Intrige"'), "data-genre");
assert.ok(row.includes('data-complexity="mittel"'), "data-complexity");

// An adventure with no links at all: still a valid row (title + meta), just no link column entries.
const bare = buildAdventureRowMarkup({ public_id: "adv-2", title: "Ohne Links", links: [] });
assert.ok(bare.includes("Ohne Links"), "bare row still renders");
assert.ok(!bare.includes("link-status--online") && !bare.includes("avesmaps-adv-row__linkmeta"), "bare row has no link markers");

// Spoiler role: a "spielt hier" row is marked exactly like a card, so .is-play/.show-play keep working.
const playRow = buildAdventureRowMarkup({ public_id: "adv-3", title: "P", links: [] }, true);
assert.ok(playRow.includes("is-play") && playRow.includes('data-role="play"'), "play row marked");

// Attribute-context escaping: a title with a quote must not break out of data-title="…".
const nasty = buildAdventureRowMarkup({ public_id: "adv-4", title: 'A" onmouseover="x', links: [] });
assert.ok(!nasty.includes('onmouseover="x"'), "title cannot break out of the attribute");
console.log("buildAdventureRowMarkup ok");
