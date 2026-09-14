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

// Steht der Haken „Auto-Name"? DREI Zustände, und der dritte ist der Punkt.
//
// 💣 DER FEHLER, DEN DAS BEHEBT (Owner 26.08.2026): der Haken wurde nicht gespeichert, sondern aus
// dem Namen abgeleitet -- mit einer Zusatzbedingung, die der Namensgeber nicht kennt
// (`region_type !== ""`). Eine frisch gezeichnete Region hat noch keine Art; der Namensgeber stört
// das nicht (er fällt auf den Griff „Fläche" zurück und vergibt „Fläche-100"), die Ableitung sagte
// dagegen „keine Art ⇒ niemals automatisch". Anhaken, speichern, wieder aufmachen -- Haken weg.
//
// 🔴 Deshalb entscheidet jetzt ein GESPEICHERTER Merker, und der Name ist nur noch der Rückfall:
//   fehlt (null/undefined) -> nie angefasst: aus dem Namen ableiten (Altbestand, frisch gezeichnet)
//   true                   -> ausdrücklich automatisch
//   false                  -> ausdrücklich KEIN Auto-Name, auch wenn der Name danach aussieht
//
// ⚠️ Der dritte Zustand ist der Grund, aus dem hier `false` GESPEICHERT wird -- anders als beim
// Nachbarn `wiki_no_article`, der `false` löscht. Dort sind „entschieden: nein" und „nie
// entschieden" bedeutungsgleich; hier nicht: eine Region, die „Wald-001" heisst und deren Haken
// jemand bewusst entfernt hat, käme sonst beim nächsten Öffnen wieder angehakt zurück.
function avesmapsEcosystemAutoNameAusMerker(merker, name, artLabel) {
	if (merker === true || merker === false) {
		return merker;
	}
	return isEcosystemRegionAutoName(name, artLabel);
}

// Ist dieser Name ein GRIFF, den ein LESER nie zu sehen bekommt? Strenger als der Haken darüber.
//
// 🔴 ZWEI GRIFFE, NICHT EINER (14.09.2026). Der Haken prüft nur gegen die JETZIGE Art. „Fläche-048" wurde
// vergeben, als die Region noch keine Art hatte -- der Zeichner schickt dabei `auto_name: false` mit, der
// Name bleibt also stehen, wenn später eine Art dazukommt. Seit sie ein Urwald ist, hielt der Haken den
// Griff für einen echten Namen, und „Führt durch" zeigte ihn (12 Regionen, live gemessen). Die Anzeige
// kennt deshalb den Griff der jetzigen Art UND den Rückfall-Griff.
//
// 💣 DER HAKEN BLEIBT, WIE ER IST. isEcosystemRegionAutoName entscheidet, wie „Auto-Name" beim Öffnen
// steht (avesmapsEcosystemAutoNameAusMerker) -- eine eigene Entscheidung mit gespeichertem Merker. Wer
// die Anzeige an ihn koppelt oder ihn an die Anzeige, ändert, wie der Haken aufgeht.
//
// ⚠️ Ohne Rücksicht auf Gross- und Kleinschreibung: die sichere Richtung ist „verbergen".
// ⚠️ Die SUCHE ist noch strenger -- sie kennt jede Art, auch stillgelegte
// (avesmapsLandscapeSearchAutoNamePattern, api/_internal/app/landscape-search.php). Der Browser hat
// keinen Artenkatalog, nur die Art der Zeile, und die geladenen Flächen hängen am Kartenausschnitt.
// Die Reihenfolge Haken ⊆ Anzeige ⊆ Suche hält die gemeinsame Fallliste
// (api/_internal/app/__tests__/fixtures/landschaft-autonamen.json).
function ecosystemRegionNameIsGriff(name, artLabel) {
	const trimmed = String(name === null || name === undefined ? "" : name).trim();
	if (trimmed === "") {
		return false;
	}
	const griffe = [ecosystemAutoNamePrefix(artLabel), ECOSYSTEM_AUTO_NAME_FALLBACK]
		.filter((griff, index, liste) => liste.indexOf(griff) === index)
		.map(escapeEcosystemNameForRegExp);
	return new RegExp(`^(?:${griffe.join("|")})-\\d+$`, "iu").test(trimmed);
}

// Der Name, den ein LESER an einer Landschaft sieht -- oder "", wenn es weder einen Namen noch eine Art
// zu sagen gibt. Ein Griff ist interne Buchführung und darf nie nach aussen dringen: statt „Wald-218"
// steht „Wald", statt „Fläche-048" an einem Urwald „Urwald".
//
// 🔴 EIN LESER, VIELE FLÄCHEN (Owner 14.09.2026: für Editor wie Besucher): der Schwebezettel und das
// Infopanel einer Fläche (ecosystemAreaDisplayName, map-features-ecosystem-rendering.js), „Was ist hier?"
// (avesmapsWhatIsHereLandschaftWerte) und „Führt durch" (avesmapsLandscapeDisplayName). Bis zu diesem Tag
// benutzte nur die letzte eine Namensregel; die übrigen gaben den Griff roh aus -- 1.136 von 1.980
// Regionen trugen live einen. Den Griff sieht der Editor weiterhin im Dialog und in der Editorliste.
//
// ⚠️ Was bei "" steht, entscheidet der Aufrufer: der Zettel sagt „Ohne Namen", „Führt durch" und
// „Was ist hier?" lassen den Eintrag weg.
function ecosystemRegionLeserName(name, artLabel) {
	const trimmed = String(name === null || name === undefined ? "" : name).trim();
	if (trimmed !== "" && !ecosystemRegionNameIsGriff(trimmed, artLabel)) {
		return trimmed;
	}
	return String(artLabel === null || artLabel === undefined ? "" : artLabel).trim();
}

// Was ein Leser sehen soll -- wie ecosystemRegionLeserName, aber nie leer: ohne Namen und ohne Art bleibt
// der Rückfall-Griff „Fläche".
//
// (Der Besitzer nannte als Alternative „Unbenannter Wald". Das ist eine Zeile hier, nicht an jedem
// Aufrufer -- deshalb steht die Entscheidung an dieser einen Stelle.)
function ecosystemRegionDisplayName(name, artLabel) {
	return ecosystemRegionLeserName(name, artLabel) || ecosystemAutoNamePrefix(artLabel);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_AUTO_NAME_DIGITS,
		ECOSYSTEM_AUTO_NAME_FALLBACK,
		ecosystemAutoNamePrefix,
		nextEcosystemRegionAutoName,
		isEcosystemRegionAutoName,
		avesmapsEcosystemAutoNameAusMerker,
		ecosystemRegionNameIsGriff,
		ecosystemRegionLeserName,
		ecosystemRegionDisplayName,
	};
}
