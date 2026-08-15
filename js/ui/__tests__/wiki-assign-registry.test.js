// Die Pruefung, die schreit. Sie ist der Grund, warum es KEINE automatische Felder-Erkennung gibt:
// die Zuordnung Wiki-Feld -> Kartenfeld ist nicht ableitbar (Entwurf §3a), also wird sie erklaert --
// und diese Datei sorgt dafuer, dass eine vergessene Erklaerung LAUT ist statt still.
const assert = require("assert");
const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignRegistryProbleme } = require("../wiki-assign-registry.js");

// 1) Das echte Register ist in sich stimmig.
assert.deepStrictEqual(
	avesmapsWikiAssignRegistryProbleme(AVESMAPS_WIKI_ASSIGN_REGISTRY, null),
	[],
	"das ausgelieferte Register meldet Probleme"
);

// 2) Ein erklaertes KARTENFELD, das es bei dieser Objektart nicht gibt.
const erfundenesZiel = {
	ort: { label: "Ort", suche: "/x", treffer: ["art"], sync: true,
		felder: [{ wiki: "name", karte: "gibtesnicht" }] },
};
const p2 = avesmapsWikiAssignRegistryProbleme(erfundenesZiel, { ort: { karte: ["name"], wiki: ["name"] } });
assert.strictEqual(p2.length, 1);
assert.ok(p2[0].includes("gibtesnicht"), p2[0]);

// 3) DAS IST DIE ZEILE, DIE 'VERGESSEN' SICHTBAR MACHT: der Parser liefert ein Wiki-Feld,
//    das KEINE Erklaerung fuer sich beansprucht.
const vergessen = {
	ort: { label: "Ort", suche: "/x", treffer: [], sync: true,
		felder: [{ wiki: "name", karte: "name" }] },
};
const p3 = avesmapsWikiAssignRegistryProbleme(vergessen, { ort: { karte: ["name", "einwohner"], wiki: ["name", "einwohner"] } });
assert.strictEqual(p3.length, 1);
assert.ok(p3[0].includes("einwohner"), p3[0]);

// 4) Eine Objektart ohne Erklaerung.
const p4 = avesmapsWikiAssignRegistryProbleme({}, { ort: { karte: ["name"], wiki: ["name"] } });
assert.strictEqual(p4.length, 1);
assert.ok(p4[0].includes("ort"), p4[0]);

// 5) Jede Erklaerung des echten Registers traegt, was das Bauteil braucht.
Object.entries(AVESMAPS_WIKI_ASSIGN_REGISTRY).forEach(([subject, e]) => {
	assert.ok(typeof e.label === "string" && e.label !== "", subject + ": label fehlt");
	assert.ok(Array.isArray(e.felder), subject + ": felder ist keine Liste");
	assert.ok(typeof e.sync === "boolean", subject + ": sync ist kein Wahrheitswert");
	// 💣 Der Sync-Knopf haengt an den FELDERN, nicht am Abgleich: wer keine bearbeitbaren Felder
	// hat, darf keinen Knopf anbieten -- sonst stuende dort einer, der nichts holen kann.
	const hatZiele = e.felder.some((f) => String(f.karte || "") !== "");
	assert.strictEqual(e.sync, hatZiele, subject + ": sync und Feldziele widersprechen sich");
});

console.log("wiki-assign-registry: alle Zusicherungen erfuellt");
