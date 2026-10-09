// Der Anfrage-Umschlag -- EIN Riegel für jede JSON-Anfrage dieser Seite (09.10.2026).
//
// 💣 STRATOs Webserver weist jede JSON-Anfrage mit mehr als 1000 EINZELNEN WERTEN ab -- mit einer
// HTML-Seite „400 Bad Request", bevor PHP sie sieht. Live gemessen: 498 Punkte (996 Zahlen + 4 Felder)
// gehen durch, 499 nicht; die Bytezahl spielt keine Rolle (5 KB mit 1001 Werten scheitern, 85 KB als
// EINE Zeichenkette gehen durch), und es gilt für jeden Endpunkt. Gefunden an Fläche-058 (Discord):
// jede Landschaftsfläche mit mehr als ~498 Ecken liess sich nicht mehr speichern -- und genauso jede
// Herrschaftsgebiets-Grenze, jeder lange Weg, jeder grosse Sammelauftrag.
//
// Abhilfe: die Nutzlast reist als EINE Zeichenkette, `{"avesmaps_umschlag": "<JSON>"}`, und
// avesmapsReadJsonRequest (api/_internal/bootstrap.php) packt sie wieder aus. Der Endpunkt sieht nichts
// davon.
//
// 🔴 WARUM AN `fetch` UND NICHT AN DEN AUFRUFERN. Über 80 Stellen schicken JSON an den Server, verteilt
// über Hauptkarte und Editorfenster. Eine Hilfsfunktion, die jede einzeln rufen muss, bindet genau die,
// an die beim Bauen jemand gedacht hat -- und die nächste fehlt (die Lehre der Verkehrsmittel-Sperre,
// AGENTS.md §11). Hier gilt die Regel für jede Anfrage dieses Dokuments, auch für die, die erst noch
// geschrieben wird.
//
// 🔴 VERPACKT WIRD NUR, WAS DER WEBSERVER SONST ABWIESE (mehr als UMSCHLAG_AB_WERTEN). Jede gewöhnliche
// Anfrage geht Zeichen für Zeichen so hinaus wie vorher. Damit kann der Riegel praktisch nichts
// verschlechtern: fast jede Anfrage, die er anfasst, wäre ohne ihn am Webserver gescheitert -- auch an
// einem Endpunkt, der den Umschlag nicht kennt.
// ⚠️ Die Ausnahme ist das schmale Band zwischen 900 und 1000 Werten (die Luft unten): dort verpackt er
// eine Anfrage, die auch unverpackt durchgekommen wäre. An einem Endpunkt mit Auspacker ist das gleich;
// das Maskieren der Anführungszeichen macht den Rumpf nur etwas länger, was knapp unter 128 KiB den
// Ausschlag geben könnte.
//
// ⚠️ Gegen die zweite Grenze hilft er nicht: über rund 128 KiB je Anfrage antwortet der Webserver 413,
// verpackt oder nicht.
// ⚠️ Gefasst wird nur `fetch` mit einer Zeichenkette als Rumpf, Methode POST, `Content-Type:
// application/json` und einem Ziel unter `/api/` DIESER Herkunft. `navigator.sendBeacon`, Formulare
// und fremde Adressen bleiben unberührt.
//
// 💣 JEDES DOKUMENT BRAUCHT DIESE DATEI SELBST, und zwar vor dem ersten Skript, das etwas schickt. Die
// Editorfenster sind eigene iframe-Dokumente mit eigenem `fetch`; js/app/__tests__/json-umschlag.test.js
// zählt nach, dass jede Seite mit einem POST sie lädt.
(function avesmapsJsonUmschlagModul(global) {
	"use strict";

	// Der Webserver nimmt 1000; 100 Werte Luft, weil niemand weiss, ob er leere Behälter mitzählt.
	const UMSCHLAG_AB_WERTEN = 900;
	const UMSCHLAG_SCHLUESSEL = "avesmaps_umschlag";

	// Zählt die EINZELWERTE (Zahl, Zeichenkette, true/false/null, leerer Behälter) -- das, was der
	// Webserver zählt: 996 Zahlen + 4 Felder gingen durch, obwohl dabei 500 Arrays mitreisten.
	// Hört auf, sobald `grenze` überschritten ist -- mehr muss niemand wissen.
	function zaehleWerte(wert, grenze) {
		let anzahl = 0;
		const stapel = [wert];
		while (stapel.length > 0 && anzahl <= grenze) {
			const aktuell = stapel.pop();
			if (aktuell !== null && typeof aktuell === "object") {
				const kinder = Array.isArray(aktuell) ? aktuell : Object.values(aktuell);
				if (kinder.length === 0) {
					anzahl += 1;
				}
				for (let i = 0; i < kinder.length; i += 1) {
					stapel.push(kinder[i]);
				}
			} else {
				anzahl += 1;
			}
		}
		return anzahl;
	}

	// Rumpf hinein, Rumpf hinaus: verpackt, wenn er zu viele Werte trägt, sonst UNVERÄNDERT dieselbe
	// Zeichenkette.
	function avesmapsJsonUmschlagRumpf(rumpf) {
		// Schneller Ausgang: mehr als 900 Werte brauchen mindestens 1800 Zeichen (Wert plus Trenner).
		// Die allermeisten Anfragen werden damit nicht einmal geparst.
		if (typeof rumpf !== "string" || rumpf.length < UMSCHLAG_AB_WERTEN * 2) {
			return rumpf;
		}
		let daten;
		try {
			daten = JSON.parse(rumpf);
		} catch (fehler) {
			return rumpf; // kein JSON -- nicht unsere Sache
		}
		if (!daten || typeof daten !== "object" || Array.isArray(daten)) {
			return rumpf; // der Server packt nur ein OBJEKT aus
		}
		// Ein schon verpackter Rumpf ist EIN Wert und bleibt damit von selbst hier stehen -- eine eigene
		// Prüfung darauf wäre toter Code (Mutationsprobe 09.10.2026).
		if (zaehleWerte(daten, UMSCHLAG_AB_WERTEN) <= UMSCHLAG_AB_WERTEN) {
			return rumpf;
		}
		// Die Zeichenkette selbst wandert hinein, nicht ein neu serialisiertes Objekt: der Server bekommt
		// Zeichen für Zeichen, was der Aufrufer geschrieben hat.
		return JSON.stringify({ [UMSCHLAG_SCHLUESSEL]: rumpf });
	}

	function inhaltsArt(kopf) {
		if (!kopf) {
			return "";
		}
		if (typeof kopf.get === "function") {
			return String(kopf.get("Content-Type") || "");
		}
		const paare = Array.isArray(kopf) ? kopf : Object.entries(kopf);
		const treffer = paare.find((paar) => String(paar[0]).toLowerCase() === "content-type");
		return treffer ? String(treffer[1] || "") : "";
	}

	function zielIstUnsereApi(adresse, fenster) {
		try {
			const basis = fenster && fenster.location ? fenster.location.href : undefined;
			const ziel = new URL(String(adresse), basis);
			const herkunft = fenster && fenster.location ? fenster.location.origin : ziel.origin;
			return ziel.origin === herkunft && ziel.pathname.indexOf("/api/") >= 0;
		} catch (fehler) {
			return false;
		}
	}

	// Ändert NUR den Rumpf, und nur, wenn alles passt. Gibt die Optionen unverändert zurück, sonst eine
	// Kopie -- das Objekt des Aufrufers wird nie angefasst.
	function avesmapsJsonUmschlagOptionen(eingabe, optionen, fenster) {
		// Ein `Request`-Objekt als Eingabe trägt seinen Rumpf selbst und lässt sich nicht umschreiben --
		// es geht unverändert durch (im Haus benutzt das niemand).
		const adresseIstText = typeof eingabe === "string" || (typeof URL === "function" && eingabe instanceof URL);
		if (!optionen || typeof optionen.body !== "string" || !adresseIstText) {
			return optionen;
		}
		if (String(optionen.method || "GET").toUpperCase() !== "POST") {
			return optionen;
		}
		if (inhaltsArt(optionen.headers).toLowerCase().indexOf("application/json") < 0) {
			return optionen;
		}
		if (!zielIstUnsereApi(eingabe, fenster)) {
			return optionen;
		}
		const rumpf = avesmapsJsonUmschlagRumpf(optionen.body);
		return rumpf === optionen.body ? optionen : Object.assign({}, optionen, { body: rumpf });
	}

	function avesmapsJsonUmschlagInstallieren(fenster) {
		if (!fenster || typeof fenster.fetch !== "function" || fenster.__avesmapsJsonUmschlag) {
			return false;
		}
		const original = fenster.fetch;
		fenster.fetch = function avesmapsFetchMitUmschlag(eingabe, optionen) {
			return original.call(this, eingabe, avesmapsJsonUmschlagOptionen(eingabe, optionen, fenster));
		};
		// Zweimal geladen (Hauptkarte und eingebettete Seite teilen sich kein `window`, aber dieselbe
		// Seite kann die Datei zweimal einbinden) darf nicht zweimal umhüllen.
		fenster.__avesmapsJsonUmschlag = true;
		return true;
	}

	avesmapsJsonUmschlagInstallieren(global);

	if (typeof module !== "undefined" && module.exports) {
		module.exports = {
			UMSCHLAG_AB_WERTEN,
			zaehleWerte,
			avesmapsJsonUmschlagRumpf,
			avesmapsJsonUmschlagOptionen,
			avesmapsJsonUmschlagInstallieren,
		};
	}
})(typeof window !== "undefined" ? window : undefined);
