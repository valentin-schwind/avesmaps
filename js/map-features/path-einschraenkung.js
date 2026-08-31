/*
 * „Dieser Weg ist nur eingeschränkt befahrbar" -- die EINE Regel und ihr Satz.
 *
 * Owner 01.09.2026: „alle wege, die nur eingeschränkt befahrbar sind, sollen 2 eigenschaften haben:
 * kursiver name und eine zusammenfassung der einschränkung in deren infobox."
 *
 * 💣 ZWEI ANZEIGEN, EINE REGEL. Die Kartenschrift (getPathLabelStyle) fragt nur „betroffen?", die
 * Infobox zusätzlich nach dem Satz -- aber beide gehen durch diese Datei. Eine Regel, die einen von
 * zwei Erzeugern bindet, ist keine Regel; dieses Haus hat das mehrfach bezahlt (Verkehrsmittel-
 * Sperre 14.08.2026, Ausstiegsregel 15.08.2026).
 *
 * 🔴 ZWEI ARTEN VON EINSCHRÄNKUNG, per Mockup abgestimmt (docs/wege-einschraenkung-mockup.html):
 *   - ZEITLICH   -- `transport_seasons`, das Fenster („Saljethweg: Peraine 15 bis Efferd 30")
 *   - REISEMITTEL -- der Weg erlaubt WENIGER, als seine Wegart normalerweise erlaubt
 *                    („Schattenbachpass: nur zu Fuß")
 *
 * 🔴 NUR LANDWEGE. Fluss- und Seewege bleiben außen vor: dort ist eine Reisemittel-Sperre der
 * Normalfall (kein Segler am Oberlauf), und live tragen 564 Flussabschnitte eine -- kursiv gesetzt
 * wäre das die halbe Karte, ohne dass es etwas bedeutete.
 *
 * 💣 EINE ERWEITERUNG IST KEINE SPERRE. Die erste Fassung fragte „weicht die Liste von der Vorgabe
 * ab?" und meldete damit auch die zwei Wege, auf denen ein Editor ZUSÄTZLICH etwas erlaubt hat (eine
 * Kutsche auf einem Pfad) -- kursiv, mit einer Zeile, die nichts zu sagen hat. Gefragt wird deshalb
 * nur nach dem, was FEHLT: `Vorgabe der Wegart \ tatsächlich erlaubt`.
 *
 * ⚠️ Die REGEL ist rein: kein DOM, kein fetch, kein Zustand -- die Monatsnamen kommen als Funktion
 * herein, weil es im Haus nur EINE Liste der zwölf gibt und die im Markup des Routenplaners steht
 * (AGENTS.md §2). Einzige Ausnahme ist der Gruppen-Index ganz unten; warum, steht dort.
 */

// Die sechs Landreisemittel sind die Meßlatte des Satzes: „nicht mit Kutsche" heißt, dass eine
// gewöhnliche Straße sie trüge. Aus TRANSPORT_DOMAIN_OPTIONS, nicht abgeschrieben.
function avesmapsWegLandMittel() {
	const domain = (typeof TRANSPORT_DOMAIN_OPTIONS !== "undefined" && TRANSPORT_DOMAIN_OPTIONS)
		? TRANSPORT_DOMAIN_OPTIONS.land
		: null;
	return Array.isArray(domain) ? domain.slice() : [];
}

const AVESMAPS_WEG_LANDARTEN = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"];

/*
 * Die SATZformen der Reisemittel -- bewusst eine eigene Liste, und hier steht warum.
 *
 * Die Namen, die ein Besucher kennt, stehen im Routenplaner („Reiter zu Pferd mit leichtem
 * Gepäck"). Das sind Substantive für eine Auswahlliste; in einem Satz ergäben sie „Nicht mit Reiter
 * zu Pferd mit leichtem Gepäck". Diese Liste hier ist dieselbe Menge in der Satzform -- eine
 * grammatische Beugung, keine zweite Wahrheit über die Reisemittel. Der Test hält sie gegen
 * TRANSPORT_DOMAIN_OPTIONS.land, damit ein neues Landreisemittel nicht still herausfällt.
 *
 * 🪤 „als", nicht „mit", bei den Reisegruppen -- an den echten Daten gefunden. Die sechs sind
 * zweierlei Art: Fahrzeuge, mit denen man fährt („mit Kutsche"), und Fortbewegungsarten, in denen
 * man reist („zu Fuß"). Trug jede ein eigenes „mit", kam „Nicht mit Kutsche und mit einer
 * Reisegruppe zu Pferd." heraus -- zweimal live, und im Testfeld sah niemand es, weil kein Test
 * zwei Mittel VERSCHIEDENER Art zusammen sperrte.
 */
const AVESMAPS_WEG_MITTEL_SATZFORM = {
	caravan: "mit Karawane",
	groupFoot: "als Reisegruppe zu Fuß",
	lightWalker: "zu Fuß mit leichtem Gepäck",
	horseCarriage: "mit Kutsche",
	groupHorse: "als Reisegruppe zu Pferd",
	lightRider: "zu Pferd mit leichtem Gepäck",
};

/*
 * Familien: sind BEIDE Mitglieder im selben Zustand, wird die Familie genannt („zu Fuß") statt
 * zweier Kunstbegriffe. Ist nur eines dabei, wird es einzeln benannt -- live gibt es drei Wege, auf
 * denen eine Reisegruppe zu Fuß NICHT durchkommt und ein Einzelner schon; „nur zu Fuß" wäre dort
 * schlicht falsch.
 */
const AVESMAPS_WEG_MITTEL_FAMILIEN = [
	{ wort: "zu Fuß", mitglieder: ["groupFoot", "lightWalker"] },
	{ wort: "zu Pferd", mitglieder: ["groupHorse", "lightRider"] },
];

/** Welche Abschnitte sind DERSELBE Weg? Dieselbe Bauform wie wpGroupWays (wege-editor-model.js). */
function avesmapsWegGruppenSchluessel(pfad) {
	const p = (pfad && pfad.properties) || {};
	const wikiKey = p.wiki_path && p.wiki_path.wiki_key ? String(p.wiki_path.wiki_key).trim() : "";
	if (wikiKey !== "") {
		return "wiki:" + wikiKey;
	}
	// 🔴 Der Name ist kein Schlüssel -- er ist hier nur der Rückfall, exakt wie im Wege-Editor.
	return "name:" + String(p.feature_subtype || "") + ":" + String(p.name || "");
}

function avesmapsWegIstLandweg(properties) {
	const subtype = normalizePathSubtype(properties && (properties.feature_subtype || properties.name));
	return AVESMAPS_WEG_LANDARTEN.indexOf(subtype) !== -1;
}

/** Das erste hinterlegte Zeitfenster eines Abschnitts -- die Datumsgrenzen, ohne das Reisemittel. */
function avesmapsWegFensterAusAbschnitt(properties) {
	const seasons = properties && properties.transport_seasons;
	if (!seasons || typeof seasons !== "object") {
		return null;
	}
	// ⚠️ Je Reisemittel steht ein eigener Eintrag, aber die DATUMSgrenzen sind je Weg einheitlich
	// (live an allen sieben Wegen mit Fenster nachgemessen, 01.09.2026); die Einträge unterscheiden
	// sich nur darin, WELCHE Mittel das Fenster tragen. Deshalb genügt der erste.
	const schluessel = Object.keys(seasons);
	for (let i = 0; i < schluessel.length; i += 1) {
		const fenster = seasons[schluessel[i]];
		if (fenster && typeof fenster === "object" && fenster.from_month && fenster.to_month) {
			return {
				from_month: String(fenster.from_month),
				from_day: Number(fenster.from_day),
				to_month: String(fenster.to_month),
				to_day: Number(fenster.to_day),
			};
		}
	}
	return null;
}

/**
 * DIE REGEL. Bekommt alle Abschnitte EINES Weges und sagt, ob und wie er eingeschränkt ist.
 *
 * `null` heißt „gewöhnlicher Weg". Sonst: `{ fenster, erlaubt, gesperrt }` -- `erlaubt` ist die
 * Schnittmenge über alle Abschnitte (was auf einem Stück nicht darf, kommt den Weg nicht entlang).
 */
function avesmapsWegEinschraenkung(segmente) {
	const liste = Array.isArray(segmente) ? segmente : [];
	const landMittel = avesmapsWegLandMittel();
	let fenster = null;
	let mittelGesperrt = false;
	let erlaubt = null;
	let hatLandAbschnitt = false;

	liste.forEach((pfad) => {
		const properties = (pfad && pfad.properties) || {};
		if (!avesmapsWegIstLandweg(properties)) {
			return;
		}
		hatLandAbschnitt = true;

		if (!fenster) {
			fenster = avesmapsWegFensterAusAbschnitt(properties);
		}

		const subtype = normalizePathSubtype(properties.feature_subtype || properties.name);
		const tatsaechlich = resolvePathAllowedTransports(properties);
		const vorgabe = getDefaultAllowedTransportsForPathSubtype(subtype);
		// 💣 Nur was FEHLT zählt. Was jemand zusätzlich erlaubt hat, ist keine Einschränkung.
		if (vorgabe.some((mittel) => tatsaechlich.indexOf(mittel) === -1)) {
			mittelGesperrt = true;
		}

		erlaubt = erlaubt === null
			? tatsaechlich.slice()
			: erlaubt.filter((mittel) => tatsaechlich.indexOf(mittel) !== -1);
	});

	if (!hatLandAbschnitt || (!fenster && !mittelGesperrt)) {
		return null;
	}

	const durchgehend = (erlaubt || []).filter((mittel) => landMittel.indexOf(mittel) !== -1);
	return {
		fenster: fenster,
		// Nur wenn wirklich etwas gesperrt ist, tragen diese beiden eine Aussage -- sonst wäre die
		// normale Kutzschenfreiheit eines Pfades als „Einschränkung" ausgewiesen.
		erlaubt: mittelGesperrt ? durchgehend : landMittel.slice(),
		gesperrt: mittelGesperrt ? landMittel.filter((m) => durchgehend.indexOf(m) === -1) : [],
	};
}

/** „zu Fuß", „mit Kutsche", … -- Familien werden nur zusammengezogen, wenn beide Mitglieder drin sind. */
function avesmapsWegMittelWorte(mittel) {
	const rest = mittel.slice();
	const worte = [];
	AVESMAPS_WEG_MITTEL_FAMILIEN.forEach((familie) => {
		if (familie.mitglieder.every((m) => rest.indexOf(m) !== -1)) {
			worte.push(familie.wort);
			familie.mitglieder.forEach((m) => { rest.splice(rest.indexOf(m), 1); });
		}
	});
	rest.forEach((m) => {
		if (AVESMAPS_WEG_MITTEL_SATZFORM[m]) {
			worte.push(AVESMAPS_WEG_MITTEL_SATZFORM[m]);
		}
	});
	return worte;
}

/** „A", „A und B", „A, B und C". */
function avesmapsWegWortListe(worte) {
	if (worte.length <= 1) {
		return worte[0] || "";
	}
	return worte.slice(0, -1).join(", ") + " und " + worte[worte.length - 1];
}

/**
 * Der Satz für die Infobox. `monatsName` liefert „Peraine" zu „peraine" -- im Browser ist das
 * routePlanMonthLabel, das die zwölf Namen aus dem <select> des Routenplaners liest.
 */
function avesmapsWegEinschraenkungSatz(einschraenkung, monatsName) {
	if (!einschraenkung) {
		return "";
	}
	const saetze = [];
	const f = einschraenkung.fenster;
	if (f) {
		const nenne = typeof monatsName === "function" ? monatsName : (key) => key;
		saetze.push("Nur vom " + f.from_day + ". " + nenne(f.from_month)
			+ " bis zum " + f.to_day + ". " + nenne(f.to_month) + " befahrbar, sonst gesperrt.");
	}
	if (einschraenkung.gesperrt && einschraenkung.gesperrt.length) {
		const erlaubteWorte = avesmapsWegMittelWorte(einschraenkung.erlaubt);
		const gesperrteWorte = avesmapsWegMittelWorte(einschraenkung.gesperrt);
		// 💣 Eine gespeicherte LEERE Liste ist ein Entscheid („kein Reisemittel kommt durch", siehe
		// resolvePathAllowedTransports) und braucht einen eigenen Satz -- die Rahmen unten ergäben
		// sonst „Nur ." und niemand erkennt das als Fehler.
		if (!erlaubteWorte.length) {
			saetze.push("Für kein Reisemittel befahrbar.");
			return saetze.join(" ");
		}
		// Die KÜRZERE Liste wird genannt; bei Gleichstand das MÖGLICHE, weil ein Reisender wissen
		// will, womit er durchkommt.
		saetze.push(erlaubteWorte.length <= gesperrteWorte.length
			? "Nur " + avesmapsWegWortListe(erlaubteWorte) + "."
			: "Nicht " + avesmapsWegWortListe(gesperrteWorte) + ".");
	}
	return saetze.join(" ");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   DER INDEX -- der einzige Zustand in dieser Datei, und er ist Absicht.
 
   Die Regel oben gilt einem WEG, gezeichnet werden aber ABSCHNITTE: der Saljethweg liegt live in
   sieben Stücken, der Schattenbachpass in neun. Für jeden Namenszug erneut alle ~6.000 Wege nach
   Geschwistern zu durchsuchen wäre O(n²); deshalb einmal ein Durchgang in eine Map, danach nur noch
   ein Nachschlagen.
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

let avesmapsWegEinschraenkungCache = null;

/** Rein und testbar: aus einer Liste von Wegen wird eine Map Gruppenschlüssel -> Urteil. */
function avesmapsWegEinschraenkungIndexBauen(pfade) {
	const gruppen = new Map();
	(Array.isArray(pfade) ? pfade : []).forEach((pfad) => {
		const schluessel = avesmapsWegGruppenSchluessel(pfad);
		if (!gruppen.has(schluessel)) {
			gruppen.set(schluessel, []);
		}
		gruppen.get(schluessel).push(pfad);
	});
	const index = new Map();
	gruppen.forEach((segmente, schluessel) => {
		index.set(schluessel, avesmapsWegEinschraenkung(segmente));
	});
	return index;
}

/**
 * 💣 NACH JEDER ÄNDERUNG AN DEN WEGEN RUFEN. Bleibt der Index stehen, wäre ein frisch gespeichertes
 * Zeitfenster unsichtbar -- und der Editor hielte das für einen verlorenen Speichervorgang, genau
 * die Störung, die dieses Projekt schon mehrfach bezahlt hat.
 */
function avesmapsWegEinschraenkungNeuRechnen() {
	avesmapsWegEinschraenkungCache = null;
}

/** Das Urteil für den Weg, zu dem dieser Abschnitt gehört -- `null` heißt „gewöhnlicher Weg". */
function avesmapsWegEinschraenkungFuerPfad(pfad) {
	if (!pfad) {
		return null;
	}
	if (!avesmapsWegEinschraenkungCache) {
		// ⚠️ `pathData` ist der Bestand der Karte (js/app/runtime-state.js). Fehlt er -- etwa in einem
		// Editorfenster, das diese Datei mitlädt --, bleibt der Index leer statt zu werfen.
		const bestand = (typeof pathData !== "undefined" && Array.isArray(pathData)) ? pathData : [];
		avesmapsWegEinschraenkungCache = avesmapsWegEinschraenkungIndexBauen(bestand);
	}
	return avesmapsWegEinschraenkungCache.get(avesmapsWegGruppenSchluessel(pfad)) || null;
}
