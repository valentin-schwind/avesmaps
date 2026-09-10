// DIE ART EINER BESCHRIFTUNG FOLGT IHRER FLAECHE -- ausgefuehrt, nicht gelesen.
//
// 🔴 DER BEFUND (Owner 10.09.2026): „Wenn man ein Label einer Flaeche dupliziert wird das
// Style/Theme aus der Kategorie nicht mit uebernommen. Erst wenn ich die Flaechenkategorie 2x
// aender zeichnet er beide korrekt."
//
// 💣 DIE KOPIE WAR NIE DAS PROBLEM -- gemessen, bevor etwas gebaut wurde: `duplicateLabelEntry`
// reicht `entry.label.labelType` sauber durch (Sonde gegen den echten Funktionsrumpf), und an der
// Live-Nutzlast vom 10.09.2026 trug KEINE der 10 Flaechen mit mehreren Beschriftungen eine
// uneinheitliche Art. Falsch war das ORIGINAL: live liegen fuenf Beschriftungen an einer Flaeche,
// deren Ebene ihre Art gar nicht kennt -- „Ogerbusch" und „Wehrheimer Forst" tragen `region`
// („keine Art", also weiss und 18pt), waehrend ihre Flaeche `wald` ist (Gruenton, 15pt). Die Kopie
// erbte den Fehler, und „2x aendern" heilte BEIDE, weil
// `avesmapsEcosystemPushRegionTypeToLabels` an allen Beschriftungen der Flaeche schreibt.
//
// 🔴 DIE FLAECHE IST DIE WAHRHEIT FUER DIE ART (Owner 02.09.2026: „zieh die art der flaeche an die
// beschriftung nach"). Dieser Test nagelt das am Duplizieren fest -- dem einen Erzeuger, fuer den
// ein Fehlerpfad wirklich BELEGT ist.
//
// 🪤 ZWEI WEITERE VERDAECHTIGE WURDEN GEPRUEFT UND FREIGESPROCHEN; sie stehen hier, damit der
// naechste Leser nicht dieselbe Faehrte noch einmal laeuft:
//   * Der Territorien-Import uebergibt fest `""` (map-features-ecosystem-territory-import.js). Das
//     sieht nach derselben Luecke aus, ist aber richtig: er legt seine Flaeche zwei Zeilen darueber
//     ausdruecklich mit `region_type: ""` an -- es GIBT zu diesem Zeitpunkt keine Art. Sie kommt im
//     Eigenschaften-Dialog, und der zieht die Beschriftung dann ueber `update_region` nach.
//   * `avesmapsCreateEcosystemRegion` ruft `avesmapsEcosystemPushRegionTypeToLabels` nicht, obwohl
//     `avesmapsUpdateEcosystemRegion` es tut -- ein Erzeuger von zweien. Der einzige Aufrufer, der
//     dort ueberhaupt ein `label_public_id` mitschickt (der Garetien-Import,
//     garetien-uebernahme.php), setzt am Label denselben Subtyp, den er der Flaeche gibt. Kein
//     erreichbarer Fehlerpfad, also keine Aenderung -- wer je einen findet, hat hier die Stelle.
//
// ⚠️ map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an).
// Geschnitten wird deshalb genau die eine Funktion -- dasselbe Vorgehen wie in
// label-position-zuruecksetzen.test.js, und mit derselben Ehrlichkeit: Abschnitt 1 misst diese eine.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/label-art-folgt-der-flaeche.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");

// 💣 ZEILENENDEN VEREINHEITLICHEN. Das Repo steht unter `text=auto`: hier CRLF, im Deploy-Tor LF.
// Ein Test, der auf "\r\n" sucht, ist auf diesem Rechner gruen und in der CI rot (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8").replace(/\r\n/g, "\n");

// Eine benannte Funktion samt allem, was zwischen ihrem Kopf und ihrer schliessenden Klammer steht.
// 💣 `async` gehoert dazu: der Schnitt beginnt bei `function <name>(`, und ohne das vorangestellte
// Wort wirft `new Function` beim ersten `await` einen SyntaxError -- beim Bau dieses Tests passiert.
function schneide(quelle, name, istAsync) {
	const marke = quelle.indexOf("function " + name + "(");
	assert.ok(marke >= 0, `${name} steht in der Quelle`);
	const bis = quelle.indexOf("\n}", marke);
	assert.ok(bis > marke, `${name} hat ein Ende`);
	return (istAsync ? "async " : "") + quelle.slice(marke, bis + 2);
}

// ---- 1. Das Duplizieren nimmt die Art der FLAECHE ------------------------------------------------
//
// Die Fixture ist der Livefall „Ogerbusch": Flaeche `wald`, Beschriftung `region`. Wer hier die Art
// des Originals kopiert, bekommt eine zweite weisse Beschriftung auf einer gruenen Waldflaeche.
const labelsQuelle = lies("js", "map-features", "map-features-labels.js");

function fahreDuplizieren({ labelArt, flaechenArt }) {
	let gesendet = null;
	const umgebung = {
		showFeedbackToast: () => {},
		map: {
			layerPointToLatLng: (p) => ({ lat: p.y, lng: p.x }),
			latLngToLayerPoint: (ll) => ({ x: ll.lng, y: ll.lat, add: ([dx, dy]) => ({ x: ll.lng + dx, y: ll.lat + dy }) }),
		},
		measureLabelCollisionRect: () => ({ height: 40 }),
		loadEcosystemRegions: async () => {},
		ECOSYSTEM_KINDS: ["derographisch", "vegetation", "topographie", "klima"],
		ecosystemRegionOfLabel: () => (flaechenArt === null ? null : {
			public_id: "REGION-1",
			kind: "vegetation",
			region_type: flaechenArt,
			wiki_region_key: "",
			wiki_url: "",
		}),
		ecosystemWikiRegionSnapshot: async () => null,
		submitMapFeatureEdit: async (payload) => {
			gesendet = payload;
			return { feature: { type: "Feature", id: "NEU-1", properties: { ...payload, public_id: "NEU-1" } }, revision: 99 };
		},
		addCreatedLabelFeature: (feature) => ({ label: feature.properties }),
		updateRevisionFromEditResponse: () => {},
		loadChangeLog: () => {},
		pendingLabelMoveAfterEditEntry: null,
		openLabelEditDialog: () => {},
		console: { error: () => {}, warn: () => {} },
	};
	const namen = Object.keys(umgebung);
	const fn = new Function(
		...namen,
		schneide(labelsQuelle, "duplicateLabelEntry", true) + "; return duplicateLabelEntry;"
	)(...namen.map((n) => umgebung[n]));

	return fn({
		marker: { getLatLng: () => ({ lat: 100, lng: 200 }), getElement: () => ({}), closePopup: () => {} },
		label: {
			publicId: "ALT-1",
			text: "Ogerbusch",
			labelType: labelArt,
			size: 18,
			rotation: 0,
			minZoom: 2,
			maxZoom: 7,
			priority: 3,
			showName: true,
			wikiRegion: null,
			ecosystemRegionPublicId: "REGION-1",
		},
	}).then(() => gesendet);
}

async function abschnitt1() {
	// Der gemeldete Fall: das Original haengt der Flaeche hinterher -- die Kopie darf das nicht erben.
	const gesendet = await fahreDuplizieren({ labelArt: "region", flaechenArt: "wald" });
	assert.strictEqual(
		gesendet.feature_subtype,
		"wald",
		`die Kopie nimmt die Art der Flaeche, nicht die des Originals (gesendet: ${gesendet.feature_subtype})`
	);

	// ⚠️ UND SIE UEBERSCHREIBT NICHTS ANDERES. Groesse, Drehung und Zoomband gehoeren dem einzelnen
	// Label -- ein zweites existiert gerade deshalb, weil es anders stehen soll
	// (map-features-ecosystem-label-writeback.js, Kopf). Die Art ist die eine Ausnahme.
	assert.strictEqual(gesendet.size, 18, "die Groesse des Originals reist mit");
	assert.strictEqual(gesendet.min_zoom, 2, "das Zoomband des Originals reist mit");

	// 🔴 EINE FREIE BESCHRIFTUNG BEHAELT IHRE ART. Ohne Flaeche gibt es keine bessere Quelle, und ein
	// Rueckfall auf „region" naehme einem Gipfel oder Meer seine Art.
	const frei = await fahreDuplizieren({ labelArt: "berggipfel", flaechenArt: null });
	assert.strictEqual(frei.feature_subtype, "berggipfel", "ohne Flaeche gilt die Art des Originals");

	// 🪤 UND EINE FLAECHE OHNE ART DARF KEINE ART LOESCHEN. `region_type` ist an der Flaeche der leere
	// Wert fuer „keine Art"; am Label heisst dasselbe `region`. Eine leere Flaechenart ist also keine
	// Aussage -- wer sie durchreicht, macht aus jedem Waldlabel einer noch untypisierten Flaeche ein
	// namenloses `region`.
	const ohneArt = await fahreDuplizieren({ labelArt: "wald", flaechenArt: "" });
	assert.strictEqual(ohneArt.feature_subtype, "wald", "eine Flaeche ohne Art nimmt der Kopie nichts weg");
}

abschnitt1()
	.then(() => {
		console.log("OK label-art-folgt-der-flaeche");
	})
	.catch((fehler) => {
		console.error(fehler.message);
		process.exit(1);
	});
