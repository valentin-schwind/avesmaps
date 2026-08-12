// Der Deckel — EIN Bauteil für jede lange Angabe in einer Infobox-Zelle.
// Entwurf: docs/superpowers/specs/2026-08-12-infobox-deckel-design.md · Stil: css/components/infobox-lid.css
//
// 🔴 EIN BAUTEIL, VIELE ZEILEN. „Verlauf" am Weg und Waren/Fauna/Flora an fünf Oberflächen brauchen
// dasselbe: eindampfen, eine Fußzeile mit einem Satz, auf Klick aufklappen. Zwei eigene Bauer sähen
// am Anfang gleich aus und wären nach dem zweiten Feinschliff zwei verschiedene Deckel — genau so
// sind Infobox und Routenplaner einmal auseinandergelaufen (AGENTS.md §12).
//
// 💣 NATIVES <details>, kein selbstgebautes Klappen. Der Grund ist die Seitensuche: Strg+F findet
// Text in einem ZUgeklappten <details> und klappt es selbst auf; ein „aufgeklappt"-Zustand aus
// display:none/hidden nähme ihr den Text weg. Fokus, Enter/Leertaste und aria-expanded kommen
// obendrein vom Element. Dieselbe Begründung wie beim Fenster „Hinweise" (AGENTS.md §11).
//
// 💣 UND TROTZDEM ANIMIERT -- aber die Animation ist ZUSATZ, nie Voraussetzung. `[open]` allein macht
// den Inhalt sichtbar (css/components/infobox-lid.css); die Klasse `is-collapsed` unterdrückt ihn nur
// VORÜBERGEHEND, damit eine Bewegung entsteht. Fällt das JavaScript aus, bleibt ein Deckel, der
// aufklappt und alles zeigt — nur ohne Bewegung.
//
// 🪤 Die erste Fassung hatte es andersherum (eine Klasse SCHALTETE den Inhalt ein, gesetzt aus einem
// requestAnimationFrame). In der Abnahme am 2026-08-12 feuerte rAF nicht, weil die Vorschau-Pane
// zugeklappt war: das <details> war offen, die Beschriftung sagte „zuklappen", der Inhalt hatte
// Höhe 0. Genau das sähe auch ein Nutzer in einem Hintergrund-Tab. Deshalb wird die Unterdrückung
// von ZWEI Seiten aufgehoben (rAF und ein Zeitgeber): rAF ist schnell, aber schläft mit der Seite --
// ein Zeitgeber läuft auch dann weiter, nur gedrosselt.

"use strict";

// Wie lange die Zelle wächst. Muss zur Dauer in css/components/infobox-lid.css passen -- steht
// hier ein kleinerer Wert, schnappt der Inhalt am Ende weg, statt auszulaufen.
var AVESMAPS_INFOBOX_LID_ANIM_MS = 320;

function avesmapsInfoboxLidEscape(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Der Satz unter dem Inhalt, in Einzahl und Mehrzahl. „1 Tierarten leben hier" darf nicht entstehen.
//
// 🔴 DIE ZAHL WIRD NICHT IN DEN SATZ GEKLEBT, sondern als eigenes Stück ausgezeichnet -- sie ist das
// Einzige mit Textfarbe und trägt Tabellenziffern. Ein fertig zusammengesetzter String könnte das nicht.
//
// Owner 2026-08-12 hat die Sätze vorgegeben („11 Waren werden hier gehandelt"); nur das ORTSWORT ist
// von mir neutralisiert: „in der Nähe" liest sich am Weg richtig, bei einem Königreich aber schief --
// dieselbe Zeile steht an fünf Oberflächen (Ort, Region, Herrschaftsgebiet, Weg, Etappe), und „hier"
// trägt Punkt, Fläche und Linie gleichermaßen.
function avesmapsInfoboxLidProse(count, singular, plural) {
	var number = '<span class="infobox-lid__count">' + avesmapsInfoboxLidEscape(count) + "</span>";
	var text = Number(count) === 1 ? singular : plural;
	return '<span class="infobox-lid__prose">' + number + " " + avesmapsInfoboxLidEscape(text) + "</span>";
}

// EIN Deckel als Markup.
//
// spec = {
//   preview:  MARKUP der eingedampften Fassung (schon escaped -- hier wird nicht nachgeescaped)
//   full:     MARKUP des vollen Inhalts (dito)
//   count:    die Zahl im Satz
//   singular / plural: der Satz ohne die Zahl
//   openable: false -> kein „alle anzeigen", kein Aufklappen (es steht ja schon alles da)
// }
//
// ⚠️ preview und full kommen aus Bauern, die selbst escapen (Ortsnamen, Warennamen -- alles
// Fremdinhalt aus dem Wiki). Hier ein zweites Mal zu escapen machte aus Links sichtbare Tags.
function buildInfoboxLid(spec) {
	if (!spec) {
		return "";
	}
	var preview = String(spec.preview || "");
	var full = String(spec.full || "");
	if (preview === "" && full === "") {
		return "";
	}
	var count = Number(spec.count) || 0;
	var prose = avesmapsInfoboxLidProse(count, spec.singular || "", spec.plural || "");

	// 💣 DER SATZ STEHT OBEN, NICHT UNTEN -- und das ist keine Geschmacksfrage, sondern der Grund,
	// warum beim Aufklappen nichts springt. Unter der Vorschau stehend wanderte er nach oben, sobald
	// die Vorschau wich: derselbe Satz an zwei verschiedenen Stellen, je nach Zustand (Owner
	// 2026-08-12: „wär schön, wenn die Wörter möglichst stabil an der Stelle bleiben").
	//
	// Oben ist er außerdem eine Überschrift („11 Waren werden hier gehandelt", darunter Beispiele),
	// und der Öffner sitzt dort, wo er hingehört: an einer festen Stelle, die das Auge erwarten kann.
	// Das war von Anfang an das Argument gegen die alte Kachel am Listenende.
	//
	// ⚠️ Die Zeile heißt weiterhin `__foot` -- der Name steht in Prüfseiten, im Entwurf und im
	// Gedächtnis. Ihn mitzudrehen hieße, alle drei nachzuziehen, um nichts zu gewinnen.
	if (spec.openable === false) {
		return '<div class="infobox-lid infobox-lid--static">'
			+ '<div class="infobox-lid__foot">' + prose + "</div>"
			+ '<div class="infobox-lid__preview">' + preview + "</div>"
			+ "</div>";
	}

	var openLabel = typeof tr === "function" ? tr("infobox.lid.showAll", "alle anzeigen") : "alle anzeigen";
	return '<details class="infobox-lid">'
		+ '<summary class="infobox-lid__summary">'
		+ '<span class="infobox-lid__foot">' + prose
		+ '<span class="infobox-lid__more">' + avesmapsInfoboxLidEscape(openLabel) + "</span>"
		+ "</span>"
		// 💣 Ohne Vorschau KEIN leerer Kasten. Die Lore-Zeilen geben seit 2026-08-12 keine mehr her
		// (zugeklappt steht dort nur der Satz, Owner: „ohne weitere Angaben"), und ein leeres
		// display:block-Element setzte trotzdem eine Zeilenhöhe an -- eine Lücke, die niemand bestellt
		// hat. „Verlauf" behält seine Vorschau und damit dieses Element.
		+ (preview ? '<span class="infobox-lid__preview">' + preview + "</span>" : "")
		+ "</summary>"
		+ '<div class="infobox-lid__full"><div>' + full + "</div></div>"
		+ "</details>";
}

// Beschriftung und Nachlauf-Klasse an den tatsächlichen Zustand angleichen. Idempotent -- ein zweiter
// Lauf schreibt dasselbe.
function avesmapsInfoboxLidSync(lid) {
	if (!lid) {
		return;
	}
	var more = lid.querySelector(".infobox-lid__more");
	if (more) {
		more.textContent = lid.open
			? (typeof tr === "function" ? tr("infobox.lid.collapse", "zuklappen") : "zuklappen")
			: (typeof tr === "function" ? tr("infobox.lid.showAll", "alle anzeigen") : "alle anzeigen");
	}
}

// 💣 EIN Handler für das ganze Dokument, EINMAL registriert. Ein Handler je geöffnetem Panel hätte
// sich gestapelt -- dieselbe Falle wie beim Spoiler-Sammelschalter der Kartensammlung und beim
// „+N"-Knopf der Lore-Zeilen.
//
// `toggle` feuert NACH der Zustandsänderung und auch dann, wenn die Seitensuche das <details>
// aufgeklappt hat -- ein Klick-Handler allein bekäme genau diesen Fall nicht mit und ließe die
// Beschriftung auf „alle anzeigen" stehen, während der Inhalt offen ist.
if (typeof document !== "undefined" && !document.__avesmapsInfoboxLidBound) {
	document.__avesmapsInfoboxLidBound = true;

	document.addEventListener("toggle", function (event) {
		var lid = event.target;
		if (!lid || !lid.classList || !lid.classList.contains("infobox-lid")) {
			return;
		}
		avesmapsInfoboxLidSync(lid);
		if (!lid.open) {
			lid.classList.remove("is-collapsed");
			return;
		}
		// Einen Wimpernschlag lang unterdrücken, damit der Übergang von 0fr aus startet -- und die
		// Unterdrückung DOPPELT wieder aufheben. Beide Wege sind idempotent; wer zuerst kommt, gewinnt.
		lid.classList.add("is-collapsed");
		var zeigen = function () { lid.classList.remove("is-collapsed"); };
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(zeigen);
		}
		window.setTimeout(zeigen, 80);
	}, true);   // 💣 in der EINFANGPHASE: `toggle` steigt nicht auf

	// Zuklappen mit Nachlauf: erst schrumpfen, dann `open` wegnehmen. Ohne das verschwände der Inhalt
	// schlagartig, und von der Animation bliebe nur die halbe Richtung.
	//
	// ⚠️ Auch hier fällt jeder Ausfall auf „sichtbar": bleibt der Zeitgeber aus, steht der Deckel offen
	// da -- nicht zugeklappt mit unerreichbarem Inhalt.
	document.addEventListener("click", function (event) {
		var summary = event.target && event.target.closest
			? event.target.closest(".infobox-lid__summary")
			: null;
		if (!summary) {
			return;
		}
		var lid = summary.parentElement;
		if (!lid || !lid.open) {
			return;   // Aufklappen darf das Element selbst -- da ist nichts zu verzögern
		}
		event.preventDefault();
		lid.classList.add("is-collapsed");
		window.setTimeout(function () {
			lid.open = false;
			lid.classList.remove("is-collapsed");
			avesmapsInfoboxLidSync(lid);
		}, AVESMAPS_INFOBOX_LID_ANIM_MS);
	});
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		buildInfoboxLid,
		avesmapsInfoboxLidProse,
		AVESMAPS_INFOBOX_LID_ANIM_MS,
	};
}
