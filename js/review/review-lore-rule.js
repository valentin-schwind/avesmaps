// ---- Regelkarten in der Vorkommen-Liste (Lebensraum-Regel, Sitzung 2 Task 5) -----------------------
//
// Rein LESEND: eine gespeicherte Regel als deutscher Satz und als Karte, gleichrangig neben den
// Ortskarten derselben Liste (js/review/review-wiki-sync.js, Suchbegriff "lore-detail__places").
// Anlegen/Ändern/Löschen kommt in Task 6 -- hier wird nur gezeigt, was
// api/edit/map/lore.php (action "list_rules") bereits liefert: [{ id, relation, terms: [...] }],
// jede Bedingung als { join_op, area_public_id, area_name, climate_from, climate_to, types }.
//
// 💣 KEINE Beschriftungsliste der Landschaftsarten in dieser Datei (AGENTS.md §12 -- „nichts
// doppelt pflegen"). Nachgesehen für Schritt 5 des Aufgabenzettels: weder api/app/map-features.php
// noch die Antwort von "list_rules" liefern eine Art-Beschriftung mit; der einzige Katalog dafür
// (ecosystem_region_type.label) reist heute NUR je Fläche eingebettet (api/app/ecosystem-areas.php,
// Feld region_type_label) oder über den editor-eigenen, rechtegebundenen "list_regions"-Aufruf --
// beides zu schwer für eine reine Anzeigekarte, und api/ darf diese Aufgabe nicht anfassen. Bis eine
// spätere Aufgabe (Task 6 braucht den echten Katalog ohnehin für seine Auswahlliste) eine schmale
// Quelle dafür nachliefert, leitet avesmapsLoreRuleHumanizeTypeKey() die Beschriftung TEXTUELL aus
// dem stabilen Schlüssel her (derselbe ASCII-Fold wie beim Schlüssel selbst, AGENTS.md §5) -- keine
// Tabelle, die veralten könnte, weil sie keinen einzigen Schlüssel im Voraus kennt. Für eine bewusst
// UMBENANNTE Beschriftung (Präzedenzfall "trockene_subtropen" -> "Subtropische Steppenzone",
// api/_internal/app/ecosystem.php:198-204) liest sich das nicht falsch, nur nicht so schön wie das
// Original -- besser als ein roher Schlüssel in der Liste.
//
// Klimazonen-Beschriftungen dagegen haben bereits einen echten, ungeteilten Katalog:
// avesmapsClimateZoneLabels (js/map-features/map-features-climate-row.js), gefüllt aus dem
// Kartenpayload (climate_zones) über avesmapsClimateSetVocabulary(). Der Aufrufer in
// review-wiki-sync.js reicht ihn als zoneLabels durch -- diese Datei baut dafür keinen zweiten.

"use strict";

var AVESMAPS_LORE_RULE_ENDPOINT = "api/edit/map/lore.php";

// Modulzustand: die zuletzt geladenen Regeln EINES Eintrags. Ein Neuaufbau der Detailmaske (etwa
// nach dem Hinzufügen eines Ortes, dessen Antwort nur `entry` trägt, keine Regeln) braucht dadurch
// keinen zweiten Abruf, solange der offene Eintrag derselbe bleibt.
var avesmapsLoreRuleModuleState = { wikiKey: "", rules: [] };

// Die zuletzt geladenen Regeln des angegebenen Eintrags -- leer, wenn keine geladen sind oder ein
// ANDERER Eintrag inzwischen offen ist (kein Zeigen fremder Regeln beim schnellen Weiterklicken).
function avesmapsLoreRuleCurrent(wikiKey) {
	return avesmapsLoreRuleModuleState.wikiKey === wikiKey ? avesmapsLoreRuleModuleState.rules : [];
}

// Holt alle Regeln eines Eintrags (POST list_rules) und legt sie im Modulzustand ab. Liefert sie
// zusätzlich als Promise, damit der Aufrufer im selben Zug weiterrendern kann. Ein Netzfehler, ein
// 401 (nicht angemeldet) oder eine unerwartete Antwortform enden in einer LEEREN Liste, nie in einem
// Wurf -- eine kaputt gelesene Regelzeile darf die Ortsliste daneben nicht mit reissen.
function avesmapsLoreRuleLoad(wikiKey) {
	if (!wikiKey) {
		avesmapsLoreRuleModuleState = { wikiKey: "", rules: [] };
		return Promise.resolve([]);
	}
	return fetch(AVESMAPS_LORE_RULE_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json", Accept: "application/json" },
		body: JSON.stringify({ action: "list_rules", wiki_key: wikiKey }),
	})
		.then(function (response) { return response.json(); })
		.catch(function () { return null; })
		.then(function (data) {
			var rules = (data && data.ok === true && Array.isArray(data.rules)) ? data.rules : [];
			avesmapsLoreRuleModuleState = { wikiKey: wikiKey, rules: rules };
			return rules;
		});
}

// ---- Beschriftung einer Landschaftsart ohne echten Katalog (siehe Dateikopf) -----------------------
// "wald" -> "Wald" · "suempfe_moore" -> "Sümpfe und Moore" · "gebirge" -> "Gebirge". Falzt denselben
// ue/oe/ae-ASCII-Ersatz zurück, den der Schlüssel selbst schon trägt (AGENTS.md §5), und macht den
// Unterstrich als "und" lesbar. Kein Zugriff auf irgendeine Artenliste -- rein textuell.
function avesmapsLoreRuleHumanizeTypeKey(rawKey) {
	var words = String(rawKey || "").split("_").filter(Boolean);
	if (!words.length) {
		return "";
	}
	return words
		.map(function (word) {
			var unfolded = word.replace(/ue/g, "ü").replace(/oe/g, "ö").replace(/ae/g, "ä");
			return unfolded.charAt(0).toUpperCase() + unfolded.slice(1);
		})
		.join(" und ");
}

// Eine Klimazonen-Beschriftung: der echte Katalog (zoneLabels, siehe Dateikopf) geht vor, der
// Textumbau ist nur der Rückfall für einen Schlüssel, den der Aufrufer (noch) nicht kennt.
function avesmapsLoreRuleZoneLabel(zoneKey, zoneLabels) {
	if (!zoneKey) {
		return "";
	}
	return (zoneLabels && zoneLabels[zoneKey]) || avesmapsLoreRuleHumanizeTypeKey(zoneKey);
}

// ---- Satzbauer (rein) --------------------------------------------------------------------------------
//
// Je Bedingung, untereinander immer UND: Flächenname ("X heißt"), Landschaftsarten ("A oder B ist",
// mehrere = ODER), Klimaspanne ("im Klima X liegt" bzw. "im Klima zwischen X und Y liegt" -- nie bei
// gleichem Anfang und Ende). Folgt docs/vorkommen-regeleditor-mockup.html Zeilen 748-766.
function avesmapsLoreRuleTermSentence(term, zoneLabels) {
	var bits = [];

	var areaName = String((term && term.area_name) || "").trim();
	if (areaName) {
		bits.push("<b>" + escapeHtml(areaName) + "</b> heißt");
	}

	var types = (term && Array.isArray(term.types)) ? term.types : [];
	if (types.length) {
		var typeLabels = types.map(function (type) {
			return escapeHtml(avesmapsLoreRuleHumanizeTypeKey(String((type && type.region_type) || "")));
		});
		bits.push("<b>" + typeLabels.join("</b> oder <b>") + "</b> ist");
	}

	var climateFrom = (term && term.climate_from) || null;
	var climateTo = (term && term.climate_to) || null;
	if (climateFrom && climateTo) {
		var fromLabel = escapeHtml(avesmapsLoreRuleZoneLabel(climateFrom, zoneLabels));
		var toLabel = escapeHtml(avesmapsLoreRuleZoneLabel(climateTo, zoneLabels));
		bits.push(climateFrom === climateTo
			? "im Klima <b>" + fromLabel + "</b> liegt"
			: "im Klima zwischen <b>" + fromLabel + "</b> und <b>" + toLabel + "</b> liegt");
	}

	return bits.length ? bits.join(" und ") : "alles";
}

// Der ganze Satz einer Regel. Rein: kein DOM-, kein Netzzugriff. Eine Regel ohne Bedingungen wirft
// nicht -- der Server lässt sie zwar nicht speichern (AGENTS.md, "leere Regel gibt es nicht"), aber
// eine kaputt gelesene Zeile darf die Karte trotzdem noch zeigen statt die ganze Liste abzureissen.
function avesmapsLoreRuleSentence(rule, zoneLabels) {
	var terms = (rule && Array.isArray(rule.terms)) ? rule.terms : [];
	if (!terms.length) {
		return "Die Regel liest sich: etwas, das alles ist.";
	}

	var parts = terms.map(function (term) { return avesmapsLoreRuleTermSentence(term || {}, zoneLabels); });
	var sentence = parts[0];
	for (var i = 1; i < parts.length; i++) {
		var joinWord = terms[i] && terms[i].join_op === "oder" ? "oder" : "und";
		sentence += " <b>" + joinWord + "</b> " + parts[i];
	}
	return "Die Regel liest sich: etwas, das " + sentence + ".";
}

// ---- Markup: eine Regelkarte, gleichrangig mit einer Ortskarte ---------------------------------------
//
// 💣 Klassen tragen das Präfix der Ortsliste (lore-detail__*), nicht rule__* wie im Mockup -- die
// Karte gehört zu ihren Nachbarn in derselben <ul class="lore-detail__places">, nicht in einen
// eigenen Abschnitt (Brief Schritt 1). .lore-detail__pill ist dieselbe Pille wie bei einer Ortskarte
// ("Wiki"/"manuell"), hier ohne is-manual: eine Regel hat keine Wiki-Herkunft, jede ist von Hand
// angelegt -- das Etikett würde auf jeder Karte stehen und nichts mehr unterscheiden.
function avesmapsLoreRuleCardMarkup(rule, zoneLabels) {
	var sentence = avesmapsLoreRuleSentence(rule, zoneLabels);
	var termCount = (rule && Array.isArray(rule.terms)) ? rule.terms.length : 0;
	var countLabel = termCount === 1 ? "1 Bedingung" : termCount + " Bedingungen";

	return '<li class="lore-detail__rule">'
		+ '<div class="lore-detail__rule-main">'
		+ '<span class="lore-detail__pill">Regel</span>'
		+ '<p class="lore-detail__rule-sentence">' + sentence + "</p>"
		+ '<span class="lore-detail__rule-meta">' + escapeHtml(countLabel) + "</span>"
		+ "</div>"
		+ "</li>";
}

// Node export (inert im Browser, siehe js/app/utils.js) -- nur damit ein Test die echte Fassung
// prüfen kann statt eine nachgetippte.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsLoreRuleSentence: avesmapsLoreRuleSentence,
		avesmapsLoreRuleCardMarkup: avesmapsLoreRuleCardMarkup,
		avesmapsLoreRuleHumanizeTypeKey: avesmapsLoreRuleHumanizeTypeKey,
	};
}
