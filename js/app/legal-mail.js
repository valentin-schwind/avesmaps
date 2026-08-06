// Die E-Mail-Adresse des Impressums, anklickbar gemacht (Befund A24, zweite Haelfte).
//
// 💣 WARUM DAS KONTAKTFORMULAR NICHT REICHT. § 5 DDG (bis Mai 2024 § 5 TMG) verlangt Angaben, die
// eine schnelle elektronische Kontaktaufnahme ermoeglichen -- „einschliesslich der Adresse der
// elektronischen Post". Die Adresse steht also im Gesetzestext selbst. Der EuGH hat das Formular
// 2008 (C-298/07) ausdruecklich als den ZWEITEN Kanal eingeordnet, den ein Anbieter zusaetzlich
// anbieten kann -- nicht als Ersatz fuer die Adresse. Beides steht deshalb nebeneinander.
//
// ⚠️ Die Adresse steht in index.html NICHT im Klartext, sondern als Zeichen-Entitaeten
// (`&#105;&#110;…`). Der Browser macht daraus echten Text -- fuer Menschen, fuer Vorlesegeraete und
// beim Kopieren ist sie voellig normal --, aber im ausgelieferten Quelltext gibt es kein `@` zum
// Finden. Das Wort `mailto:` kommt dort ebenfalls nicht vor; erst diese Datei setzt es zusammen.
// Zusammen haelt das die einfachen Sammelprogramme fern, und das sind fast alle.
//
// 🔴 „Absolut spamsicher" gibt es nicht, und diese Datei behauptet es nicht. Was ein Mensch lesen
// kann, kann ein Programm lesen, das die Seite wirklich darstellt. Der dauerhafte Schutz ist der
// Spamfilter des Postfachs; das hier senkt nur die Zahl derer, die ueberhaupt hinkommen.
//
// 🔴 OHNE JAVASCRIPT BLEIBT DIE ADRESSE LESBAR -- nur nicht klickbar. Das ist der Teil, der
// rechtlich zaehlt („unmittelbar erreichbar"), und deshalb steht der Text im HTML und wird hier nur
// VERLINKT. Wer die Adresse stattdessen erst per JavaScript einsetzt, hat sie fuer jeden ohne
// JavaScript geloescht -- und das Impressum ist genau die Seite, bei der man das nicht darf.
//
// ⚠️ Eigene Datei aus demselben Grund wie js/app/legal-anchor.js: hier laesst sich die Regel gegen
// ein echtes, kleines DOM ausfuehren statt sie ueber ihren Quelltext zu behaupten.

const AVESMAPS_LEGAL_MAIL_ID = "legal-mail";

// Sieht das nach einer Adresse aus? Bewusst streng: was hier durchfaellt, wird NICHT verlinkt und
// bleibt einfacher Text. Ein `mailto:` auf etwas, das keine Adresse ist, waere ein toter Knopf im
// Impressum -- schlimmer als gar keiner.
function avesmapsIsLegalMailAddress(value) {
	const address = String(value || "").trim();
	if (address === "" || address.length > 254) {
		return false;
	}

	// Genau ein @, links und rechts etwas, rechts ein Punkt mit mindestens zwei Buchstaben dahinter,
	// und nirgends Leerraum.
	return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(address);
}

// Macht aus dem Textknoten einen Link. Gibt die verlinkte Adresse zurueck, sonst "".
//
// ⚠️ Idempotent: liegt schon ein <a> darin, passiert nichts. Die Funktion laeuft beim Start und
// koennte durch einen Sprachwechsel ein zweites Mal gerufen werden.
function avesmapsActivateLegalMail(doc) {
	const host = doc && typeof doc.getElementById === "function" ? doc.getElementById(AVESMAPS_LEGAL_MAIL_ID) : null;
	if (!host) {
		return "";
	}

	if (typeof host.querySelector === "function" && host.querySelector("a")) {
		return "";
	}

	const address = String(host.textContent || "").trim();
	if (!avesmapsIsLegalMailAddress(address)) {
		return "";
	}

	const link = doc.createElement("a");
	// Der einzige Ort im ganzen Projekt, an dem das Schema und die Adresse zusammenkommen -- und er
	// existiert erst im Browser, nie in einer ausgelieferten Datei.
	link.setAttribute("href", "mailto:" + address);
	link.textContent = address;
	host.textContent = "";
	host.appendChild(link);

	return address;
}

if (typeof module === "object" && module.exports) {
	module.exports = {
		AVESMAPS_LEGAL_MAIL_ID,
		avesmapsIsLegalMailAddress,
		avesmapsActivateLegalMail,
	};
}
