// Wie ein Wegabschnitt heisst: „Abschnitt N: <Ende> – <Ende>" (Entwurf 2026-09-14 §4, Owner: „es geht nur
// darum, dass der besucher den kontext versteht").
//
// 🔴 ZWILLING: api/_internal/map/weg-abschnitt-ende.php (fuer die Wege-Editor-Liste, die keine Orte kennt).
// Beide Tests lesen tools/paths/fixtures/weg-abschnitt-enden.json -- wer die Regel aendert, aendert beide.
// ⚠️ Normales Skript (siehe js/app/nur-editor.js): auch Besucher brauchen die Namen (Infobox, Route).

const AVESMAPS_WEG_ENDE_KREUZUNG = "Kreuzung";
const AVESMAPS_WEG_ENDE_OFFEN = "Wegende";
// Zellbreite des Ortsindex; groesser als jede Toleranz, damit 3x3 Zellen reichen.
const AVESMAPS_WEG_ENDE_ZELLE = 0.5;

/** REIN: Zellenindex ueber Orte {name, x, y, kreuzung}. */
function avesmapsWegOrtIndex(orte) {
	const index = new Map();
	(Array.isArray(orte) ? orte : []).forEach((ort) => {
		const x = Number(ort && ort.x);
		const y = Number(ort && ort.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) { return; }
		const zelle = Math.floor(x / AVESMAPS_WEG_ENDE_ZELLE) + ":" + Math.floor(y / AVESMAPS_WEG_ENDE_ZELLE);
		if (!index.has(zelle)) { index.set(zelle, []); }
		index.get(zelle).push({ name: String(ort.name), x, y, kreuzung: ort.kreuzung === true });
	});
	return index;
}

/**
 * REIN: Name des Endes am Punkt [x, y]. Naechster Ort (keine Kreuzung) mit Abstand < toleranz; sonst
 * „Kreuzung", wenn eine Kreuzung < toleranz liegt; sonst „Wegende". Kein Kastentreffer im 0,5-Umkreis
 * wie getLocationAtPathEndpoint -- ein Name, der nicht wirklich am Ende liegt, fuehrte in die Irre.
 * Gleichstand: kleineres x, dann kleineres y (nie der Name: JS und PHP sortieren Umlaute verschieden).
 */
function avesmapsWegEndeName(punkt, index, toleranz) {
	const x = Number(Array.isArray(punkt) ? punkt[0] : NaN);
	const y = Number(Array.isArray(punkt) ? punkt[1] : NaN);
	if (!Number.isFinite(x) || !Number.isFinite(y) || !(index instanceof Map)) { return AVESMAPS_WEG_ENDE_OFFEN; }
	const zx = Math.floor(x / AVESMAPS_WEG_ENDE_ZELLE);
	const zy = Math.floor(y / AVESMAPS_WEG_ENDE_ZELLE);
	let bester = null;
	let besterAbstand = Infinity;
	let kreuzung = false;
	for (let dx = -1; dx <= 1; dx++) {
		for (let dy = -1; dy <= 1; dy++) {
			(index.get((zx + dx) + ":" + (zy + dy)) || []).forEach((kandidat) => {
				const abstand = Math.hypot(kandidat.x - x, kandidat.y - y);
				if (!(abstand < toleranz)) { return; }
				if (kandidat.kreuzung) { kreuzung = true; return; }
				const naeher = abstand < besterAbstand
					|| (abstand === besterAbstand && (kandidat.x < bester.x || (kandidat.x === bester.x && kandidat.y < bester.y)));
				if (naeher) { bester = kandidat; besterAbstand = abstand; }
			});
		}
	}
	if (bester) { return bester.name; }
	return kreuzung ? AVESMAPS_WEG_ENDE_KREUZUNG : AVESMAPS_WEG_ENDE_OFFEN;
}

// ── Kartenleser (Browser) ────────────────────────────────────────────────────────────────────────────
// Beide Zwischenspeicher haengen an der Kartenrevision: ein Live-Abgleich oder ein eigenes Speichern hebt
// sie, und dann wird neu gerechnet. Ohne Revision (Besucher ohne Live-Abgleich) an der Datenlaenge.

let avesmapsWegOrtIndexStand = { schluessel: null, index: null };
let avesmapsWegGruppenStand = { schluessel: null, nachId: null, nachKey: null };

function avesmapsWegKartenStand(daten) {
	const revision = typeof mapDataSourceStatus !== "undefined" && mapDataSourceStatus ? mapDataSourceStatus.revision : null;
	return String(revision) + "|" + (Array.isArray(daten) ? daten.length : 0);
}

function avesmapsWegOrtIndexAusKarte() {
	const daten = typeof locationData !== "undefined" && Array.isArray(locationData) ? locationData : [];
	const schluessel = avesmapsWegKartenStand(daten);
	if (avesmapsWegOrtIndexStand.schluessel !== schluessel) {
		avesmapsWegOrtIndexStand = {
			schluessel,
			index: avesmapsWegOrtIndex(daten.map((ort) => ({
				name: ort.name,
				x: Number(ort.coordinates && ort.coordinates[1]),
				y: Number(ort.coordinates && ort.coordinates[0]),
				kreuzung: typeof isCrossingLocation === "function" ? isCrossingLocation(ort) === true : false,
			}))),
		};
	}
	return avesmapsWegOrtIndexStand.index;
}

/** Ein Kartenweg in der Form einer Wege-Editor-Zeile (dieselben Felder, die das Modell liest). */
function avesmapsWegAlsWay(path) {
	const p = (path && path.properties) || {};
	const koordinaten = path && path.geometry && Array.isArray(path.geometry.coordinates) ? path.geometry.coordinates : [];
	let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
	koordinaten.forEach((punkt) => {
		minX = Math.min(minX, punkt[0]); minY = Math.min(minY, punkt[1]);
		maxX = Math.max(maxX, punkt[0]); maxY = Math.max(maxY, punkt[1]);
	});
	const toleranz = typeof LOCATION_ENDPOINT_EXACT_HIT !== "undefined" ? LOCATION_ENDPOINT_EXACT_HIT : 0.01;
	const index = avesmapsWegOrtIndexAusKarte();
	return {
		public_id: typeof getPathPublicId === "function" ? getPathPublicId(path) : String(p.public_id || ""),
		// 💣 Der ECHTE Name (siehe avesmapsWegGruppenSchluessel): properties.name ist der Maschinenname.
		name: String(p.display_name || p.original_name || p.name || ""),
		// 🔴 Daran haengt „ganze Straße" (wpGroupKeyOf, Owner 15.09.2026: „ausdrücklich über den namen"): der Name, den die
		// Infobox als Titel zeigt -- "" fuer einen Maschinennamen. Dieselbe Frage wie avesmapsWegGruppenSchluessel.
		echter_name: getPathTitleName(path),
		feature_subtype: String(p.feature_subtype || ""),
		wiki_path: p.wiki_path || null,
		wiki_path_weitere: Array.isArray(p.wiki_path_weitere) ? p.wiki_path_weitere : [],
		bbox: koordinaten.length ? [minX, minY, maxX, maxY] : null,
		ends: koordinaten.length >= 2 ? { from: koordinaten[0], to: koordinaten[koordinaten.length - 1] } : null,
		enden: koordinaten.length >= 2
			? { von: avesmapsWegEndeName(koordinaten[0], index, toleranz), bis: avesmapsWegEndeName(koordinaten[koordinaten.length - 1], index, toleranz) }
			: null,
	};
}

function avesmapsWegGruppenAufKarte() {
	const daten = typeof pathData !== "undefined" && Array.isArray(pathData) ? pathData : [];
	const schluessel = avesmapsWegKartenStand(daten);
	if (avesmapsWegGruppenStand.schluessel !== schluessel) {
		const nachId = new Map();
		const nachKey = new Map();
		wpGroupWays(daten.map(avesmapsWegAlsWay)).forEach((gruppe) => {
			nachKey.set(gruppe.key, gruppe);
			gruppe.segments.forEach((way, i) => {
				nachId.set(way.public_id, { way, gruppe, nummer: gruppe.segments.length > 1 ? i + 1 : null });
			});
		});
		avesmapsWegGruppenStand = { schluessel, nachId, nachKey };
	}
	return avesmapsWegGruppenStand;
}

function avesmapsWegAbschnittAufKarte(path) {
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	return avesmapsWegGruppenAufKarte().nachId.get(id) || null;
}

function avesmapsWegAbschnittLabelAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? wpAbschnittLabel(abschnitt.way, abschnitt.nummer) : "";
}

function avesmapsWegStreckeAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? wpAbschnittLabel(abschnitt.way, null) : "";
}

function avesmapsWegGanzeStreckeAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? wpGanzeStrecke(abschnitt.gruppe.segments) : "";
}

function avesmapsWegGruppeAufKarte(path) {
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	return abschnitt ? abschnitt.gruppe.segments : [];
}

/**
 * Die Markierungszeile (Markup) fuer diesen Kartenweg und diese Auswahl -- EIN Leser fuer die Infobox
 * (createPathPopupMarkup) und die Zeile oben im Dialog (pathEditUmfangZeigen, review-paths.js).
 * 🔴 Owner 15.09.2026: „was auf keinen fall sein darf: ich klick auf ein segment und da steht "Ganze Straße: Punin – Neil"
 * obwohl ich nur von Kreuzung A zu Kreuzung B markiert habe." Am Abschnitt steht deshalb seine Kurzform MIT Nummer
 * („Abschnitt 4: Helmdahl – Rudein"), an der ganzen Strasse die zwei entferntesten Orte (wpGanzeStrecke). Vorher standen die zwei
 * Faelle in beiden Aufrufern je einmal ausgeschrieben, und der Abschnitt trug keine Nummer.
 */
function avesmapsWegMarkierungszeileAufKarte(path, auswahl) {
	if (!auswahl) { return ""; }
	const abschnitt = avesmapsWegAbschnittAufKarte(path);
	const ganz = auswahl.publicId === null || auswahl.publicId === undefined;
	const strecke = !abschnitt ? "" : (ganz ? wpGanzeStrecke(abschnitt.gruppe.segments) : wpAbschnittLabel(abschnitt.way, null));
	return avesmapsWegMarkierungszeileMarkup(auswahl, strecke, ganz || !abschnitt ? null : abschnitt.nummer);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WEG_ENDE_KREUZUNG, AVESMAPS_WEG_ENDE_OFFEN,
		avesmapsWegOrtIndex, avesmapsWegEndeName, avesmapsWegAlsWay, avesmapsWegKartenStand, avesmapsWegGruppenAufKarte,
		avesmapsWegAbschnittAufKarte, avesmapsWegAbschnittLabelAufKarte, avesmapsWegStreckeAufKarte,
		avesmapsWegGanzeStreckeAufKarte, avesmapsWegGruppeAufKarte, avesmapsWegMarkierungszeileAufKarte,
	};
}
