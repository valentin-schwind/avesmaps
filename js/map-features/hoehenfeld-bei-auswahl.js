/* Ein Klick auf ein Gebirge zeigt sein Relief.
 *
 * 🔴 OWNER 05.09.2026: „kannst du es für editoren (und admins) so machen, dass die relief-karte
 * schon erscheint, wenn man auf ein gebirge klickt (,das eine hat)." Bis dahin hing die
 * Höhenleinwand allein am Eigenschaften-Dialog: `setSolid(true, id)` steht in
 * `openEcosystemPropertiesDialog`, und ohne diesen Dialog zeichnete sie nie.
 *
 * 🔴 ZWEI GRENZEN, BEIDE VOM OWNER GEZOGEN (05.09.2026):
 *   1. NUR in der Ebene „Topographie". In „Alle" und in den übrigen Landschaftsebenen bleibt es aus
 *      -- dort handelt die Ansicht von etwas anderem, und das Relief läge über deren Flächen.
 *   2. NUR Flächen mit GESPEICHERTEM Höhenfeld. Nicht „das gerechnete Feld ist nicht leer": das
 *      kostete je Klick einen Rechenlauf von rund 1,5 s, BEVOR man weiß, ob überhaupt etwas kommt.
 *      Die Auskunft gibt es fertig -- `heightmap_status` liefert je Gebirgsfläche `has_raster`.
 *
 * 🔴 DAS MODUL SCHALTET NUR AUS, WAS ES SELBST EINGESCHALTET HAT (`meineAnzeige`). Der Dialog ist
 * der zweite Besitzer derselben Leinwand; ohne diese Regel nähme ein Klick auf eine Fläche ohne
 * Höhenfeld dem offenen Dialog sein Bild weg, während seine Regler weiter danebenstehen.
 *
 * ⚠️ KEIN eigener Zustand über die Auswahl -- die führt `setSelectedEcosystemArea`
 * (map-features-ecosystem-rendering.js), und von dort kommt der einzige Aufruf. Zwei Zustände über
 * dieselbe Frage laufen auseinander; an genau dem sind in diesem Haus schon das Anzeige-Menü und
 * die Ansichts-Kacheln gescheitert.
 */

// Die Bestandsliste: welche Gebirgsfläche hat ein gespeichertes Höhenfeld?
let hoehenfeldBestand = null;                // Set von public_id, oder null = noch nicht geholt
let hoehenfeldBestandGeholt = 0;             // Zeitstempel des letzten Laufs
let hoehenfeldBestandLaeuft = null;          // die laufende Zusage, damit zwei Klicks eine Anfrage teilen
let meineAnzeige = null;                     // die public_id, die DIESES Modul eingeschaltet hat

// 💣 Eine Fläche, deren Höhenfeld GERADE erzeugt wurde, steht noch nicht in der geholten Liste --
// und ein Editor klickt sie unmittelbar danach an. Deshalb darf ein Fehltreffer die Liste erneuern,
// aber höchstens so oft: sonst kostet jeder Klick auf jede Fläche ohne Höhenfeld eine Anfrage.
const AVESMAPS_HOEHENFELD_BESTAND_TTL_MS = 15000;

function avesmapsHoehenfeldDarfZeigen() {
	// „Editoren und Admins" -- dieselbe Frage, die auch über die Werkzeuge der Ebene entscheidet.
	if (typeof canEditEcosystemOnMap === "function" && !canEditEcosystemOnMap()) {
		return false;
	}
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return false;
	}

	return typeof getActiveEcosystemLayerKind === "function"
		&& getActiveEcosystemLayerKind() === "topographie";
}

// Holt den Bestand höchstens einmal gleichzeitig. Fällt OFFEN aus: ohne Antwort bleibt die Liste
// leer, und dann zeigt ein Klick eben nichts -- nie eine Fehlermeldung auf der Karte.
function avesmapsHoehenfeldBestandHolen() {
	if (hoehenfeldBestandLaeuft) {
		return hoehenfeldBestandLaeuft;
	}
	if (typeof postEcosystemEdit !== "function") {
		hoehenfeldBestand = new Set();

		return Promise.resolve(hoehenfeldBestand);
	}
	hoehenfeldBestandLaeuft = Promise.resolve()
		.then(() => postEcosystemEdit("heightmap_status", {}))
		.then((antwort) => {
			const bestand = new Set();
			for (const eintrag of (antwort && antwort.areas) || []) {
				// ⚠️ `stale` zählt NICHT: ein veraltetes Feld ist ein vorhandenes. Der Klick zeigt
				// ohnehin das frisch gerechnete Relief; die Liste beantwortet nur „hat eins".
				if (eintrag && eintrag.has_raster) { bestand.add(String(eintrag.public_id || "")); }
			}
			hoehenfeldBestand = bestand;
			hoehenfeldBestandGeholt = Date.now();

			return bestand;
		})
		.catch(() => {
			hoehenfeldBestand = hoehenfeldBestand || new Set();
			hoehenfeldBestandGeholt = Date.now();

			return hoehenfeldBestand;
		})
		.then((bestand) => {
			hoehenfeldBestandLaeuft = null;

			return bestand;
		});

	return hoehenfeldBestandLaeuft;
}

function avesmapsHoehenfeldAusschalten() {
	// 🔴 Nur die eigene Anzeige. Was der Dialog eingeschaltet hat, gehört dem Dialog.
	if (meineAnzeige === null) {
		return;
	}
	meineAnzeige = null;
	window.AvesmapsEcosystemHeightRender?.setSolid?.(false);
}

function avesmapsHoehenfeldAnschalten(publicId) {
	meineAnzeige = publicId;
	window.AvesmapsEcosystemHeightRender?.setSolid?.(true, publicId);
}

/**
 * Gerufen aus `setSelectedEcosystemArea` -- und NUR von dort.
 * @param {string} publicId die neu ausgewählte Fläche, "" beim Abwählen
 */
function avesmapsHoehenfeldBeiAuswahl(publicId) {
	const id = String(publicId || "");
	if (!id || !avesmapsHoehenfeldDarfZeigen()) {
		avesmapsHoehenfeldAusschalten();

		return;
	}
	if (hoehenfeldBestand && hoehenfeldBestand.has(id)) {
		avesmapsHoehenfeldAnschalten(id);

		return;
	}
	// Fehltreffer: erst holen, dann noch einmal fragen -- aber die Liste nicht bei jedem Klick.
	if (hoehenfeldBestand && (Date.now() - hoehenfeldBestandGeholt) < AVESMAPS_HOEHENFELD_BESTAND_TTL_MS) {
		avesmapsHoehenfeldAusschalten();

		return;
	}
	void avesmapsHoehenfeldBestandHolen().then((bestand) => {
		// 💣 Die Antwort kommt später als der nächste Klick kommen kann. Angewandt wird sie nur, wenn
		// DIESE Fläche noch ausgewählt ist -- sonst leuchtet das Relief einer Fläche auf, von der der
		// Editor längst weitergeklickt ist.
		const jetzt = typeof getSelectedEcosystemAreaPublicId === "function"
			? String(getSelectedEcosystemAreaPublicId() || "")
			: id;
		if (jetzt !== id || !avesmapsHoehenfeldDarfZeigen()) {
			return;
		}
		if (bestand.has(id)) { avesmapsHoehenfeldAnschalten(id); } else { avesmapsHoehenfeldAusschalten(); }
	});
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsHoehenfeldBeiAuswahl };
}
if (typeof window !== "undefined") {
	window.avesmapsHoehenfeldBeiAuswahl = avesmapsHoehenfeldBeiAuswahl;
}
