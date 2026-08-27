// Der Ablageort der Kartennutzlast -- die zweite Haelfte des ETag-Wegs.
//
// 🔴 WARUM ES DIESE DATEI GIBT. `api/app/map-features.php` beantwortet bedingte Anfragen seit
// Monaten korrekt: `If-None-Match` mit dem passenden Tag ergibt 304 und null Bytes. Erreichbar war
// dieser Riegel fuer einen echten Browser trotzdem nie, aus zwei Gruenden hintereinander:
//   (1) STRATOs Zwischenschicht entfernt den `ETag` aus jeder rumpftragenden Antwort. Die einzige
//       Antwort, die ihn traegt, ist die 304 -- und die bekommt man erst, wenn man ihn schon hat.
//       Dagegen steht `X-Avesmaps-ETag`; `X-`-Koepfe ueberleben die 200 nachweislich.
//   (2) Der HTTP-Cache des Browsers revalidiert NICHT ueber `X-`-Koepfe. Er kennt nur `ETag`, und
//       den sieht er nie. Also muss der Client Nutzlast und Tag SELBST ablegen und `If-None-Match`
//       von Hand setzen. Genau das tut diese Datei.
// Gemessen am 27.08.2026 an der echten 200: `etag` fehlt, `x-avesmaps-etag` ist da.
// 🪤 Und die Messung dazu hat eine Falle: liest man den Kopf aus einer Antwort, die der Browser aus
// seinem EIGENEN Cache beantwortet hat, steht `ETag` sehr wohl da -- er stammt dann aus einer
// frueheren 304. Nur eine Anfrage mit `cache: "no-store"` misst, was wirklich ueber die Leitung kam.
//
// 💣 ABGELEGT WIRD DIE ZEICHENKETTE, NICHT DAS GEPARSTE OBJEKT -- und das ist gemessen, nicht
// geraten (27.08.2026, 20,3 MB / 12.149 Merkmale, im Browser gegen die Live-Nutzlast):
//   Lesen  Zeichenkette 30,5 ms + JSON.parse 77,1 ms = 107,6 ms  |  Objekt 83,8 ms
//   Ablegen Zeichenkette 37,1 ms                                 |  Objekt 67,1 ms
// Das Objekt liest sich also 24 ms schneller und legt sich 30 ms langsamer ab. 24 ms sind gegen die
// rund 2 s, die der ganze Umbau spart, Rauschen -- und dafuer ist die Zeichenkette an zwei Stellen
// die sichere Wahl: sie ist UNVERAENDERLICH (das geparste Objekt wird noch im selben Zug um
// `avesmapsSource` erweitert und danach durch die ganze Hydrierung gereicht, eine spaeter gezogene
// strukturierte Kopie truege also einen anderen Stand als der Server geschickt hat), und ein
// beschaedigter Eintrag scheitert laut an `JSON.parse` statt still an einem halben Objekt.
//
// 🔴 NUR DIE OEFFENTLICHE FASSUNG. Im Bearbeiten-Modus wird nichts abgelegt und nichts gelesen:
// dort holt der Live-Abgleich ohnehin staendig Deltas, die Nutzlast wechselt im Minutentakt, und
// ein zurueckgehaltener Editor-Stand ist genau die Stoerung („meine Aenderung kommt nicht an"), die
// dieses Projekt schon mehrfach bezahlt hat. Der Gewinn gehoert den wiederkehrenden BESUCHERN.
//
// ⚠️ ALLES HIER FAELLT OFFEN AUS. Kein IndexedDB (privates Fenster, abgeschaltete Speicherung),
// volles Kontingent, beschaedigter Eintrag, Ausnahme irgendwo dazwischen -- jeder dieser Faelle
// endet in „nichts gespeichert" und damit im normalen Vollabruf. Eine kaputte Karte waere schlimmer
// als eine langsame; deshalb lehnt hier KEINE Zusage ab, sie loest mit `null`/`false` auf.

// 💣 DIESE ZEICHENKETTE STEHT EIN ZWEITES MAL IM KOPF VON index.html, und das ist tragend.
// Das Vorabruf-Skript dort muss SYNCHRON entscheiden, ob es den Vorabruf ueberhaupt anmeldet (siehe
// avesmapsKartendatenTagLesen), und es laeuft, lange bevor irgendein Skript geladen ist. Es kann
// diese Konstante also nicht lesen. Wer den Schluessel hier umbenennt, muss ihn dort mitnehmen --
// sonst meldet der Kopf weiter einen Vorabruf an, den die bedingte Anfrage danach verfehlt, und die
// Nutzlast reist ZWEIMAL. Festgenagelt von js/app/__tests__/kartendaten-speicher.test.js.
const AVESMAPS_KARTENDATEN_TAG_SCHLUESSEL = "avesmaps.kartendaten.etag";
const AVESMAPS_KARTENDATEN_DB = "avesmaps-kartendaten";
const AVESMAPS_KARTENDATEN_LAGER = "nutzlast";
const AVESMAPS_KARTENDATEN_EINTRAG = "map-features";
// Die Form des Eintrags, nicht die der Nutzlast. Die Nutzlast ist ueber den Tag versioniert
// (AVESMAPS_MAP_FEATURES_PAYLOAD_VERSION steckt darin); was hier steht, faengt den anderen Fall ab:
// wenn diese Datei je etwas ANDERES ablegt als `{ tag, text }`. Ein alter Eintrag gilt dann als
// Fehlschlag statt als Treffer mit falschem Inhalt.
const AVESMAPS_KARTENDATEN_FORM = 1;

// Der gemerkte Tag, SYNCHRON. Er liegt in localStorage und nicht in IndexedDB, weil genau ein
// Leser ihn synchron braucht: das Vorabruf-Skript im Kopf von index.html. Die Nutzlast bleibt in
// IndexedDB -- 20 MB gehoeren nicht in localStorage, und die Grenze dort liegt bei ~5 MB.
function avesmapsKartendatenTagLesen() {
	try {
		return String(globalThis.localStorage.getItem(AVESMAPS_KARTENDATEN_TAG_SCHLUESSEL) || "");
	} catch (fehler) {
		return "";
	}
}

function avesmapsKartendatenDbOeffnen() {
	return new Promise((aufloesen) => {
		let anfrage;
		try {
			anfrage = globalThis.indexedDB.open(AVESMAPS_KARTENDATEN_DB, 1);
		} catch (fehler) {
			aufloesen(null);
			return;
		}
		if (!anfrage) {
			aufloesen(null);
			return;
		}
		anfrage.onupgradeneeded = () => {
			try {
				anfrage.result.createObjectStore(AVESMAPS_KARTENDATEN_LAGER);
			} catch (fehler) {
				/* existiert schon */
			}
		};
		anfrage.onsuccess = () => aufloesen(anfrage.result || null);
		anfrage.onerror = () => aufloesen(null);
		// Ein privates Fenster kann die Datenbank blockieren, statt zu scheitern -- dann kommt weder
		// onsuccess noch onerror, und ohne diesen Zweig haengt der ganze Kartenaufbau an einer
		// Zusage, die nie aufloest.
		anfrage.onblocked = () => aufloesen(null);
	});
}

// Die abgelegte Nutzlast, wenn sie zu DIESEM Tag gehoert. Sonst null.
//
// 💣 DER TAG WIRD GEGENGEPRUEFT, nicht geglaubt. localStorage und IndexedDB sind zwei Speicher, und
// sie koennen auseinanderlaufen (eines geraeumt, das andere nicht). Ohne diesen Vergleich haengte
// eine 304 fuer Tag A eine Nutzlast von Tag B in die Karte -- ein stiller falscher Weltstand, der
// sich nicht von selbst heilt, weil map_revision sich ohne Bearbeitung nicht bewegt.
function avesmapsKartendatenLesen(tag) {
	if (!tag) {
		return Promise.resolve(null);
	}
	return avesmapsKartendatenDbOeffnen().then((db) => {
		if (!db) {
			return null;
		}
		return new Promise((aufloesen) => {
			let abfrage;
			try {
				const geschaeft = db.transaction(AVESMAPS_KARTENDATEN_LAGER, "readonly");
				abfrage = geschaeft.objectStore(AVESMAPS_KARTENDATEN_LAGER).get(AVESMAPS_KARTENDATEN_EINTRAG);
			} catch (fehler) {
				aufloesen(null);
				return;
			}
			abfrage.onerror = () => aufloesen(null);
			abfrage.onsuccess = () => {
				const eintrag = abfrage.result;
				if (!eintrag || eintrag.form !== AVESMAPS_KARTENDATEN_FORM || eintrag.tag !== tag || typeof eintrag.text !== "string") {
					aufloesen(null);
					return;
				}
				aufloesen(eintrag.text);
			};
		}).then((text) => {
			try {
				db.close();
			} catch (fehler) {
				/* egal */
			}
			if (typeof text !== "string" || text === "") {
				return null;
			}
			try {
				return JSON.parse(text);
			} catch (fehler) {
				// Halber Eintrag (Kontingent waehrend des Schreibens erschoepft, Abbruch). Er ist
				// wertlos und wuerde bei jedem Start erneut gelesen -- also weg damit.
				avesmapsKartendatenVergessen();
				return null;
			}
		});
	}).catch(() => null);
}

// Legt Nutzlast und Tag ab. Loest mit `true` auf, wenn beides steht.
//
// 🔴 DER TAG IN localStorage KOMMT ZULETZT, und das ist die Regel, die den Vorabruf ehrlich haelt.
// Das Skript im Kopf von index.html liest allein diesen Tag und schliesst daraus „ich habe eine
// Kopie, ich brauche keinen Vorabruf". Stuende der Tag da, waehrend die Nutzlast fehlt, unterbliebe
// der Vorabruf UND die bedingte Anfrage liefe ins Leere -- der schlechteste aller Faelle.
function avesmapsKartendatenAblegen(tag, text) {
	if (!tag || typeof text !== "string" || text === "") {
		return Promise.resolve(false);
	}
	return avesmapsKartendatenDbOeffnen().then((db) => {
		if (!db) {
			return false;
		}
		return new Promise((aufloesen) => {
			let geschaeft;
			try {
				geschaeft = db.transaction(AVESMAPS_KARTENDATEN_LAGER, "readwrite");
				geschaeft.objectStore(AVESMAPS_KARTENDATEN_LAGER).put({ form: AVESMAPS_KARTENDATEN_FORM, tag, text }, AVESMAPS_KARTENDATEN_EINTRAG);
			} catch (fehler) {
				aufloesen(false);
				return;
			}
			// ⚠️ `oncomplete` und nicht `onsuccess` der einzelnen Ablage: erst der Abschluss des
			// Geschaefts sagt, dass die Bytes wirklich liegen. Ein volles Kontingent schlaegt genau
			// hier zu (`onabort`), nachdem `put` laengst erfolgreich aussah.
			geschaeft.oncomplete = () => aufloesen(true);
			geschaeft.onerror = () => aufloesen(false);
			geschaeft.onabort = () => aufloesen(false);
		}).then((geschafft) => {
			try {
				db.close();
			} catch (fehler) {
				/* egal */
			}
			if (!geschafft) {
				return false;
			}
			try {
				globalThis.localStorage.setItem(AVESMAPS_KARTENDATEN_TAG_SCHLUESSEL, tag);
			} catch (fehler) {
				// Die Nutzlast liegt, der Zeiger darauf nicht -- also gibt es sie fuer den naechsten
				// Start nicht. Kein Schaden, nur kein Gewinn.
				return false;
			}
			return true;
		});
	}).catch(() => false);
}

// Wirft beides weg. Wird gerufen, wenn der Speicher den Tag nicht einloesen konnte -- dann ist der
// gemerkte Tag eine Luege, und die naechste Anfrage soll wieder voll und mit Vorabruf laufen.
function avesmapsKartendatenVergessen() {
	try {
		globalThis.localStorage.removeItem(AVESMAPS_KARTENDATEN_TAG_SCHLUESSEL);
	} catch (fehler) {
		/* egal */
	}
	return avesmapsKartendatenDbOeffnen().then((db) => {
		if (!db) {
			return false;
		}
		return new Promise((aufloesen) => {
			try {
				const geschaeft = db.transaction(AVESMAPS_KARTENDATEN_LAGER, "readwrite");
				geschaeft.objectStore(AVESMAPS_KARTENDATEN_LAGER).delete(AVESMAPS_KARTENDATEN_EINTRAG);
				geschaeft.oncomplete = () => aufloesen(true);
				geschaeft.onerror = () => aufloesen(false);
				geschaeft.onabort = () => aufloesen(false);
			} catch (fehler) {
				aufloesen(false);
			}
		}).then((erledigt) => {
			try {
				db.close();
			} catch (fehler) {
				/* egal */
			}
			return erledigt;
		});
	}).catch(() => false);
}

// Ablegen, wenn der Hauptthread nichts Besseres zu tun hat.
//
// 💣 NIE AUF DEM KRITISCHEN WEG. Der Aufruf faellt beim KALTEN Start an -- genau dann, wenn die
// Karte aus 12.149 Merkmalen gebaut wird und jede Millisekunde sichtbar ist. Gemessen kostet die
// Ablage 37 ms; hineingelegt zwischen Antwort und Hydrierung waeren das 37 ms geschenkte
// Verzoegerung fuer einen Gewinn, den erst der NAECHSTE Besuch einloest.
// ⚠️ `requestIdleCallback` mit Frist: in einem versteckten Tab kommt der Leerlauf sonst nie, und
// dann legt ausgerechnet der Besucher nichts ab, der die Seite im Hintergrund geoeffnet hat.
function avesmapsKartendatenSpaeterAblegen(tag, text) {
	const tun = () => {
		avesmapsKartendatenAblegen(tag, text);
	};
	try {
		if (typeof globalThis.requestIdleCallback === "function") {
			globalThis.requestIdleCallback(tun, { timeout: 8000 });
			return;
		}
	} catch (fehler) {
		/* faellt auf den Zeitgeber zurueck */
	}
	setTimeout(tun, 0);
}

if (typeof module === "object" && module.exports) {
	module.exports = {
		AVESMAPS_KARTENDATEN_TAG_SCHLUESSEL,
		avesmapsKartendatenTagLesen,
		avesmapsKartendatenLesen,
		avesmapsKartendatenAblegen,
		avesmapsKartendatenVergessen,
		avesmapsKartendatenSpaeterAblegen,
	};
}
