// Landschaften: wie GROSS ist eine Fläche zum Speichern? -- die reine Regel (09.10.2026).
//
// Owner: „kannst du den leuten anzeigen, wenn sie zuviel punkte gemalt und KB produziert haben".
//
// 💣 DIE GRENZE IST DIE DES WEBSERVERS, NICHT UNSERE. STRATO weist jede Anfrage über rund 128 KiB mit
// 413 ab, bevor PHP sie sieht (live gemessen 09.10.2026: 130,5 KB gingen durch, 132,5 KB nicht -- die
// Grenze ist die übliche 131.072). Bei Flächen sind das grob 7.000 Punkte (~18 Byte je Punkt). Die zweite
// Grenze des Webservers -- 1000 JSON-Werte -- löst der Umschlag (js/app/json-umschlag.js); gegen diese
// hier hilft er nicht.
//
// 🔴 EINE Regel, VIER Leser: der Riegel vor dem Speichern und der Hinweisstreifen
// (map-features-ecosystem-region-store.js, map-features-ecosystem-groesse-hinweis.js), die Leiste im
// Fenster „Fläche vereinfachen" und der Prüfhaken „Zu große Flächen". Getrennt gepflegt sagte die Leiste
// „passt", während der Riegel ablehnt.
//
// Kein DOM, kein Modulzustand -- deshalb im Test ohne Karte fahrbar.

const AVESMAPS_SPEICHER_GRENZE_BYTES = 131072;
// Ab hier warnt der Editor: „bald vereinfachen". Die Hälfte wäre zu früh (fast jede Küste), 90 % zu spät
// -- ein Pinselstrich legt leicht 5 KB drauf.
const AVESMAPS_SPEICHER_WARN_ANTEIL = 0.75;
// Was ein Speichervorgang ausser der Geometrie mitschickt: Aktion, Kennung, Revision, Klammer der Geste,
// Umschlag. Nur für die SCHÄTZUNG aus einer Geometrie (Leiste, Prüfhaken); der Riegel misst den echten
// Rumpf.
const AVESMAPS_SPEICHER_RUMPF_ZUSCHLAG = 320;

// Bytes einer Zeichenkette, wie sie über die Leitung geht (UTF-8). Die Geometrie ist reines ASCII; die
// Beschriftung einer Geste („Mit anderer vereinigen") kann Umlaute tragen.
function avesmapsUtf8Bytes(text) {
	const s = String(text == null ? "" : text);
	if (typeof TextEncoder === "function") {
		return new TextEncoder().encode(s).length;
	}
	let bytes = 0;
	for (let i = 0; i < s.length; i += 1) {
		const code = s.charCodeAt(i);
		if (code < 0x80) {
			bytes += 1;
		} else if (code < 0x800) {
			bytes += 2;
		} else if (code >= 0xd800 && code <= 0xdbff) {
			bytes += 4;
			i += 1; // Ersatzpaar: zwei UTF-16-Einheiten, ein Zeichen mit vier Byte
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

// Punkte einer Fläche -- 🔴 DIESELBE ZÄHLUNG WIE IM FENSTER „Fläche vereinfachen": je Ring ohne den
// Schlusspunkt (er wiederholt den ersten). Zählten Streifen und Fenster verschieden, stünden an derselben
// Fläche zwei Zahlen. Das Fenster ruft deshalb diese Funktion (countGeometryPoints in
// map-features-ecosystem-simplify.js), statt eine eigene zu führen.
function avesmapsEcosystemPunkte(geometry) {
	const coordinates = geometry && geometry.coordinates;
	if (!Array.isArray(coordinates)) {
		return 0;
	}
	const teile = geometry.type === "MultiPolygon" ? coordinates : [coordinates];
	let punkte = 0;
	teile.forEach((teil) => (Array.isArray(teil) ? teil : []).forEach((ring) => {
		punkte += Array.isArray(ring) ? Math.max(0, ring.length - 1) : 0;
	}));
	return punkte;
}

// Geschätzte Grösse eines Speichervorgangs dieser Geometrie. Für Leiste und Prüfhaken; der Riegel vor
// dem Senden misst stattdessen den fertigen Rumpf.
function avesmapsEcosystemFlaechenGroesse(geometry) {
	if (!geometry) {
		return { punkte: 0, bytes: 0 };
	}
	return {
		punkte: avesmapsEcosystemPunkte(geometry),
		bytes: avesmapsUtf8Bytes(JSON.stringify(geometry)) + AVESMAPS_SPEICHER_RUMPF_ZUSCHLAG,
	};
}

// "ok" | "gross" (ab 75 %, wird noch gespeichert) | "zu_gross" (über der Grenze, wird NICHT gespeichert)
function avesmapsEcosystemGroesseStufe(bytes) {
	const b = Number(bytes) || 0;
	if (b > AVESMAPS_SPEICHER_GRENZE_BYTES) {
		return "zu_gross";
	}
	if (b >= AVESMAPS_SPEICHER_GRENZE_BYTES * AVESMAPS_SPEICHER_WARN_ANTEIL) {
		return "gross";
	}
	return "ok";
}

// Kilobyte für die Anzeige. 🪤 Gerundet wird IN RICHTUNG DER STUFE: knapp über der Grenze darf nicht
// „128 von 128 KB" dastehen und trotzdem abgelehnt werden, knapp darunter nicht „129".
function avesmapsEcosystemKb(bytes) {
	const kb = (Number(bytes) || 0) / 1024;
	return avesmapsEcosystemGroesseStufe(bytes) === "zu_gross" ? Math.ceil(kb) : Math.floor(kb);
}

function avesmapsEcosystemZahl(n) {
	return Number(n || 0).toLocaleString("de-DE");
}

// „5.400 Punkte · 98 von 128 KB"
// Die Sätze der Größenanzeige gehen durch tr() (AGENTS.md §8) -- auch die in den drei Aufrufern
// (Streifen, Fenster, Schreibkanal), damit es EINEN Übersetzungsweg gibt. Auf der Seite lädt i18n.js
// lange vor dieser Datei; der Rückfall setzt nur die Platzhalter ein und dient dem Test unter Node.
function avesmapsGroesseTr(schluessel, deutsch, werte) {
	if (typeof tr === "function") {
		return tr(schluessel, deutsch, werte);
	}
	return String(deutsch).replace(/\{(\w+)\}/g, (alles, name) =>
		(werte && Object.prototype.hasOwnProperty.call(werte, name) ? String(werte[name]) : alles));
}

function avesmapsEcosystemGroesseText(punkte, bytes) {
	return avesmapsGroesseTr("ecosystem.size.amount", "{punkte} Punkte · {kb} von {grenze} KB", {
		punkte: avesmapsEcosystemZahl(punkte),
		kb: avesmapsEcosystemKb(bytes),
		grenze: AVESMAPS_SPEICHER_GRENZE_BYTES / 1024,
	});
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_SPEICHER_GRENZE_BYTES,
		AVESMAPS_SPEICHER_WARN_ANTEIL,
		AVESMAPS_SPEICHER_RUMPF_ZUSCHLAG,
		avesmapsUtf8Bytes,
		avesmapsEcosystemPunkte,
		avesmapsEcosystemFlaechenGroesse,
		avesmapsEcosystemGroesseStufe,
		avesmapsEcosystemKb,
		avesmapsEcosystemGroesseText,
		avesmapsGroesseTr,
	};
}
