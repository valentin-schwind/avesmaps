// Landschaften — der Auto-Name einer Fläche.
//
// 🔴 DIE REGEL, die dieses Modul ausdrückt: eine Fläche, die kein Karten-Label hat, braucht trotzdem
// einen Griff, unter dem der Editor sie wiederfindet. Dieser Griff ist KEIN Anzeigename. Ist der
// „Auto-Name"-Haken gesetzt, heisst die Fläche `Wald-001` — intern eindeutig, nach aussen bedeutungslos;
// ein Leser bekommt statt dessen die Art zu sehen („Wald"). Ist der Haken aus, gilt der zugewiesene
// Name („Farindel"), und der wird angezeigt.
//
// 🔴 NICHTS DAVON WIRD GESPEICHERT. Der Name selbst trägt den Zustand: er passt auf `<Art>-<Zahl>` oder
// er tut es nicht. Genau so halten es die Wege (getNextPathDisplayName, map-features-path-domain.js:96),
// und genau darauf verlässt sich schon heute die Rauschfilterung im Konfliktzentrum, die auto-benannte
// Wege `<Subtype>-<n>` gar nicht erst auf die Merkliste lässt. Ein zusätzliches Flag in der Datenbank
// wäre eine zweite Wahrheit über dieselbe Sache -- und die beiden könnten auseinanderlaufen.
//
// Folge davon, und Absicht: der Haken muss beim Öffnen eines Dialogs nicht geladen werden, er wird
// ABGELEITET (isEcosystemRegionAutoName). „Farindel" öffnet mit leerem Haken und schreibbarem Feld,
// „Wald-001" mit gesetztem Haken.

// Wie viele Stellen die laufende Nummer bekommt. Rein kosmetisch -- gelesen wird `\d+`, damit ein von
// Hand getipptes „Wald-7" mitzählt und nicht von einem frisch erzeugten „Wald-001" überschrieben wird.
const ECOSYSTEM_AUTO_NAME_DIGITS = 3;

// Eine Region ohne Art ist ein gültiger Zustand (die Auswahl bietet „— ohne Art —" an), braucht aber
// trotzdem einen Griff. Ohne diesen Rückfall hiesse sie „-001".
const ECOSYSTEM_AUTO_NAME_FALLBACK = "Fläche";

function ecosystemAutoNamePrefix(artLabel) {
	const prefix = String(artLabel === null || artLabel === undefined ? "" : artLabel).trim();
	return prefix === "" ? ECOSYSTEM_AUTO_NAME_FALLBACK : prefix;
}

// Der Art-Name ist Inhalt, kein Muster: „Sümpfe und Moore" enthält nichts Gefährliches, aber sobald
// jemand eine Art mit Klammer oder Punkt anlegt, wäre eine ungeschützte RegExp still falsch.
function escapeEcosystemNameForRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ecosystemAutoNamePattern(artLabel) {
	return new RegExp(`^${escapeEcosystemNameForRegExp(ecosystemAutoNamePrefix(artLabel))}-(\\d+)$`);
}

// Der nächste freie Griff für diese Art. Wie bei den Wegen: die vorhandenen Namen absuchen, die höchste
// Nummer nehmen, eins drauf. Andere Arten zählen NICHT mit -- jede Art hat ihre eigene Reihe.
function nextEcosystemRegionAutoName(artLabel, existingNames) {
	const prefix = ecosystemAutoNamePrefix(artLabel);
	const pattern = ecosystemAutoNamePattern(prefix);
	let highest = 0;

	(Array.isArray(existingNames) ? existingNames : []).forEach((candidate) => {
		// Die Liste kommt aus einem teilweise geladenen Regionsbestand -- null/undefined/Zahlen sind
		// Daten, kein Absturzgrund.
		if (typeof candidate !== "string") {
			return;
		}
		const match = pattern.exec(candidate.trim());
		if (match) {
			highest = Math.max(highest, Number.parseInt(match[1], 10) || 0);
		}
	});

	// padStart kürzt nie: jenseits von 999 wächst die Nummer einfach weiter, statt zu überlaufen und in
	// eine Kollision zurückzulaufen.
	return `${prefix}-${String(highest + 1).padStart(ECOSYSTEM_AUTO_NAME_DIGITS, "0")}`;
}

// Trägt dieser Name den Zustand „auto"? Beidseitig verankert, damit ein echter Name, der zufällig auf
// eine Zahl endet („Wald der Wälder-2"), ein echter Name bleibt.
function isEcosystemRegionAutoName(name, artLabel) {
	const trimmed = String(name === null || name === undefined ? "" : name).trim();
	if (trimmed === "") {
		return false;
	}
	return ecosystemAutoNamePattern(artLabel).test(trimmed);
}

// Was ein Leser sehen soll. Ein Auto-Name ist interne Buchführung und darf nie nach aussen dringen --
// statt „Wald-001" bekommt er „Wald". Ein namenloser Datensatz ebenso.
//
// (Der Besitzer nannte als Alternative „Unbenannter Wald". Das ist eine Zeile hier, nicht an jedem
// Aufrufer -- deshalb steht die Entscheidung an dieser einen Stelle.)
function ecosystemRegionDisplayName(name, artLabel) {
	const trimmed = String(name === null || name === undefined ? "" : name).trim();
	if (trimmed === "" || isEcosystemRegionAutoName(trimmed, artLabel)) {
		return ecosystemAutoNamePrefix(artLabel);
	}
	return trimmed;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_AUTO_NAME_DIGITS,
		ECOSYSTEM_AUTO_NAME_FALLBACK,
		ecosystemAutoNamePrefix,
		nextEcosystemRegionAutoName,
		isEcosystemRegionAutoName,
		ecosystemRegionDisplayName,
	};
}
