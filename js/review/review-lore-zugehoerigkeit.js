// Die Kachel „Zugehörigkeit rechnen" im Menüband des Vorkommen-Fensters.
//
// 🔴 SIE RECHNET NICHTS. Der Lauf gehört dem Landschaften-Editor (computeRaycast in
// html/landschaften-editor.html): er lädt alle Flächen, Orte, Wege und Territorien in den Browser,
// verschneidet 929 Regionen gegeneinander und schickt das Ergebnis in Stücken an
// api/edit/map/ecosystem.php. Diese Kachel öffnet sein Fenster -- angehängt, nicht abgeschrieben.
// Ein zweiter Erzeuger derselben Zeilen wäre die zweite Wahrheit, vor der AGENTS.md §5 warnt, und
// er liefe auf STRATO in dieselbe Last, die am 17.07.2026 den PHP-Worker-Pool erschöpft hat.
//
// ⚠️ NIE AUTOMATISCH, NIE BEIM SPEICHERN. Der Owner drückt.
//
// WARUM SIE HIER STEHT: eine Lebensraum-Regel liest „innerhalb" aus `ecosystem_region_overlap`, und
// die entsteht nur bei diesem Lauf. Eine Fläche, die seither gezeichnet wurde, hat dort KEINE Zeile
// und ist für Regeln stumm -- ohne Fehlermeldung, ohne leeres Feld, ohne irgendein Zeichen. Der
// Owner hat am 18.08.2026 eine halbe Stunde daran gesucht, obwohl er den Zusammenhang kannte
// („Gebirge innerhalb von Mittelaventurien" traf 0 Flächen, weil Mittelaventurien neu war).

"use strict";

// PURE: was in der unteren Zeile der Kachel steht.
//
// ⭐ Hausform „Status IN den Knopf" (Owner-Vorliebe, Vorbilder „Dump holen — Lauf: 15.08." und
// „Syncen · Letzte Sync: …"): die Kachel trägt ihren Zustand selbst, statt daneben eine Meldung zu
// setzen. Der Zeitpunkt beruhigt, solange nichts offen ist.
//
// ⚠️ Kein Text bei `undefined` (noch nicht gefragt) und bei `null` (Abruf gescheitert): lieber
// schweigen als etwas behaupten, das nicht geprüft ist -- dieselbe Regel wie
// avesmapsLoreRuleAssignmentStampText, von der diese Funktion die Zustandsfälle übernimmt.
function avesmapsLoreZugehoerigkeitText(response) {
	if (response === undefined) {
		return "wird geprüft …";
	}
	if (response === null) {
		return "";
	}
	var run = response.stamp;
	if (!run) {
		return "noch nie gerechnet";
	}
	// 💣 DIE REIHENFOLGE TRAEGT. Waehrend eines Laufs ist ecosystem_region_overlap LEER
	// (avesmapsPathEcosystemBegin loescht sie, bevor er sie neu fuellt) -- der Zaehler stuende dann
	// auf „929 Flaechen noch nicht gerechnet" und forderte genau den Lauf, der gerade laeuft.
	// Derselbe Grund, aus dem avesmapsLoreRuleAssignmentRunning die Trefferzahlen daneben
	// unterdrueckt: eine echte Null waehrend des Laufs sieht aus wie ein Befund.
	if (!run.completed) {
		return "wird gerade gerechnet …";
	}

	// Der ZAEHLER, sobald er ueber null ist: er sagt, dass etwas zu tun ist, und wie viel.
	// Sonst der ZEITPUNKT -- er beruhigt, statt eine Null zu zeigen (Owner-Wortlaut 19.08.2026).
	var offen = avesmapsLoreZugehoerigkeitOffeneZahl(response);
	if (offen > 0) {
		return offen === 1
			? "1 Fläche noch nicht gerechnet"
			: offen + " Flächen noch nicht gerechnet";
	}

	return "zuletzt " + avesmapsLoreZugehoerigkeitZeit(run.computed_at);
}

// PURE: wie viele Flaechen haben GAR KEINE Ueberlappungszeile -- also: wie viele sind fuer jede
// Lebensraum-Regel stumm? `-1` heisst „unbekannt" (nicht gefragt, Abruf gescheitert, oder eine
// Serverfassung ohne dieses Feld) und ist ausdruecklich NICHT null: „unbekannt" darf nirgends als
// „alles in Ordnung" gelesen werden.
//
// ⭐ Nach aussen gegeben (window.avesmapsLoreZugehoerigkeitOffeneFlaechen), damit eine
// Nachbarkachel im selben Menueband sie mitbenutzen kann, statt dieselbe Abfrage ein zweites Mal zu
// schreiben. Die naechste ist „Regeln ableiten": ein Regelvorschlag auf ungerechnetem Bestand
// erzeugt Regeln, die stumm bleiben -- genau der Fall vom 18.08.2026.
function avesmapsLoreZugehoerigkeitOffeneZahl(response) {
	if (!response || !response.uncomputed || typeof response.uncomputed.count !== "number") {
		return -1;
	}

	return response.uncomputed.count;
}

// Die public_id aller (bis zur Kappung genannten) Flaechen ohne Zeile -- fuer den Hinweis AN DER
// BEDINGUNG im Regeleditor. Leer, solange nichts bekannt ist.
function avesmapsLoreZugehoerigkeitOffeneIds(response) {
	var roh = response && response.uncomputed && response.uncomputed.public_ids;

	return Array.isArray(roh) ? roh : [];
}

// PURE: „19.08.2026, 04:12". Von Hand statt toLocaleString, damit das Format nicht von der
// ICU-Ausstattung der Laufzeit abhängt -- dieselbe Begründung wie avesmapsLoreRuleFormatStamp,
// deren Format hier um das Komma ergänzt ist (der Brief nennt „zuletzt 19.08.2026, 04:12").
function avesmapsLoreZugehoerigkeitZeit(value) {
	var parsed = new Date(String(value || "").replace(" ", "T"));
	if (isNaN(parsed.getTime())) {
		return String(value || "");
	}
	var pad = function (n) { return n < 10 ? "0" + n : String(n); };

	return pad(parsed.getDate()) + "." + pad(parsed.getMonth() + 1) + "." + parsed.getFullYear()
		+ ", " + pad(parsed.getHours()) + ":" + pad(parsed.getMinutes());
}

// Der zuletzt geholte Stand. `undefined` heißt „noch nicht gefragt" und ist NICHT dasselbe wie
// `null` („gefragt, Abruf gescheitert") -- siehe avesmapsLoreZugehoerigkeitText.
var avesmapsLoreZugehoerigkeitStand;

function avesmapsLoreZugehoerigkeitPaint() {
	var slot = document.getElementById("lore-zugehoerigkeit-sub");
	if (!slot) {
		return;
	}
	slot.textContent = avesmapsLoreZugehoerigkeitText(avesmapsLoreZugehoerigkeitStand);
}

// Holt den Stand über DENSELBEN Leser wie der Regeleditor (avesmapsLoreRuleLoadAssignmentStamp,
// js/review/review-lore-rule.js) -- eine zweite fetch-Fassung derselben Aktion wäre die Stelle, an
// der die zwei Anzeigen irgendwann Verschiedenes sagen.
//
// ⚠️ Gerufen wird sie über `window`, nicht direkt: die Ladereihenfolge der ~117 Skripte in
// index.html ist ein Vertrag, und ein `typeof` zur AUFRUFZEIT hängt an nichts, was sich beim
// Umsortieren verschiebt.
function avesmapsLoreZugehoerigkeitRefresh() {
	if (typeof window.avesmapsLoreRuleLoadAssignmentStamp !== "function") {
		return Promise.resolve(null);
	}

	return window.avesmapsLoreRuleLoadAssignmentStamp().then(function (data) {
		avesmapsLoreZugehoerigkeitStand = data;
		avesmapsLoreZugehoerigkeitPaint();

		return data;
	});
}

// 💣 Der Klick öffnet NUR das Fenster. Fehlt der Öffner (eine Seite ohne den Landschaften-Editor),
// bleibt die Kachel wirkungslos statt zu werfen -- aber sie sagt es in der Statuszeile, statt still
// nichts zu tun: ein Knopf, der ohne Zeichen nichts tut, ist schlimmer als keiner.
function avesmapsLoreZugehoerigkeitOeffnen() {
	if (typeof window.openAvesmapsEcosystemEditorOverlay !== "function") {
		if (typeof window.setLoreDialogStatus === "function") {
			window.setLoreDialogStatus("Der Landschaften-Editor ist auf dieser Seite nicht geladen.", "error");
		}
		return false;
	}
	window.openAvesmapsEcosystemEditorOverlay();

	return true;
}

document.addEventListener("click", function (event) {
	var target = event.target;
	if (!target || typeof target.closest !== "function") {
		return;
	}
	if (!target.closest("#lore-zugehoerigkeit")) {
		return;
	}
	avesmapsLoreZugehoerigkeitOeffnen();
});

// Der zuletzt gemessene Stand, fuer Nachbarkacheln im selben Menueband. `-1` = unbekannt.
window.avesmapsLoreZugehoerigkeitOffeneFlaechen = function () {
	return avesmapsLoreZugehoerigkeitOffeneZahl(avesmapsLoreZugehoerigkeitStand);
};
// Dieselbe Auskunft als Liste -- der Regeleditor faerbt damit die einzelne Bedingung.
window.avesmapsLoreZugehoerigkeitOffeneFlaechenIds = function () {
	return avesmapsLoreZugehoerigkeitOffeneIds(avesmapsLoreZugehoerigkeitStand);
};

window.avesmapsLoreZugehoerigkeitText = avesmapsLoreZugehoerigkeitText;
window.avesmapsLoreZugehoerigkeitOffeneZahl = avesmapsLoreZugehoerigkeitOffeneZahl;
window.avesmapsLoreZugehoerigkeitOffeneIds = avesmapsLoreZugehoerigkeitOffeneIds;
window.avesmapsLoreZugehoerigkeitZeit = avesmapsLoreZugehoerigkeitZeit;
window.avesmapsLoreZugehoerigkeitPaint = avesmapsLoreZugehoerigkeitPaint;
window.avesmapsLoreZugehoerigkeitRefresh = avesmapsLoreZugehoerigkeitRefresh;
window.avesmapsLoreZugehoerigkeitOeffnen = avesmapsLoreZugehoerigkeitOeffnen;
