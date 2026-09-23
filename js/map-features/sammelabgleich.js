// Der Sammelabgleich (23.09.2026): teure Voll-Abgleiche der Karte, die WAEHREND einer Folge von
// Aenderungen angefordert werden, laufen am Ende GENAU EINMAL.
//
// 💣 WARUM: Wer eine Aenderung in die Karte uebernimmt, gleicht danach die ganze Karte ab -- alle
// ~8.000 Wege (syncPathVisibility samt Wegnamen-Leinwand), alle ~6.900 Orte samt Kreuzungs-Index
// (syncLocationMarkerVisibility), die Ortsnamen, und die Routenplaner-Auffrischung mit dem
// Pruefhaken „Offene Wegenden" und gegebenenfalls einer neuen Route (refreshPlannerAfterFeatureChange).
// Das geschah JE OBJEKT: der Live-Abgleich spielt jedes Objekt einer fremden Speicherung einzeln ein
// (pollLiveMapUpdates), und „Weg teilen" legt Kreuzung und zwei Teilstuecke nacheinander an -- fuenf
// volle Durchlaeufe fuer einen Handgriff. Gemessen am 23.09.2026 (8.083 Wege, 6.923 Orte, Pruefhaken
// an): ein fremdes Teilen fror jeden offenen Editor 0,55 s ein, ein Import-Stapel von 50 Objekten
// entsprechend fuenfzigmal so lange.
//
// 🔴 WAS GESAMMELT WIRD UND WAS NICHT: gesammelt wird nur NEU RECHNEN und NEU ZEICHNEN. Das Verwerfen
// von Zwischenspeichern (graphData, Kreuzungs-Index, „Offene Wegenden", Wegeinschraenkung) bleibt
// sofort -- sonst rechnete ein Abgleich am Ende mit einem Stand von VOR den Aenderungen, und das
// saehe aus wie ein falscher Pruefbefund.
//
// 🔴 AUSSERHALB EINES SAMMELABGLEICHS AENDERT SICH NICHTS: jeder Aufrufer fragt
// `avesmapsSammelabgleichVormerken(…)`, und das sagt dort `false` -- der Abgleich laeuft sofort wie
// bisher. Gesammelt wird nur, wo ausdruecklich `avesmapsSammelabgleich(() => …)` drumsteht.
//
// ⚠️ Nur fuer Editoren geladen (<template data-nur-editor> in index.html): Besucher sammeln nie, und
// jede Stelle, die hier fragt, fragt per `typeof` -- ohne diese Datei laeuft alles wie vorher.
// Test: js/map-features/__tests__/sammelabgleich.test.js.

let avesmapsSammelabgleichTiefe = 0;
// Name -> { ausfuehren, optionen }. Eine Map, weil sie ihre Einfuegereihenfolge behaelt -- die gilt
// fuer alle Namen, die AVESMAPS_SAMMELABGLEICH_REIHENFOLGE nicht kennt.
const avesmapsSammelabgleichOffen = new Map();
const avesmapsSammelabgleichDanachListe = [];
const avesmapsSammelabgleichZaehler = Object.create(null);

// 🔴 DIE REIHENFOLGE DES NACHHOLENS IST FEST, nicht die der ersten Anforderung. Die
// Planer-Auffrischung zieht ueber „Offene Wegenden" die Wege-Sichtbarkeit nach, und die zeichnet die
// Wegnamen: laeuft der Planer ZUERST, finden seine Nachforderungen die Wege noch in der Liste und
// verschmelzen mit ihnen. In Anforderungsreihenfolge liefe die Wege-Sichtbarkeit zweimal.
// Die Orte stehen vor den Ortsnamen, weil der Orts-Abgleich die Namen ohnehin mitzieht.
const AVESMAPS_SAMMELABGLEICH_REIHENFOLGE = ["planer", "orte", "ortsnamen", "wege", "wegnamen"];

// Ein Riegel gegen einen Kreislauf (ein Abgleich, der sich ueber Umwege selbst wieder anfordert). Im
// Normalfall laufen hoechstens fuenf Runden; wer diese Grenze erreicht, hat einen Fehler gebaut.
const AVESMAPS_SAMMELABGLEICH_HOECHSTENS = 50;

function avesmapsSammelabgleichZaehlen(name, art) {
	const eintrag = avesmapsSammelabgleichZaehler[name] || (avesmapsSammelabgleichZaehler[name] = { angefordert: 0, ausgefuehrt: 0 });
	eintrag[art] += 1;
}

// Die Wirkung als Zahl: je Abgleich, wie oft er angefordert und wie oft er wirklich ausgefuehrt wurde.
// Ohne Zaehler bliebe nur „fuehlt sich schneller an" (dieselbe Begruendung wie avesmapsZeichenBilanz).
function avesmapsSammelabgleichBilanz() {
	const kopie = Object.create(null);
	Object.keys(avesmapsSammelabgleichZaehler).forEach((name) => {
		kopie[name] = { ...avesmapsSammelabgleichZaehler[name] };
	});
	return kopie;
}

/**
 * Fuehrt `arbeit` aus und holt die darin angeforderten Abgleiche am Ende einmal nach.
 * Verschachtelt nachgeholt wird erst am Ende des AEUSSERSTEN Sammelabgleichs.
 * 💣 Auch wenn `arbeit` wirft, wird nachgeholt -- was bis dahin eingespielt ist, muss auf der Karte
 * stehen --, und der Fehler geht danach unveraendert weiter.
 */
function avesmapsSammelabgleich(arbeit) {
	avesmapsSammelabgleichTiefe += 1;
	try {
		return arbeit();
	} finally {
		avesmapsSammelabgleichTiefe -= 1;
		if (avesmapsSammelabgleichTiefe === 0) {
			avesmapsSammelabgleichNachholen();
		}
	}
}

/**
 * Merkt einen Abgleich vor, wenn gerade gesammelt wird. `true` heisst: vorgemerkt, der Aufrufer kehrt
 * zurueck. `false` heisst: es wird nicht gesammelt, der Aufrufer gleicht sofort ab wie bisher.
 * Ein zweites Vormerken desselben Namens verschmilzt mit dem ersten; seine `optionen` werden
 * ODER-verknuepft (eine einzige Anforderung mit `updateRoute: true` genuegt fuer die neue Route).
 */
function avesmapsSammelabgleichVormerken(name, ausfuehren, optionen = null) {
	if (avesmapsSammelabgleichTiefe === 0) {
		return false;
	}
	avesmapsSammelabgleichZaehlen(name, "angefordert");
	const offen = avesmapsSammelabgleichOffen.get(name);
	if (!offen) {
		avesmapsSammelabgleichOffen.set(name, { ausfuehren, optionen: optionen ? { ...optionen } : null });
		return true;
	}
	if (optionen) {
		const vereint = offen.optionen || {};
		Object.keys(optionen).forEach((schluessel) => {
			vereint[schluessel] = Boolean(vereint[schluessel]) || Boolean(optionen[schluessel]);
		});
		offen.optionen = vereint;
	}
	return true;
}

/**
 * Ein vorgemerkter Abgleich ist schon geschehen, weil ein anderer ihn mitgezogen hat (der
 * Orts-Abgleich gleicht die Ortsnamen mit ab): aus der Liste, sonst liefe er zweimal gegen denselben
 * Stand. Ausserhalb eines Sammelabgleichs ist die Liste leer, dann tut das nichts.
 */
function avesmapsSammelabgleichErledigt(name) {
	avesmapsSammelabgleichOffen.delete(name);
}

/**
 * Laeuft nach dem Nachholen -- oder sofort, wenn gerade nicht gesammelt wird. Fuer alles, was einen
 * abgeglichenen Stand voraussetzt: ein Popup an einem Marker, der erst mit dem Orts-Abgleich auf die
 * Karte kommt, oeffnet sich an einem Marker ohne Karte gar nicht (Leaflet steigt still aus).
 */
function avesmapsSammelabgleichDanach(aufgabe) {
	if (avesmapsSammelabgleichTiefe === 0) {
		aufgabe();
		return;
	}
	avesmapsSammelabgleichDanachListe.push(aufgabe);
}

function avesmapsSammelabgleichNaechsterName() {
	for (const name of AVESMAPS_SAMMELABGLEICH_REIHENFOLGE) {
		if (avesmapsSammelabgleichOffen.has(name)) {
			return name;
		}
	}
	return avesmapsSammelabgleichOffen.keys().next().value;
}

function avesmapsSammelabgleichNachholen() {
	let ersterFehler = null;
	// ⭐ Waehrend des Nachholens wird WEITER gesammelt: was ein Abgleich seinerseits anfordert, landet in
	// derselben Liste und verschmilzt dort, statt ein zweites Mal zu laufen.
	avesmapsSammelabgleichTiefe += 1;
	try {
		let runden = 0;
		while (avesmapsSammelabgleichOffen.size > 0) {
			runden += 1;
			if (runden > AVESMAPS_SAMMELABGLEICH_HOECHSTENS) {
				console.error("Sammelabgleich: nach " + AVESMAPS_SAMMELABGLEICH_HOECHSTENS
					+ " Runden abgebrochen -- ein Abgleich fordert sich selbst wieder an.",
				[...avesmapsSammelabgleichOffen.keys()]);
				avesmapsSammelabgleichOffen.clear();
				break;
			}
			const name = avesmapsSammelabgleichNaechsterName();
			const offen = avesmapsSammelabgleichOffen.get(name);
			avesmapsSammelabgleichOffen.delete(name);
			avesmapsSammelabgleichZaehlen(name, "ausgefuehrt");
			// ⚠️ Ein Fehler in EINEM Abgleich darf die anderen nicht aufhalten: eine kaputte
			// Wegnamen-Leinwand liesse sonst auch die Orte ungezeichnet. Er geht am Ende weiter.
			try {
				offen.ausfuehren(offen.optionen || undefined);
			} catch (fehler) {
				if (!ersterFehler) {
					ersterFehler = fehler;
				}
			}
		}
	} finally {
		avesmapsSammelabgleichTiefe -= 1;
	}
	const danach = avesmapsSammelabgleichDanachListe.splice(0);
	danach.forEach((aufgabe) => {
		try {
			aufgabe();
		} catch (fehler) {
			if (!ersterFehler) {
				ersterFehler = fehler;
			}
		}
	});
	if (ersterFehler) {
		throw ersterFehler;
	}
}
