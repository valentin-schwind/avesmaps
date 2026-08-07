// Das Bauteil der Übernahme-Vorschau: was vorangehäkelt ankommt, was die Fußzeile rechnet, und wann
// der Löschriegel zumacht. Entwurf: docs/superpowers/specs/2026-08-06-sync-uebernahme-design.md.
//
// 🔴 Geprüft wird die ECHTE Datei in einer vm-Sandbox OHNE DOM — das ist beides Absicht: ein Stub
// zertifizierte den Stub, und eine Datei, die beim Laden schon ein `document` braucht, lässt sich
// nicht prüfen, bevor sie im Browser steht.
//
// Ausführen, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/sync-plan-sheet.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const source = fs.readFileSync(path.join(ROOT, "js", "review", "sync-plan-sheet.js"), "utf8");

const sandbox = { console, fetch: () => {}, document: undefined, window: undefined };
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: "sync-plan-sheet.js" });

const footer = sandbox.syncPlanFooterState;
const markup = sandbox.syncPlanSheetMarkup;
const fieldLabel = sandbox.syncPlanFieldLabel;
assert.strictEqual(typeof footer, "function", "die echten Funktionen sind geladen");
assert.strictEqual(typeof markup, "function");
assert.strictEqual(typeof fieldLabel, "function");

// ---- Die Fußzeile ------------------------------------------------------------------------------

assert.strictEqual(footer({ selected: 42, deletions: 0, confirmed: false }).applyDisabled, false);
assert.strictEqual(footer({ selected: 0, deletions: 0, confirmed: false }).applyDisabled, true,
	"ohne ein einziges Häkchen gibt es nichts zu übernehmen");

// 🔴 DER RIEGEL. Solange eine Löschung angehäkelt und nicht bestätigt ist, geht GAR NICHTS — auch die
// harmlosen Übernahmen nicht. Sonst wäre die zweite Bestätigung eine Empfehlung, die man umgeht,
// indem man erst den Rest übernimmt.
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: false }).applyDisabled, true);
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: true }).applyDisabled, false);
assert.strictEqual(footer({ selected: 43, deletions: 1, confirmed: false }).gateVisible, true);
assert.strictEqual(footer({ selected: 43, deletions: 0, confirmed: false }).gateVisible, false,
	"ohne angehäkelte Löschung erscheint die zweite Bestätigung gar nicht");

// Der Knopf sagt, was er tut — „Übernehmen" allein verschweigt die Löschungen.
assert.strictEqual(footer({ selected: 43, deletions: 2, confirmed: true }).applyLabel, "Übernehmen und 2 löschen");
assert.strictEqual(footer({ selected: 43, deletions: 0, confirmed: true }).applyLabel, "Übernehmen");

// Ein/Mehrzahl, und das Wort gehört zur Art des Abgleichs (bei den Vorkommen sind es „Zuordnungen").
assert.ok(footer({ selected: 1, deletions: 1, kind: "citymap" }).gateText.includes("1 Karte wirklich"));
assert.ok(footer({ selected: 3, deletions: 3, kind: "citymap" }).gateText.includes("3 Karten wirklich"));

// 💣 Die ausgeblendeten Zeilen zählen MIT. Sie stehen mit ihrem Häkchen in der Datenbank, „alle
// übernehmen" erreicht sie also — behauptete die Fußzeile „200 von 5.012", wäre das schlicht falsch.
assert.strictEqual(footer({ selected: 200, hidden: 4812, deletions: 0 }).selectedTotal, 5012);

// ---- Die Feldnamen -----------------------------------------------------------------------------
//
// Ein roher Spaltenname in der Vorschau ist keine Antwort: „has_scale → 1" sagt niemandem etwas.
["title", "map_url", "art", "is_color", "is_labeled", "format", "has_scale", "author", "publisher",
	"note", "place", "source", "links"].forEach((field) => {
	const label = fieldLabel(field);
	assert.notStrictEqual(label, field, `${field} hat eine deutsche Beschriftung`);
	assert.ok(label.length > 0, `${field} ist nicht leer beschriftet`);
});
// Ein unbekanntes Feld wird durchgereicht statt verschluckt — sichtbar ist besser als verschwunden.
assert.strictEqual(fieldLabel("wurstsalat"), "wurstsalat");

// ---- Das Markup --------------------------------------------------------------------------------

function planWith(overrides) {
	return Object.assign({
		kind: "citymap",
		run: {
			id: 7,
			state: "open",
			created_at: "2026-08-06 21:14:00",
			source_stamp: "2026-08-06 20:02:11",
			counts: { new: 1, changed: 1, deleted: 1, total: 3 },
		},
		items: {
			new: [{ id: 1, entity_key: "k1", change_type: "new", label: "Elenvina – Werftviertel",
				before: {}, after: { title: "Elenvina – Werftviertel", art: "stadtplan" }, override: {},
				selected: true, skipped_count: 0, last_skipped_at: "" }],
			changed: [{ id: 2, entity_key: "k2", change_type: "changed", label: "Havena – Hafenviertel",
				before: { title: "Havena, Hafen" }, after: { title: "Havena – Hafenviertel" }, override: {},
				selected: true, skipped_count: 0, last_skipped_at: "" }],
			deleted: [{ id: 3, entity_key: "k3", change_type: "deleted", label: "Punin – Altstadt",
				before: { place_count: 4, link_count: 1, related_count: 0, source_count: 2 }, after: {},
				override: {}, selected: false, skipped_count: 0, last_skipped_at: "" }],
		},
		truncated: { new: 0, changed: 0, deleted: 0 },
		declined_count: 0,
	}, overrides || {});
}

const html = markup(planWith());
assert.ok(html.includes("Elenvina – Werftviertel") && html.includes("Punin – Altstadt"), "alle drei Gruppen stehen drin");
assert.ok(html.includes("<details"), "die Gruppen sind <details> — Strg+F findet Text auch zugeklappt");
assert.ok(html.includes("grp--del"), "die Löschgruppe ist als solche gekennzeichnet");
// Vorangehäkelt: Neu und Geändert ja, Gelöscht nie.
const deletedRow = html.slice(html.indexOf("Punin – Altstadt") - 400, html.indexOf("Punin – Altstadt"));
assert.ok(!deletedRow.includes("checked"), "🔴 keine Löschzeile kommt angehäkelt an");
// Was mit der Karte ginge, steht an der Zeile — sonst ist „löschen" eine Zahl ohne Gewicht.
assert.ok(html.includes("4 Fundorte"), "die Löschzeile nennt, was mitginge");

// 🔴 KEIN „alle" ÜBER DEN LÖSCHUNGEN. Bei 168 neuen Zeilen ist Einzelklicken keine Bedienung; bei
// Löschungen ist es genau der Punkt. Ein Knopf, der 37 auf einmal anhäkelt, macht die zweite
// Bestätigung zur einzigen Hürde und die erste zur Formsache.
const delGroup = html.slice(html.indexOf('class="grp grp--del"'));
assert.ok(!delGroup.slice(0, delGroup.indexOf("</summary>")).includes("data-bulk"),
	"die Löschgruppe hat keine Sammelknöpfe");
assert.ok(html.slice(0, html.indexOf('class="grp grp--del"')).includes("data-bulk"),
	"Neu und Geändert haben sie sehr wohl");

// ⚠️ Eine NEUE Karte beschreibt sich, sie vergleicht nicht: „Titel — → Elenvina" behauptet ein
// Vorher, das es nie gab, und füllt die Zeile mit Gedankenstrichen.
const newRow = html.slice(html.indexOf("Elenvina"), html.indexOf("Havena"));
assert.ok(!newRow.includes('class="old"'), "eine neue Zeile zeigt kein durchgestrichenes Vorher");
assert.ok(newRow.includes("Titel: Elenvina"), "sondern schlicht, was ankommt");

// Ein einzelner Fundort „gehen" nicht — diese Zeile wird gelesen, wenn Sorgfalt zählt.
const one = planWith();
one.items.deleted[0].before = { place_count: 1, link_count: 0, related_count: 0, source_count: 0 };
assert.ok(markup(one).includes("Mit ihr verschwindet 1 Fundort"), "Einzahl im Verb");
assert.ok(html.includes("Mit ihr verschwinden 4 Fundorte"), "und Mehrzahl sonst");

// 💣 Escaping. Ein Kartentitel ist Wiki-Text, kein Vertrauensbeweis — und diese Vorschau zeigt genau
// die Zeichenketten, die ein Fremder ins Wiki geschrieben hat.
const evil = planWith();
evil.items.new[0].label = '<img src=x onerror="alert(1)">';
evil.items.changed[0].after.title = '"><script>alert(2)</script>';
const evilHtml = markup(evil);
assert.ok(!evilHtml.includes("<img src=x"), "der Titel wird escaped");
assert.ok(!evilHtml.includes("<script>alert(2)"), "auch ein Wert im Unterschied wird escaped");
assert.ok(evilHtml.includes("&lt;img"), "und er ist noch da, nur unschädlich");

// Die gekürzte Liste sagt, dass sie gekürzt ist — schweigend abschneiden liest sich wie Vollständigkeit.
const short = planWith();
short.run.counts = { new: 5012, changed: 1, deleted: 1, total: 5014 };
short.truncated = { new: 4812, changed: 0, deleted: 0 };
const shortHtml = markup(short);
assert.ok(shortHtml.includes("4.812") || shortHtml.includes("4812"), "die Restzahl steht da");

// Ein leerer Plan ist kein Fehler, sondern die beste Nachricht des Tages.
const emptyHtml = markup(planWith({
	run: { id: 8, state: "open", created_at: "", source_stamp: "", counts: { new: 0, changed: 0, deleted: 0, total: 0 } },
	items: { new: [], changed: [], deleted: [] },
}));
assert.ok(emptyHtml.length > 0 && !emptyHtml.includes("undefined"), "leerer Plan rendert ohne undefined");

// ---- Der übersprungene Eintrag -----------------------------------------------------------------
//
// „⤴ 3× übersprungen" ist ein Zustand, keine Warnung: dass etwas liegenbleibt, ist erlaubt.
const skipped = planWith();
skipped.items.changed[0].skipped_count = 3;
skipped.items.changed[0].last_skipped_at = "2026-07-28 10:00:00";
skipped.items.changed[0].selected = false;
const skippedHtml = markup(skipped);
assert.ok(skippedHtml.includes("3×") || skippedHtml.includes("3&times;"), "die Zahl der Übersprünge steht an der Zeile");
assert.ok(skippedHtml.includes("28.07."), "und wann zuletzt");

// ---- Die Arten (Sitzung 2) ---------------------------------------------------------------------
//
// Jede Art, die eine Vorschau hat, braucht einen Titel und ein Wort für ihre Einträge; sonst steht im
// Kopf „Aus dem Wiki übernehmen" und in der zweiten Bestätigung „3 Einträge" -- richtig, aber blind.
// ⚠️ Gefragt wird über syncPlanKindMeta, nicht an den Tabellen vorbei: `const` auf oberster Ebene ist
// in der vm-Sandbox keine Eigenschaft des globalen Objekts (nur Funktionen und `var` sind es). Ein
// Zugriff ist ohnehin die richtige Antwort -- die drei Tabellen sind ein Innenleben, keine Schnittstelle.
const kindMeta = sandbox.syncPlanKindMeta;
assert.strictEqual(typeof kindMeta, "function", "das Bauteil sagt, was es über eine Art weiß");
["citymap", "adventure", "publication"].forEach((kind) => {
	const meta = kindMeta(kind);
	assert.ok(meta.known, `${kind} ist eine bekannte Art`);
	assert.ok(meta.title && meta.title !== "Aus dem Wiki übernehmen", `${kind} hat einen eigenen Titel`);
	assert.ok(meta.nouns && meta.nouns.one && meta.nouns.many, `${kind} hat ein Hauptwort`);
});
// Löscht: Karten ja, Abenteuer nein -- und „nein" ist eine Antwort, kein fehlender Eintrag.
assert.ok(kindMeta("citymap").deletion, "Karten können verschwinden");
assert.strictEqual(kindMeta("adventure").deletion, null, "ein Abenteuer wird nie gelöscht");
assert.strictEqual(kindMeta("publication").deletion, null, "und ein Ort nicht wegen einer Fußnote");
// Eine unbekannte Art bekommt die strengste Fassung: eine zu starke Warnung ist besser als keine.
assert.ok(kindMeta("wurstsalat").deletion, "eine unbekannte Art wird streng behandelt");
assert.strictEqual(kindMeta("wurstsalat").known, false);

// 🔴 Eine Art, die NICHTS löscht, sagt das -- statt einer leeren Warnung. Eine Löschgruppe, die bei
// jedem Abgleich rot und leer dasteht, bringt einem Editor bei, sie zu überblättern; und dann
// überblättert er sie auch bei den Karten, wo wirklich etwas verschwindet.
const advPlan = planWith({
	kind: "adventure",
	run: { id: 9, state: "open", created_at: "2026-08-06 22:00:00", source_stamp: "",
		counts: { new: 0, changed: 1, deleted: 0, total: 1 } },
	items: {
		new: [],
		changed: [{ id: 11, entity_key: "die-sieben-gezeichneten", change_type: "changed",
			label: "Die Sieben Gezeichneten", before: { genre: "Reise" },
			after: { genre: "Intrige", places_removed: 3 }, override: { series: "Eigene Reihe" },
			selected: true, skipped_count: 0, last_skipped_at: "" }],
		deleted: [],
	},
});
const advHtml = markup(advPlan);
assert.ok(advHtml.includes("löscht nichts"), "die Löschgruppe sagt, dass dieser Abgleich nicht löscht");
assert.ok(advHtml.includes("Abenteuer aus dem Wiki übernehmen"), "und der Kopf nennt die Art");
assert.ok(!advHtml.includes("lässt sich nicht rückgängig machen"),
	"und droht nicht mit etwas, das gar nicht passiert");

// Die Felder der Abenteuer sind deutsch beschriftet, samt der vier, die kein Feld der Zeile sind.
["title", "product_type", "edition", "genre", "complexity_gm", "complexity_pl", "authors", "series",
	"fshop_code", "cover_url", "wiki_url", "cover", "adopt", "places", "places_removed"].forEach((field) => {
	const label = fieldLabel(field);
	assert.notStrictEqual(label, field, `${field} hat eine deutsche Beschriftung`);
	assert.ok(label.length > 0, `${field} ist nicht leer beschriftet`);
});

// 💣 Ein Verlust in einer VORANGEHÄKELTEN Zeile braucht seine eigene Farbe. „Orte entfallen: 3"
// zwischen sechs harmlosen Zeilen ist genau die Zeile, die man überliest -- und dass sie auffällt, ist
// die Bedingung, unter der ein Kindzeilen-Verlust überhaupt unter „Geändert" stehen darf.
assert.ok(advHtml.includes("diff__loss"), "das Verlustfeld ist als solches gekennzeichnet");
assert.ok(advHtml.includes("Orte entfallen"), "und es ist benannt, nicht in eine Aufzählung gemischt");
assert.ok(!advHtml.includes('class="old">3'), "ein Verlust hat kein durchgestrichenes Vorher");
// Der Feld-Override steht als „bleibt", nicht als Änderung -- Abenteuer sind die erste Art mit
// Overrides je Feld (field_origins_json).
assert.ok(advHtml.includes("bleibt „Eigene Reihe"), "ein von Hand gesetztes Feld bleibt stehen");
assert.ok(!advHtml.includes('class="new">Eigene Reihe'), "und wird nicht als Änderung vorgeschlagen");

// ---- Publikationsquellen: der Verlust nennt Namen ----------------------------------------------
//
// 💣 „3 entfallen" ist keine Grundlage für ein Häkchen. Die Namen gehören IN die Zeile des
// Verlustfeldes, nicht in eine eigene darunter -- sonst steht die Zahl in der einen Zeile und die
// Namen in der nächsten, ohne dass etwas sie verbindet.
const pubPlan = planWith({
	kind: "publication",
	run: { id: 12, state: "open", created_at: "2026-08-06 23:10:00", source_stamp: "",
		counts: { new: 0, changed: 1, deleted: 0, total: 1 } },
	items: {
		new: [],
		changed: [{ id: 31, entity_key: "settlement|havena", change_type: "changed",
			label: "Havena (Ort)", before: {},
			after: { sources: "2 neu (Havena – Stadt der Diebe)", sources_removed: 3,
				sources_removed_titles: "Alte Quelle, Bote 12" },
			override: {}, selected: true, skipped_count: 0, last_skipped_at: "" }],
		deleted: [],
	},
});
const pubHtml = markup(pubPlan);
assert.ok(pubHtml.includes("Quellenverweise entfallen"), "der Verlust ist benannt");
assert.ok(pubHtml.includes("Alte Quelle, Bote 12"), "und die Namen stehen dabei");
const lossDd = pubHtml.slice(pubHtml.indexOf('class="diff__loss"'));
assert.ok(lossDd.slice(0, lossDd.indexOf("</dd>")).includes("Alte Quelle"),
	"die Namen stehen IN der Zeile des Verlustfeldes");
assert.ok(!pubHtml.includes("<dt>davon</dt>"), "und nicht als eigene Zeile daneben");
assert.ok(pubHtml.includes("löscht nichts"), "auch dieser Abgleich löscht keine Einheit");

// ---- Vorkommen: stillgelegt, nicht gelöscht ----------------------------------------------------
//
// 💣 Der Grabstein muss sagen, was er ist. „Löschen" wäre hier falsch und teuer falsch: der Eintrag
// bleibt samt Vorkommen und Quellen stehen, und nennt das Wiki ihn wieder, wird er von selbst wieder
// aktiv. Eine Warnung, die mehr behauptet als passiert, wird beim zweiten Mal weggeklickt -- und dann
// auch bei den Karten, wo sie stimmt (Entwurf §7).
const loreGate = footer({ selected: 47, deletions: 46, confirmed: false, kind: "lore" });
assert.ok(loreGate.gateText.includes("stilllegen"), "die zweite Bestätigung nennt die Handlung richtig");
assert.ok(!loreGate.gateText.includes("löschen"), "und nicht die falsche");
assert.ok(!loreGate.gateText.includes("nicht rückgängig"), "und droht nicht mit Endgültigkeit");
assert.strictEqual(loreGate.applyDisabled, true, "der Riegel gilt trotzdem: es ist eine Handlung");
assert.ok(footer({ selected: 47, deletions: 46, confirmed: true, kind: "lore" }).applyLabel.includes("stilllegen"),
	"und der Knopf sagt, was er tut");
// Bei den Karten bleibt es beim Löschen -- das eine Wort ist der ganze Unterschied.
assert.ok(footer({ selected: 2, deletions: 1, confirmed: true, kind: "citymap" }).gateText.includes("löschen"));
assert.ok(footer({ selected: 2, deletions: 1, confirmed: true, kind: "citymap" }).gateText.includes("nicht rückgängig"));

const lorePlan = planWith({
	kind: "lore",
	declined_count: 2,
	run: { id: 13, state: "open", created_at: "2026-08-06 23:40:00", source_stamp: "",
		counts: { new: 0, changed: 1, deleted: 1, total: 2 } },
	items: {
		new: [],
		changed: [{ id: 41, entity_key: "wirselkraut", change_type: "changed", label: "Wirselkraut",
			before: { lebensraum: "Sümpfe" },
			after: { lebensraum: "Wälder", occurrences: "2 neu", occurrences_removed: 4 },
			override: { occurrences: "3 unterdrückte bleiben unterdrückt" },
			selected: true, skipped_count: 0, last_skipped_at: "" }],
		deleted: [{ id: 42, entity_key: "donf", change_type: "deleted", label: "Donf",
			before: { kept_place_count: 7, kept_source_count: 2 }, after: {}, override: {},
			selected: false, skipped_count: 0, last_skipped_at: "" }],
	},
});
const loreHtml = markup(lorePlan);
assert.ok(loreHtml.includes("stillgelegt"), "die Löschgruppe nennt die Stilllegung");
assert.ok(loreHtml.includes("wieder aktiv"), "und die Rücknahme, die von selbst passiert");
assert.ok(loreHtml.includes("Vorkommen entfallen"), "der echte Verlust steht in der Geändert-Zeile");
assert.ok(loreHtml.includes("3 unterdrückte"), "und ein unterdrückter Ort bleibt unterdrückt");
// Die Zeile einer Stilllegung nennt, was ERHALTEN bleibt -- das Gegenteil einer Löschzeile.
assert.ok(loreHtml.includes("7 Vorkommen") && loreHtml.includes("bleiben"),
	"die Stilllegungszeile sagt, was erhalten bleibt");
assert.ok(!loreHtml.includes("verschwinden 7"), "und behauptet keinen Verlust");
// Auch der Rückblick nennt die Handlung richtig: abgelehnt wurden Stilllegungen, keine Löschungen.
assert.ok(loreHtml.includes("abgelehnte Stilllegungen"), "der Verweis auf Abgelehntes nennt die Handlung");
assert.ok(markup(planWith({ declined_count: 3 })).includes("abgelehnte Löschungen"),
	"bei den Karten bleibt es dabei");

// ---- Der austauschbare Sender (Sitzung 3) ------------------------------------------------------
//
// 🔴 Das Blatt darf seine Zeilen aus einer ZWEITEN Quelle beziehen — Sitzung 4 braucht das, weil die
// Territorien ihre Unterschiede längst als neu / verschwunden / geändert rechnen. Geprüft wird
// beides: dass die reine Wahl den eingereichten Sender nimmt, UND dass im Rumpf niemand am Sender
// vorbei den Standard ruft. Nur das erste zu prüfen hieße, eine Hülle für offen zu erklären, deren
// Naht an vier Stellen weiterhin festgeschweißt ist.
const resolvePost = sandbox.syncPlanResolvePost;
assert.strictEqual(typeof resolvePost, "function", "die reine Wahl ist geladen");
assert.strictEqual(typeof sandbox.syncPlanDefaultPost, "function", "und der Standardsender auch");

const ownPost = async () => ({ ok: true });
assert.strictEqual(resolvePost({ post: ownPost }), ownPost, "ein eingereichter Sender gewinnt");
assert.strictEqual(resolvePost({}), sandbox.syncPlanDefaultPost, "ohne Angabe gilt der Standard");
assert.strictEqual(resolvePost(null), sandbox.syncPlanDefaultPost, "und auch ganz ohne options");
assert.strictEqual(resolvePost({ post: "nein" }), sandbox.syncPlanDefaultPost,
	"was keine Funktion ist, ist kein Sender");

// 💣 Presence is not execution: erst die Kommentare weg, sonst zertifiziert der Test die Doku —
// dieser Block hier nennt den Standardsender schließlich selbst mehrfach.
const body = source
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split("\n")
	.filter((line) => !/^\s*\/\//.test(line))
	.join("\n");

assert.strictEqual((body.match(/syncPlanDefaultPost/g) || []).length, 2,
	"genau zwei Nennungen: die Definition und der EINE Rückfall in syncPlanResolvePost. Jede weitere "
	+ "ist ein Aufruf am eingereichten Sender vorbei.");

// Und jeder Sendeaufruf trägt seinen Sender als erstes Argument.
//
// ⚠️ Die zweite Zusicherung ist die tragende: ein zurückgefallenes `syncPlanPost({ action: … })`
// beginnt mit einer Klammer und würde vom Bezeichner-Muster gar nicht erst erfasst — es fiele
// stillschweigend aus der Prüfung, statt sie rot zu machen. Deshalb müssen beide Zählungen gleich sein.
const sends = body.match(/syncPlanPost\(\s*[A-Za-z_$][\w$.]*/g) || [];
const allCalls = body.match(/syncPlanPost\(/g) || [];
assert.ok(sends.length >= 6, `alle Sendestellen gefunden (${sends.length})`);
assert.strictEqual(sends.length, allCalls.length,
	"jeder syncPlanPost-Aufruf beginnt mit einem Bezeichner — ein Objektliteral heißt: der Sender fehlt");
sends.forEach((call) => {
	assert.ok(/syncPlanPost\(\s*post\b/.test(call),
		`syncPlanPost ohne Sender als erstes Argument: ${call}`);
});

// --- Sitzung 4: die zwei Territorien-Arten ---------------------------------------------------------

assert.equal(sandbox.syncPlanKindMeta("territory_wiki").title, "Die Wiki-Kopie der Herrschaftsgebiete nachführen");
assert.equal(sandbox.syncPlanKindMeta("territory").deletion, null, "die Karte löscht nie");
assert.equal(sandbox.syncPlanKindMeta("territory_wiki").nouns.many, "Kopien");

// 💣 Der Satz der leeren Löschgruppe gehört der ART. Der fest verdrahtete Satz („steht als Verlust in
// der Zeile des Eintrags") stimmt für die Karte nicht -- dort steht es in der Vorschau von „Syncen".
const emptyDeleted = sandbox.syncPlanGroupMarkup({ key: "deleted", name: "Gelöscht", hint: "x" }, [], 0, 0, "territory");
assert.ok(emptyDeleted.includes("Verwaiste Kopien"), "die Karte sagt, wo die verschwundenen stehen");
assert.ok(!emptyDeleted.includes("in der Zeile des Eintrags"), "und nicht den Satz der anderen Arten");

assert.equal(sandbox.syncPlanFieldLabel("valid_to_bf"), "Aufgelöst");
assert.equal(sandbox.syncPlanFieldLabel("parent"), "Eltern");
assert.equal(sandbox.syncPlanFieldLabel("ruler"), "Oberhaupt");

// Der Warnblock ist keine Änderung: kein „alt → neu", eigene Form.
const noted = sandbox.syncPlanDiffMarkup({
    change_type: "changed",
    before: { parent: "Grafschaft Ragath" },
    after: { parent: "Fürstentum Almada", boundary_note: "Grafschaft Ragath verliert ihr letztes Kind." },
});
assert.ok(noted.includes("diff__note"), "der Hinweis bekommt seine eigene Form");
assert.ok(noted.includes("Grafschaft Ragath verliert ihr letztes Kind."));
assert.ok(!noted.includes("<dt>Außengrenzen</dt>"), "und steht nicht als Feldname in der Pfeilliste");

// pin_fields informiert die Zeile und erscheint nie als Unterschied.
const pinned = sandbox.syncPlanRowMarkup({
    id: 7, label: "Baronie Hügelsee", change_type: "changed",
    before: { name: "Baronie Hügelsee am Großen Fluss" },
    after: { name: "Baronie Hügelsee", pin_fields: "name" },
}, "territory");
assert.ok(pinned.includes('data-pin="7"'), "die Zeile bietet „Werte festhalten\"");
assert.ok(!pinned.includes("<dt>weitere Felder</dt>") && !pinned.includes("pin_fields"), "aber nennt das Pseudo-Feld nie");

const unpinned = sandbox.syncPlanRowMarkup({
    id: 8, label: "Mark Ragathsquell", change_type: "changed",
    before: { parent: "A" }, after: { parent: "B" },
}, "territory");
assert.ok(!unpinned.includes("data-pin"), "eine reine Eltern-Zeile hat nichts festzuhalten");

// 💣 Die Löschgruppe muss sagen, was sie NICHT anbietet. Bei den Kopien sind das die, an denen ein
// Kartengebiet hängt -- eine Zahl, die man nicht sieht, liest sich als „alles erledigt".
// ⚠️ Der Gebietsname trägt hier bewusst ein HTML-signifikantes Zeichen: `extraLead` kommt vom Server
// und wird escaped -- ein Fixture ohne so ein Zeichen ließe die Zusicherung grün bleiben, ob escaped
// wird oder nicht, und würde genau die Regression durchlassen, vor der der Brief warnt.
const withProtected = sandbox.syncPlanGroupMarkup(
    { key: "deleted", name: "Gelöscht", hint: "x" },
    [{ id: 1, label: "Baronie Alt-Gareth", change_type: "deleted", before: {}, after: {} }],
    1, 0, "territory_wiki",
    "Fünf weitere Kopien hängen an einem Gebiet (Grafschaft <Wehrsold>, …) und werden nicht angeboten."
);
assert.ok(withProtected.includes("Grafschaft &lt;Wehrsold&gt;"), "der Servertext wird escaped -- er trägt Wiki-Namen");
assert.ok(!withProtected.includes("<Wehrsold>"), "und kommt nie roh in die Seite");
assert.ok(withProtected.includes("kein</b> Gebiet auf der Karte"), "und der feste Satz der Art auch");
const withoutProtected = sandbox.syncPlanGroupMarkup(
    { key: "deleted", name: "Gelöscht", hint: "x" },
    [{ id: 1, label: "X", change_type: "deleted", before: {}, after: {} }],
    1, 0, "territory_wiki", ""
);
assert.ok(!withoutProtected.includes("werden nicht angeboten"), "ohne geschützte kein leerer Satz");

// 💣 UND GENAU DANN, WENN NICHTS ANGEBOTEN WIRD. Alle Löschungen abgelehnt oder gar keine verwaist:
// die Gruppe zeigt „Gelöscht 0 · Nichts." -- und liest sich als „alles erledigt", während N Kopien
// verwaist und nur deshalb geschützt sind, weil ein Kartengebiet an ihnen hängt. Der bisherige Test
// gab in beiden Fällen total = 1 und sah diesen Fall deshalb nie.
const protectedButEmpty = sandbox.syncPlanGroupMarkup(
    { key: "deleted", name: "Gelöscht", hint: "x" }, [], 0, 0, "territory_wiki",
    "Fünf weitere Kopien hängen an einem Gebiet (Grafschaft Wehrsold) und werden nicht angeboten."
);
assert.ok(protectedButEmpty.includes("werden nicht angeboten"),
    "💣 der Satz über die geschützten Kopien steht auch bei null angebotenen Zeilen");
assert.ok(protectedButEmpty.includes("Nichts."), "die leere Gruppe sagt trotzdem, dass sie leer ist");
assert.ok(!protectedButEmpty.includes("Was du <b>nicht</b> anhäkelst"),
    "aber der Satz über das Anhäkeln schweigt -- es gibt nichts anzuhäkeln");
assert.ok(!protectedButEmpty.includes(">​<br>") && !/>\s*<br>/.test(protectedButEmpty),
    "und der Vorspann beginnt nicht mit einem leeren Umbruch");

// „+ 7 weitere Felder" ist der Rest einer gedeckelten Liste, kein Vergleich mit einem erfundenen
// Vorher -- sonst stünde da „weitere Felder: — → 7", was niemandem etwas sagt.
const capped = sandbox.syncPlanDiffMarkup({
    change_type: "changed", before: { name: "A" }, after: { name: "B", fields_more: "7" },
});
assert.ok(capped.includes("+ 7 weitere Felder"), "der Rest einer gedeckelten Liste steht als Satz da");
assert.ok(!capped.includes("<dt>weitere Felder</dt>"), "nicht als Vergleich mit einem erfundenen Vorher");

// --- hand_edited: der Gegenpart zu pin_fields (Owner-Nachtrag) ----------------------------------
//
// 💣 Kein geratener Verdacht: der Server leitet das nur aus dem eigenen Schreib-Schnappschuss ab, und
// nur für die fünf Felder, die der Schnappschuss führt (name, type, status, valid_from_bf,
// valid_to_bf) -- `continent` kann hier nie stehen. Fehlt das Feld, ist nichts beweisbar, also steht
// auch nichts an der Zeile: Schweigen ist hier eine Aussage.
const handEditedRow = sandbox.syncPlanRowMarkup({
    id: 15, label: "Baronie Hügelsee", change_type: "changed",
    before: { name: "Baronie Hügelsee am Großen Fluss" },
    after: { name: "Baronie Hügelsee", hand_edited: "name,status" },
}, "territory");
assert.ok(handEditedRow.includes('class="tag tag--handedit"'), "die Zeile trägt die Marke mit ihrer eigenen Klasse");
assert.ok(handEditedRow.includes("von Hand geändert"), "und ihrem deutschen Text");

const noHandEditedRow = sandbox.syncPlanRowMarkup({
    id: 16, label: "Mark Ragathsquell", change_type: "changed",
    before: { parent: "A" }, after: { parent: "B" },
}, "territory");
assert.ok(!noHandEditedRow.includes("tag--handedit"), "ohne hand_edited keine Marke");

// Das Silent-Feld-Verhalten: nie in der Vergleichsliste, nie als roher Schlüssel -- wie bei pin_fields.
assert.ok(!handEditedRow.includes("hand_edited"),
    "das Pseudo-Feld erscheint nirgends als roher Schlüssel");
const handEditedDiff = sandbox.syncPlanDiffMarkup({
    change_type: "changed", before: {}, after: { hand_edited: "name" },
});
assert.ok(!handEditedDiff.includes("hand_edited") && !handEditedDiff.includes("<dt>"),
    "hand_edited erscheint auch für sich genommen nie als Zeile der Unterschiedsliste");

// Beide Marken zusammen: ein Override UND eine Vor-Ort-Änderung schließen sich nicht aus.
const bothTagsRow = sandbox.syncPlanRowMarkup({
    id: 17, label: "Markgrafschaft Sonnenmark", change_type: "changed",
    before: { valid_from_bf: null }, after: { valid_from_bf: "720 BF", hand_edited: "valid_from_bf" },
    override: { name: "Eigener Name" },
}, "territory");
assert.ok(bothTagsRow.includes("tag--handedit") && bothTagsRow.includes("tag--own"),
    "eine Zeile kann beide Marken zugleich tragen");

// --- Eine NEUE Zeile ist gedeckelt (Gesamtprüfung 2026-08-07) ------------------------------------
//
// 💣 Eine neue Wiki-Kopie eines Herrschaftsgebiets bringt gut dreißig Felder mit. Ungedeckelt stand
// die ganze Zeile als eine Textwurst da -- samt JSON-Klumpen und samt der Pseudo-Felder, die überall
// sonst stumm sind. Dieselbe Sechs wie im Vergleich, und der Rest wird gezählt statt verschwiegen.
const bigNew = sandbox.syncPlanNewSummary({
    change_type: "new",
    after: {
        name: "Baronie Hügelsee", type: "Baronie", continent: "Aventurien",
        affiliation_raw: "Kosch", affiliation_key: "wiki:kosch", affiliation_root: "Mittelreich",
        affiliation_path_json: '["Mittelreich","Kosch"]', status: "aktiv", ruler: "Baron X",
        capital_name: "Hügelsee", language: "Garethi",
        pin_fields: "name,type", hand_edited: "name",
    },
});
assert.ok(bigNew.includes("Name: Baronie Hügelsee"), "die ersten Felder stehen ausgeschrieben da");
assert.ok(bigNew.includes("+ 5 weitere Felder"), "💣 gedeckelt bei sechs, die restlichen fünf werden gezählt");
assert.ok(!bigNew.includes("Sprache") && !bigNew.includes("affiliation_path_json"),
    "ab dem siebten Feld steht nichts mehr einzeln da -- auch kein JSON-Klumpen");
assert.ok(!bigNew.includes("pin_fields") && !bigNew.includes("hand_edited"),
    "💣 die stummen Pseudo-Felder erscheinen auch hier nicht -- und zählen nicht mit");
assert.strictEqual((bigNew.match(/ · /g) || []).length, 6, "sechs Felder plus der Restzähler");

// Eine kurze neue Zeile bleibt, was sie war: keine Zahl, kein Rest.
const smallNew = sandbox.syncPlanNewSummary({ change_type: "new", after: { title: "Elenvina", art: "stadtplan" } });
assert.ok(smallNew.includes("Titel: Elenvina") && !smallNew.includes("weitere Felder"));
// Was der Server schon abgeschnitten hat, zählt mit -- sonst behauptet „+ 1 weitere" Vollständigkeit.
const serverCapped = sandbox.syncPlanNewSummary({ change_type: "new", after: { name: "X", fields_more: "24" } });
assert.ok(serverCapped.includes("+ 24 weitere Felder"), "der serverseitige Rest wird übernommen");
assert.ok(!serverCapped.includes("fields_more"), "und nicht als rohes Feld gezeigt");

// --- „Werte festhalten": gelungen = tot, misslungen = klickbar -----------------------------------
//
// 💣 Bis 2026-08-07 stand es andersherum: unter „ging nicht — bitte erneut" war der Knopf gesperrt,
// nach „festgehalten" lud er zum zweiten Klick ein. Ein Knopf, der genau dann nicht geht, wenn er
// soll, ist schlimmer als keiner.
const pinOk = sandbox.syncPlanPinButtonState(true);
assert.strictEqual(pinOk.text, "festgehalten");
assert.strictEqual(pinOk.disabled, true, "🔴 nach dem Festhalten gibt es nichts mehr zu tun");
const pinFail = sandbox.syncPlanPinButtonState(false);
assert.strictEqual(pinFail.text, "ging nicht — bitte erneut");
assert.strictEqual(pinFail.disabled, false, "🔴 wer 'bitte erneut' liest, muss erneut drücken können");
// Alles, was nicht ausdrücklich true ist, ist ein Fehlschlag -- undefined kommt von einem Aufrufer
// ohne Rückgabewert, und der hat nichts festgehalten.
assert.strictEqual(sandbox.syncPlanPinButtonState(undefined).disabled, false);
assert.strictEqual(sandbox.syncPlanPinButtonState("ja").disabled, false, "eine Zeichenkette ist kein Ja");

// 💣 Und der Zuhörer fängt den Wurf ab. Der Sender antwortet nicht mit ok:false, er WIRFT -- in einem
// async-Zuhörer ohne try/catch verlässt die Ablehnung die Funktion wortlos, und der Knopf bleibt für
// immer gesperrt und beschriftet, als liefe er noch.
const pinListener = body.slice(body.indexOf('sheet.querySelectorAll("[data-pin]")'));
const pinBody = pinListener.slice(0, pinListener.indexOf("const declinedButton"));
assert.ok(/try\s*\{[\s\S]*await options\.onPin\([\s\S]*?\}\s*catch/.test(pinBody),
    "💣 der await auf onPin steht in einem try/catch");
assert.ok(pinBody.includes("syncPlanPinButtonState("),
    "und die Beschriftung kommt aus der reinen Funktion, nicht aus einer zweiten Kopie der Regel");

// --- Der leere Fall nennt den Knopf DIESER Art ---------------------------------------------------
//
// „Erst Karten syncen" schickt im Territorien-Monitor jemanden nach einem Knopf suchen, den es dort
// nicht gibt: die Kachel heißt „1 · 🚨 Syncen".
assert.ok(kindMeta("territory_wiki").emptyHint.includes("1 · 🚨 Syncen"), "die Kopie nennt ihre Kachel");
assert.ok(kindMeta("citymap").emptyHint.includes("Karten syncen"), "die Karten ihre");
assert.ok(kindMeta("lore").emptyHint.includes("Vorkommen syncen"), "die Vorkommen ihre");
assert.ok(kindMeta("wurstsalat").emptyHint.length > 0, "und eine unbekannte Art bleibt nicht stumm");
assert.ok(!kindMeta("wurstsalat").emptyHint.includes("Karten"), "sie behauptet aber keinen fremden Knopf");
assert.strictEqual((body.match(/Karten syncen/g) || []).length, 1,
    "der Kartenknopf wird genau EINMAL genannt: in der Tabelle. Jede weitere Nennung ist der fest "
    + "verdrahtete Satz, der gerade abgeschafft wurde.");

// --- parent_key ist stumm (Nachprüfung 2026-08-07) ------------------------------------------------
//
// 💣 Die Planzeile trägt neben dem Elternnamen den SCHLÜSSEL, damit die Übernahme prüfen kann, ob der
// Baum sich seit der Vorschau bewegt hat — Namen sind in diesem Bestand keine Schlüssel. Für den Leser
// wäre er eine zweite, rohe Fassung derselben Zeile.
const parentRow = sandbox.syncPlanRowMarkup({
    id: 21, label: "Baronie Hügelsee", change_type: "changed",
    before: { parent: "Grafschaft Ragath" },
    after: { parent: "Fürstentum Almada", parent_key: "wiki:f-rstentum-almada" },
}, "territory");
assert.ok(parentRow.includes("Fürstentum Almada"), "der Name steht da");
assert.ok(!parentRow.includes("parent_key") && !parentRow.includes("wiki:f-rstentum-almada"),
    "💣 der Schlüssel nirgends — weder als Feldname noch als Wert");
const parentDiff = sandbox.syncPlanDiffMarkup({
    change_type: "changed", before: {}, after: { parent_key: "wiki:x" },
});
assert.ok(!parentDiff.includes("parent_key") && !parentDiff.includes("<dt>"),
    "auch für sich genommen erzeugt er keine Zeile");
// Und in einer NEUEN Zeile zählt er nicht als „weiteres Feld" mit.
const newWithKey = sandbox.syncPlanNewSummary({ change_type: "new", after: { parent: "(Wurzel)", parent_key: "" } });
assert.ok(newWithKey.includes("Eltern: (Wurzel)") && !newWithKey.includes("weitere Felder"),
    "eine neue Zeile zählt das stumme Feld nicht mit");

// Ein Feld, das der Deckel durchlässt, braucht eine deutsche Beschriftung -- sonst steht der rohe
// Spaltenname in der Zeile, und „affiliation_key" ist eins der ersten sechs.
assert.strictEqual(fieldLabel("affiliation_key"), "Zugehörigkeit (Schlüssel)");

console.log("sync-plan-sheet ok");
