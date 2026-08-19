// Die Kachel „Regeln ableiten" im Menüband der Vorkommen.
//
// Sie rechnet aus den beiden Wiki-Infoboxfeldern jedes Eintrags — `|Verbreitung=` (der ORT) und
// `|Vorkommen=`, im Editor „Lebensraum" (die LANDSCHAFTSART) — einen Vorschlag für eine
// Lebensraum-Regel und öffnet damit die Übernahme-Vorschau.
//
// 🔴 SIE SCHREIBT NICHTS. Der Lauf legt einen Plan ab; geschrieben wird ausschließlich, was ein
// Editor in der Vorschau anhäkelt. Ein Lauf, der Regeln ERZEUGT, ist eine Sammelaktion mit
// Entscheidungsgehalt — genau die hat der Owner am 20.07.2026 ausgeschlossen.
//
// 🔴 UND SIE FASST NUR IHRE EIGENEN REGELN AN (`origin = 'wiki_verbreitung'`). Eine von Hand gebaute
// Regel wird nicht gelesen, nicht überschrieben, nicht gelöscht.
//
// Weich/outline wie die Nachbarkachel: die Haupthandlung dieses Fensters bleibt „Vorkommen syncen".
// Messbericht: .superpowers/sdd/2026-08-15-wiki-zuweisung-vereinheitlichung/regeln-ableiten-bericht.md

"use strict";

/**
 * PURE: was in der unteren Zeile der Kachel steht.
 *
 * Hausform „Status IN den Knopf" — dieselbe wie bei „Zugehörigkeit rechnen" nebenan und bei
 * „Dump holen — Lauf: 15.08.".
 *
 * 💣 `-1` HEISST UNBEKANNT und darf nie als „alles gerechnet" gelesen werden. Der Zähler der
 * Nachbarkachel liefert ihn, solange niemand gefragt hat oder der Abruf gescheitert ist; ihn hier
 * als 0 zu behandeln hieße, eine Warnung zu verschlucken, die es vielleicht gäbe.
 *
 * ⚠️ Der ungerechnete Bestand BLOCKIERT nicht — er wird gesagt. Der Fall „die Fläche selbst" kommt
 * ohne `ecosystem_region_overlap` aus; nur der Art-Fall („Wald innerhalb von X") hängt daran. Ein
 * Riegel, der eine gültige Handlung wegen einer fremden Kachel verweigert, erzeugt genau das
 * Rätselraten, das die Nachbarkachel beseitigen sollte.
 *
 * @param {undefined|null|{run:null|{counts:{total:number}}}} plan
 * @param {number} offeneFlaechen -1 = unbekannt
 */
function avesmapsLoreRegelnText(plan, offeneFlaechen) {
	if (plan === undefined) {
		return "wird geprüft …";
	}

	var teile = [];
	if (plan === null) {
		// Gefragt, Abruf gescheitert: lieber schweigen als etwas behaupten.
		teile.push("");
	} else if (plan.run && Number(plan.run.counts && plan.run.counts.total) > 0) {
		var gesamt = Number(plan.run.counts.total);
		teile.push(gesamt === 1 ? "1 Vorschlag offen" : gesamt + " Vorschläge offen");
	} else if (plan.run) {
		teile.push("keine Unterschiede");
	} else {
		teile.push("noch nicht gerechnet");
	}

	if (typeof offeneFlaechen === "number" && offeneFlaechen > 0) {
		teile.push(offeneFlaechen === 1 ? "1 ungerechnet" : offeneFlaechen + " ungerechnet");
	}

	return teile.filter(function (t) { return t !== ""; }).join(" · ");
}

/**
 * PURE: der lange Text am Knopf (title). Er trägt, was die Zeile ellipsiert — die Kachelreihe ist
 * siebenspurig, und `.t2` schneidet ab.
 */
function avesmapsLoreRegelnTitel(offeneFlaechen) {
	var basis = "Leitet aus den Wiki-Feldern „Verbreitung“ und „Vorkommen“ Lebensraum-Regeln ab und"
		+ " zeigt sie als Übernahme-Vorschau. Schreibt NICHTS von selbst und fasst nur eigene,"
		+ " abgeleitete Regeln an — von Hand gebaute bleiben unberührt.";
	if (typeof offeneFlaechen === "number" && offeneFlaechen > 0) {
		return basis + " ⚠ " + offeneFlaechen + " Fläche" + (offeneFlaechen === 1 ? "" : "n")
			+ " ist noch nicht gerechnet — Regeln der Form „Wald innerhalb von X“ treffen dort bis"
			+ " dahin nichts. Erst „Zugehörigkeit rechnen“.";
	}

	return basis;
}

// Der zuletzt geholte Stand. `undefined` = noch nicht gefragt, `null` = gefragt und gescheitert.
var avesmapsLoreRegelnStand;

function avesmapsLoreRegelnPaint() {
	var slot = document.getElementById("lore-regeln-sub");
	var knopf = document.getElementById("lore-regeln-ableiten");
	// ⚠️ Über `window` gerufen, nicht direkt: die Ladereihenfolge der ~117 Skripte in index.html ist
	// ein Vertrag, und ein `typeof` zur AUFRUFZEIT hängt an nichts, was sich beim Umsortieren
	// verschiebt.
	var offen = typeof window.avesmapsLoreZugehoerigkeitOffeneFlaechen === "function"
		? window.avesmapsLoreZugehoerigkeitOffeneFlaechen()
		: -1;
	if (slot) {
		slot.textContent = avesmapsLoreRegelnText(avesmapsLoreRegelnStand, offen);
	}
	if (knopf) {
		knopf.title = avesmapsLoreRegelnTitel(offen);
	}
}

/**
 * Holt den offenen Plan — über DENSELBEN Endpunkt, den die Vorschau selbst benutzt.
 *
 * 💣 Ein Fehlschlag setzt `null`, nie `{}`: „gefragt und gescheitert" ist nicht dasselbe wie „es gibt
 * keinen Plan", und die zweite Lesart stünde als beruhigendes „noch nicht gerechnet" da. Dieselbe
 * Regel wie beim Vertrag der Wiki-Zuweisung: ein leerer Zustand darf nie für eine Aussage gehalten
 * werden.
 */
function avesmapsLoreRegelnRefresh() {
	return fetch("/api/edit/wiki/sync-plan.php", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action: "get", kind: "lore_rule" }),
	}).then(function (response) {
		return response.json().catch(function () { return null; });
	}).then(function (payload) {
		avesmapsLoreRegelnStand = (payload && payload.ok === true) ? payload : null;
		avesmapsLoreRegelnPaint();

		return avesmapsLoreRegelnStand;
	}).catch(function () {
		avesmapsLoreRegelnStand = null;
		avesmapsLoreRegelnPaint();

		return null;
	});
}

// Ein Lauf zur Zeit. Ein Doppelklick ist ein Leerlauf, kein zweiter Lauf.
var avesmapsLoreRegelnLaeuft = false;

/**
 * Den Rechenlauf durchfahren: ein Aufruf je Schritt, der server-gelieferte `cursor` treibt weiter.
 * Spiegelt runWikiSyncLoreSyncLoop, samt dem sauberen Halt an der 409-Sperre.
 */
async function avesmapsLoreRegelnLauf(onProgress) {
	var cursor = "";
	var done = false;
	var sicherung = 0;
	var letzte = null;
	var summe = { planned: 0, processed: 0 };
	var MAX_SCHRITTE = 4000;

	while (!done) {
		if (sicherung > MAX_SCHRITTE) {
			throw new Error("Der Lauf wurde nach zu vielen Teilschritten angehalten.");
		}
		sicherung += 1;

		var schritt = await submitWikiSyncDumpAction("derive_lore_rules", { cursor: cursor });

		// Ein leerer Bestand ist ein Zustand, kein Absturz: dann gibt es schlicht keine Vorkommen.
		if (schritt && schritt.entries_empty === true) {
			throw new Error("Es gibt keine Vorkommen — erst „🚨 Vorkommen syncen“ ausführen.");
		}

		letzte = schritt;
		cursor = String(schritt.cursor != null ? schritt.cursor : cursor);
		summe.planned += Number(schritt.planned || 0);
		summe.processed += Number(schritt.processed || 0);
		done = schritt.done === true;

		var gesamt = Number((schritt.progress && schritt.progress.total) || 0);
		var text = summe.processed + (gesamt > 0 ? "/" + gesamt : "");
		if (typeof onProgress === "function") {
			onProgress(text);
		}
	}

	if (letzte && typeof letzte === "object") {
		letzte.totals = summe;
	}

	return letzte;
}

/** Die untere Zeile der Kachel während des Laufs. Sie ist zugleich der Fortschrittsbalken. */
function avesmapsLoreRegelnSetSub(text) {
	var slot = document.getElementById("lore-regeln-sub");
	if (slot) {
		slot.textContent = text;
	}
}

/** Einstiegspunkt der Kachel. */
async function avesmapsLoreRegelnStarten() {
	if (avesmapsLoreRegelnLaeuft) {
		return;
	}
	avesmapsLoreRegelnLaeuft = true;

	var knopf = document.getElementById("lore-regeln-ableiten");
	if (knopf) {
		knopf.disabled = true;
	}
	avesmapsLoreRegelnSetSub("wird gerechnet …");
	if (typeof window.setLoreDialogStatus === "function") {
		window.setLoreDialogStatus("Regeln werden abgeleitet …", "pending");
	}

	try {
		var ergebnis = await avesmapsLoreRegelnLauf(function (text) {
			avesmapsLoreRegelnSetSub("rechnet … " + text);
		});
		var counts = (ergebnis && ergebnis.counts) || {};
		var gesamt = Number(counts.total || 0);
		var satz = gesamt > 0
			? "Regeln ableiten: " + gesamt + " Vorschläge — Vorschau offen ("
				+ Number(counts.new || 0) + " neu, " + Number(counts.changed || 0) + " geändert, "
				+ Number(counts.deleted || 0) + " zu entfernen)."
			: "Regeln ableiten: nichts Neues abzuleiten.";
		if (typeof window.setLoreDialogStatus === "function") {
			window.setLoreDialogStatus(satz, "success");
		}
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(satz, "success");
		}

		// 🔴 DIE VORSCHAU KOMMT IMMER, auch bei null Unterschieden (Owner 2026-08-07). Ein Fenster,
		// das mal kommt und mal nicht, beantwortet weder „gibt es Arbeit" noch „hat sich etwas getan".
		var runId = Number((ergebnis && ergebnis.run_id) || 0);
		if (runId > 0 && typeof openSyncPlanSheet === "function") {
			openSyncPlanSheet({
				kind: "lore_rule",
				mount: document.getElementById("wikiSyncPlanHost"),
				onApplied: function () {
					// Erst JETZT stehen Regeln in der Datenbank. Beide Listen neu bauen: der Statuskreis
					// eines Eintrags zählt eine Regel mit Verbreitung als gültiges Vorkommen.
					if (typeof loadLoreList === "function") {
						loadLoreList("dialog");
						loadLoreList("panel");
					}
					avesmapsLoreRegelnRefresh();
				},
				onClose: function () {
					avesmapsLoreRegelnRefresh();
				},
			});
		}
		avesmapsLoreRegelnRefresh();
	} catch (error) {
		// 💣 IMMER sichtbar melden. Ein Fehler, den niemand sieht, ist schlimmer als ein lauter --
		// die erste Fassung der Nachbarkachel schwieg genau hier, und der Benutzer sah „nix passiert".
		var meldung = (error && error.message) || "Das Ableiten ist fehlgeschlagen.";
		if (typeof window.setLoreDialogStatus === "function") {
			window.setLoreDialogStatus(meldung, "error");
		}
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(meldung, "warning");
		}
		avesmapsLoreRegelnSetSub("⚠ " + meldung.slice(0, 60));
	} finally {
		avesmapsLoreRegelnLaeuft = false;
		if (knopf) {
			knopf.disabled = false;
		}
	}
}

document.addEventListener("click", function (event) {
	var target = event.target;
	if (!target || typeof target.closest !== "function") {
		return;
	}
	if (!target.closest("#lore-regeln-ableiten")) {
		return;
	}
	void avesmapsLoreRegelnStarten();
});

window.avesmapsLoreRegelnText = avesmapsLoreRegelnText;
window.avesmapsLoreRegelnTitel = avesmapsLoreRegelnTitel;
window.avesmapsLoreRegelnPaint = avesmapsLoreRegelnPaint;
window.avesmapsLoreRegelnRefresh = avesmapsLoreRegelnRefresh;
window.avesmapsLoreRegelnStarten = avesmapsLoreRegelnStarten;
