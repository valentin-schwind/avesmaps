"use strict";
// Die WEG-EBENE als ABLAUF, nicht als Rechnung: den Editor booten, die Weg-Zeile anklicken, die
// Maske zeichnen lassen, etwas aendern, speichern -- und den abgesetzten Rumpf ansehen.
//
// 🔴 WARUM ZUSAETZLICH ZU wege-gruppe-felder.test.js: jener prueft die reinen Teilstuecke und die
// Verdrahtung am Dateitext. Beides bliebe gruen, wenn `renderGroupDetail` beim ersten Zeichnen mit
// einem ReferenceError aussteigt -- und genau das saehe der Editor als leere Spalte, ohne ein Wort
// dazu. „Abnahme heisst ABLAUF, nicht Mass" (AGENTS.md §9).
//
// Vorbild fuer den Sandkasten: js/ui/__tests__/wiki-assign-weg.test.js, Abschnitt 12a.
// Entwurf: docs/superpowers/specs/2026-08-19-wege-editor-weg-ebene-design.md

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

assert.throws(() => assert.equal(1, 2), "assert ist wirkungslos");

const wurzel = path.resolve(__dirname, "..", "..", "..");

/** Ein DOM-Element, so weit der Editor eines braucht. */
function attrappe(name) {
	const el = {
		id: name,
		innerHTML: "",
		textContent: "",
		value: "",
		checked: false,
		indeterminate: false,
		disabled: false,
		hidden: false,
		dataset: {},
		style: {},
		zuhoerer: {},
		children: [],
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(art, fn) { el.zuhoerer[art] = fn; },
		removeEventListener() {},
		setAttribute() {},
		getAttribute() { return null; },
		removeAttribute() {},
		appendChild() {},
		querySelector() { return null; },
		querySelectorAll() { return []; },
		closest() { return null; },
		focus() {},
		feuere(art, ereignis) {
			if (el.zuhoerer[art]) { el.zuhoerer[art](ereignis || { target: el, preventDefault() {} }); }
		}
	};

	return el;
}

function sandkasten(fetchAntwort) {
	const elemente = {};
	const gesendet = [];
	// Die Haken der Fahrtypen: `wireGroupDetail` sammelt sie ueber document.querySelectorAll.
	const transportHaken = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) {
			if (!elemente[id]) { elemente[id] = attrappe(id); }

			return elemente[id];
		},
		querySelector() { return null; },
		querySelectorAll(auswahl) {
			if (String(auswahl) === ".wp-group-transport") { return transportHaken; }

			return [];
		},
		createElement(t) { return attrappe(t); },
		addEventListener() {},
		body: attrappe("body"),
		documentElement: attrappe("html")
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
		encodeURIComponent, decodeURIComponent, Promise, Event: function () {},
		document: dokument,
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: () => true,
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf: rumpf });

			return Promise.resolve({
				ok: true, status: 200,
				json: () => Promise.resolve(fetchAntwort(String(url), rumpf))
			});
		}
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	[
		"js/ui/filter-menu.js", "js/routing/travel-calendar.js", "js/pages/wege-editor-model.js",
		"js/ui/listen-statuskreis.js", "js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js",
		"js/ui/wiki-assign.js", "js/ui/wiki-assign-weg.js"
	].forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});

	return { kasten, elemente, gesendet, transportHaken };
}

/** Drei Abschnitte EINES Weges -- zwei Gebirgspass, einer Pfad, die Kutsche nur bei einem. */
function wegeAntwort() {
	const segment = (id, subtype, transporte) => ({
		public_id: id, name: "Schattenbachpass", feature_subtype: subtype,
		show_label: false, allowed_transports: transporte, transport_seasons: {},
		wiki_path: { wiki_key: "wiki:schattenbachpass", wiki_url: "https://example.invalid", name: "Schattenbachpass", art: "Pass" },
		flow_direction: "", has_profile: true,
		bbox: [10, 10, 12, 12]
	});

	return {
		ok: true,
		ways: [
			segment("11111111-1111-4111-8111-111111111111", "Gebirgspass", ["groupFoot", "lightWalker"]),
			segment("22222222-2222-4222-8222-222222222222", "Gebirgspass", ["groupFoot", "lightWalker", "horseCarriage"]),
			segment("33333333-3333-4333-8333-333333333333", "Pfad", ["groupFoot", "lightWalker"])
		],
		summary: { total: 3, with_profile: 3 },
		calibration: null
	};
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 20));

(async () => {
	let checks = 0;
	const s = sandkasten((url) => {
		if (url.indexOf("action=list") !== -1) { return wegeAntwort(); }
		if (url.indexOf("action=group_detail") !== -1) {
			return {
				ok: true, capped: false, requested: 3,
				segments: [
					{ ok: true, public_id: "11111111-1111-4111-8111-111111111111", feature_subtype: "Gebirgspass",
					  length_units: 8, piece_lengths: [4, 4], ends: { from: [10, 10], to: [12, 12] },
					  terrain: { ascent: 200, descent: 20, profile: [[100, 10, 0, 0], [100, 10, 0, 0]], stale_geometry: false } },
					{ ok: true, public_id: "22222222-2222-4222-8222-222222222222", feature_subtype: "Gebirgspass",
					  length_units: 6, piece_lengths: [6], ends: { from: [12, 12], to: [15, 15] },
					  terrain: { ascent: 60, descent: 300, profile: [[60, 300, 0, 90]], stale_geometry: false } },
					{ ok: true, public_id: "33333333-3333-4333-8333-333333333333", feature_subtype: "Pfad",
					  length_units: 4, piece_lengths: [4], ends: { from: [15, 15], to: [17, 17] },
					  terrain: null }
				]
			};
		}

		if (url.indexOf("action=detail") !== -1) {
			return {
				ok: true, public_id: "11111111-1111-4111-8111-111111111111",
				feature_subtype: "Gebirgspass", length_units: 8, piece_lengths: [4, 4],
				terrain: { ascent: 200, descent: 20, profile: [[100, 10, 0, 0], [100, 10, 0, 0]], stale_geometry: false },
				landscapes: []
			};
		}

		return { ok: true, written: 3, skipped: 0, revision: 99 };
	});
	vm.runInContext(fs.readFileSync(path.join(wurzel, "js/pages/wege-editor.js"), "utf8"), s.kasten,
		{ filename: "wege-editor.js" });
	await ruhe();

	// ── 1) Die Gruppenzeile antworten lassen ──────────────────────────────────────────────────
	const liste = s.elemente.wpList;
	assert.ok(liste && liste.zuhoerer.click, "der Editor haengt keinen Klickzuhoerer an die Liste");
	checks += 1;

	// Die Zeile, wie sie im Dokument stuende: sie traegt `data-group`, aber der Klick liegt NICHT
	// auf dem Aufklapp-Pfeil.
	const gruppenZeile = attrappe("row");
	gruppenZeile.getAttribute = (n) => (n === "data-group" ? "wiki:wiki:schattenbachpass" : null);
	const zielZeile = { closest: (sel) => (sel === ".avm-row" ? gruppenZeile : null) };
	liste.zuhoerer.click({ target: zielZeile, preventDefault() {} });
	await ruhe();

	const maske = s.elemente.wpDetail.innerHTML;
	assert.ok(maske.indexOf("Ganzer Weg") !== -1,
		"die Weg-Ebene zeichnet nicht -- die Spalte zeigt: " + maske.slice(0, 200));
	assert.ok(maske.indexOf("alle 3 Abschnitte") !== -1, "das Kopfband nennt die Zahl der Abschnitte nicht");
	assert.ok(maske.indexOf("Speichern für 3 Abschnitte") !== -1,
		"der Speichern-Knopf sagt nicht, worauf er wirkt");
	checks += 3;

	// 💣 Die Verteilung steht als Satz da -- ohne sie sieht „— gemischt lassen —" wie ein Fehler aus.
	assert.ok(maske.indexOf("2× Gebirgspass, 1× Pfad") !== -1,
		"die Verteilung der Wegtypen fehlt: " + maske.slice(maske.indexOf("Wegtyp"), maske.indexOf("Wegtyp") + 400));
	assert.ok(maske.indexOf("— gemischt lassen —") !== -1, "die gemischte Wahl fehlt");
	checks += 2;

	// Der halbe Haken der Kutsche traegt seinen Zaehler.
	assert.ok(maske.indexOf("1 von 3") !== -1, "der Zaehler des halben Hakens fehlt");
	assert.ok(maske.indexOf("wp-mixed") !== -1, "der Zaehler traegt seine Klasse nicht");
	checks += 2;

	// ── 2) Spalte 3: die Zahlen des ganzen Weges ──────────────────────────────────────────────
	const profil = s.elemente.wpProfile.innerHTML;
	assert.ok(profil.indexOf("Länge, ganzer Weg") !== -1,
		"Spalte 3 zeigt die Summen des Weges nicht: " + profil.slice(0, 200));
	// 8 + 6 + 4 Einheiten = 18, mal 3 = 54 Meilen. Der dritte Abschnitt hat KEIN Profil und zaehlt
	// bei den Hoehen nicht mit -- 260 Anstieg, 320 Abstieg.
	assert.ok(profil.indexOf("54,00 Meilen") !== -1, "die Laenge des ganzen Weges stimmt nicht: " + profil);
	assert.ok(profil.indexOf("260 Schritt") !== -1, "der Anstieg des ganzen Weges stimmt nicht");
	assert.ok(profil.indexOf("1 Abschnitt(e) ohne Höhenprofil") !== -1,
		"ein Abschnitt ohne Profil wird verschwiegen -- „unbekannt“ ist nicht „eben“");
	checks += 4;

	// ── 2b) Die KURVE des ganzen Weges ────────────────────────────────────────────────────────
	// Die drei Abschnitte der Fixture haengen aneinander (10,10 → 12,12 → 15,15 → 17,17), es ist
	// also EINE Kette.
	assert.ok(profil.indexOf("<svg") !== -1, "die Hoehenkurve fehlt: " + profil.slice(0, 300));
	assert.ok(profil.indexOf("lückenlos aneinander") !== -1,
		"der Kasten sagt nicht, ob die Kette durchgeht");
	assert.ok(profil.indexOf("wp-cut") !== -1,
		"die Abschnittsgrenzen sind nicht markiert -- dann sagt die Kurve nicht, wo ein "
		+ "Abschnitt liegt, und genau das war ihr Zweck");
	assert.ok(profil.indexOf("Höchster Punkt über Start") !== -1,
		"die Zahl, die man bei einem Pass sucht, fehlt");
	checks += 4;

	// Der Umschalter hat DREI Stufen (der Abschnitt daneben hat zwei).
	assert.ok(profil.indexOf("data-gscale=\"ganz\"") !== -1
		&& profil.indexOf("data-gscale=\"abschnitte\"") !== -1
		&& profil.indexOf("data-gscale=\"stuecke\"") !== -1,
		"der Umschalter hat nicht alle drei Stufen");
	checks += 1;

	// ── 3) 🔴 EIN SPEICHERN OHNE AENDERUNG SCHICKT NICHTS ─────────────────────────────────────
	s.gesendet.length = 0;
	s.elemente.wpGroupSave.feuere("click");
	await ruhe();
	assert.strictEqual(s.gesendet.length, 0,
		"ein unberuehrtes Sammel-Speichern setzt einen Schreibvorgang ab: "
		+ JSON.stringify(s.gesendet.map((g) => g.rumpf)));
	checks += 1;

	// ── 4) Der Wegtyp wird gewaehlt -- und NUR er reist mit ───────────────────────────────────
	const wahl = s.elemente.wpGroupSubtype;
	wahl.value = "Gebirgspass";
	wahl.feuere("change");
	await ruhe();

	s.gesendet.length = 0;
	s.elemente.wpGroupSave.feuere("click");
	await ruhe();

	const schreiben = s.gesendet.filter((g) => g.rumpf && g.rumpf.action === "update_path_group_details");
	assert.strictEqual(schreiben.length, 1, "der Sammel-Schreibweg wurde nicht gerufen: "
		+ JSON.stringify(s.gesendet.map((g) => g.url)));
	const rumpf = schreiben[0].rumpf;
	assert.deepEqual(rumpf.fields, ["feature_subtype"],
		"🔴 es reist mehr mit als der gewaehlte Wegtyp -- damit macht ein Sammel-Speichern jede "
		+ "gewollte Ausnahme platt: " + JSON.stringify(rumpf.fields));
	assert.strictEqual(rumpf.feature_subtype, "Gebirgspass");
	assert.strictEqual(rumpf.public_ids.length, 3, "es werden nicht alle drei Abschnitte genannt");
	assert.strictEqual(rumpf.transport_decisions, undefined,
		"die Fahrtypen reisen mit, obwohl sie niemand angefasst hat");
	checks += 5;

	// ── 5) Ein Abschnitt-Klick raeumt die Weg-Ebene ab ────────────────────────────────────────
	const segmentZeile = attrappe("row2");
	segmentZeile.getAttribute = (n) => (n === "data-id" ? "11111111-1111-4111-8111-111111111111" : null);
	liste.zuhoerer.click({ target: { closest: () => segmentZeile }, preventDefault() {} });
	await ruhe();
	const danach = s.elemente.wpDetail.innerHTML;
	assert.ok(danach.indexOf("Ganzer Weg") === -1,
		"nach dem Klick auf einen Abschnitt steht immer noch die Weg-Maske da -- der Speichern-Knopf "
		+ "wuerde auf alle schreiben, obwohl die Liste einen einzelnen zeigt");
	// 💣 UND SPALTE 3 MUSS MIT. Sie haengt an `state.selectedGroup`, die Maske an
	// `state.groupDraft` -- zwei Merker, und eine Mutationsprobe hat gezeigt, dass die
	// Zusicherung oben allein den zweiten gar nicht sieht: `groupDraft = null` raeumt die Maske
	// ab, waehrend `selectedGroup` stehenbleibt und die Zahlen des GANZEN Weges neben einem
	// einzelnen Abschnitt stehen laesst.
	const profilDanach = s.elemente.wpProfile.innerHTML;
	assert.ok(profilDanach.indexOf("Länge, ganzer Weg") === -1,
		"Spalte 3 zeigt weiter den ganzen Weg, obwohl links ein Abschnitt gewaehlt ist");
	// ⚠️ UND POSITIV, nicht nur negativ. Die Verneinung allein war wirkungslos: bei der
	// Mutationsprobe („selectedGroup wird nicht abgeraeumt") blieb Spalte 3 auf „Wird geladen…"
	// stehen -- kein „ganzer Weg", aber eben auch kein Abschnitt. Ein Test, der nur das
	// Falsche ausschliesst, laesst den dritten Zustand durch.
	assert.ok(profilDanach.indexOf("Relative Höhe über die Länge") !== -1,
		"Spalte 3 zeigt das Profil des gewaehlten Abschnitts nicht: " + profilDanach.slice(0, 200));
	checks += 3;

	console.log("wege-gruppe-ablauf.test.js: OK -- " + checks + " Zusicherungen");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});
