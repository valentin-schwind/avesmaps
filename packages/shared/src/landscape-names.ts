/**
 * Wie eine Landschaft für einen Leser heißt: ihr Name, sonst ihre Art (Legacy
 * `ecosystemRegionLeserName`).
 *
 * Eine Fläche ohne eigenen Namen trägt in Legacy einen Griff: `<Art>-<Zahl>` („Wald-925“), ohne Art
 * `Fläche-<Zahl>`. Ein Griff ist kein Name und wird nie gezeigt. Die Regel steht hier, weil zwei Seiten
 * sie brauchen: der Server für die Landschaften einer Route (WI-0035), die Karte für eine Fläche, die
 * jemand anklickt (WI-0043).
 */

/**
 * Legacys Artenkatalog (`api/_internal/app/ecosystem.php`), NUR um Griffe zu erkennen.
 *
 * 🪤 Das sind Daten, keine Anzeige. Wie die Art auf der Seite heißt, steht in den Sprachtafeln
 * (`landscape.type.*`) und darf sich ändern, ohne dass ein Griff plötzlich als Name durchrutscht.
 *
 * 🔴 **Der Wert ist Legacys `label`**, nicht ein Wort unserer Wahl: Legacy baut den Griff genau daraus
 * (`ecosystemRegionNameIsGriff` mit `artLabel`, und `landscape-search.php` liest dasselbe `label` für das
 * Suchmuster). Eine Art, die hier fehlt, fällt auf `Fläche` zurück - und ihr eigener Griff rutscht dann als
 * echter Name durch. Genau das war am 2026-10-08 bei `gletscher` so: 20 Flächen hießen `Gletscher-001` bis
 * `Gletscher-020` und standen roh im Panel und in der Suche (WI-0105, Befund B1).
 */
const GRIFF_PRAEFIX: Readonly<Record<string, string>> = {
    region: "Region",
    inselgruppe: "Inselgruppe",
    kontinent: "Kontinent",
    sonstiges: "Sonstiges",
    gebirge: "Gebirge",
    see: "See",
    meer: "Meer",
    kueste: "Küste",
    huegelland: "Hügelland",
    wadi: "Wadi",
    schlucht: "Schlucht",
    hochebene: "Hochebene",
    tiefebene: "Tiefebene",
    tal: "Tal",
    flussdelta: "Flussdelta",
    insel: "Insel",
    // Drei Arten, die Legacy am 04.10.2026 nachgetragen hat (`ecosystem.php`, Zeilen 202 und 224/225); der
    // Betreiber hat sie am 2026-10-08 benannt: „ja gletscher sind neu, das WA wird sie bald nachreichen, für
    // uns werden sie noch wichtig. nenn Sie einfach mal ‚Gletscher‘ und ‚Eislandschaft‘, ‚Schneelandschaft‘
    // gibts übrigens auch neu.“ Die beiden Landschaftsformen stehen unten im Vegetationsblock.
    // 🪤 `schneelandschaft` kommt im Bestand heute GAR NICHT vor (0 Zeilen, aktiv wie inaktiv) und steht
    // vorsorglich hier - die Wiki Aventurica reicht die Flächen nach.
    //
    // Die zwei Küstenformen aus demselben Nachtrag (`ecosystem.php`, Zeilen 203 und 204) hat der Betreiber am
    // 2026-10-08 nachgereicht: „‚Unbezeichnete Flachküste‘ / ‚Unbezeichnete Steilküste‘ -> ganz vergessen,
    // genau dasselbe“. 🪤 Die allgemeine `kueste` BLEIBT daneben stehen, so wie in Legacy: eine Küste ohne
    // Aussage zur Form ist weiter eine gültige Angabe (zwei aktive Flächen tragen sie).
    gletscher: "Gletscher",
    flachkueste: "Flachküste",
    steilkueste: "Steilküste",
    wald: "Wald",
    urwald: "Urwald",
    suempfe_moore: "Sümpfe und Moore",
    steppe: "Steppe",
    tundra: "Tundra",
    auenlandschaft: "Auenlandschaft",
    wueste: "Wüste",
    graslandschaft: "Graslandschaft",
    flussland_flusstal: "Flussland/Flusstal",
    dschungel: "Dschungel",
    wuestenoase: "Wüstenoase",
    kulturlandschaft: "Kulturlandschaft",
    schneelandschaft: "Schneelandschaft",
    eislandschaft: "Eislandschaft",
    // Vier Vegetationsarten, die es nur in Avesmaps3D gibt (WI-0301, Betreiber 2026-11-09: „als neue Vegetationszonen
    // hinzufügen“). Legacy hat für sie kein `label`; der Griff wäre `Savanne-12`, und eine Fläche, die so heißt, ist auch
    // hier ein Griff und kein Name.
    bergtundra: "Bergtundra",
    savanne: "Savanne",
    heideland: "Heideland",
    oedland: "Ödland",
};
const RUECKFALL_GRIFF = "Fläche";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ist dieser Name ein Griff statt eines Namens? Wie Legacy (`ecosystemRegionNameIsGriff`): der Griff der
 * jetzigen Art UND der Rückfall-Griff „Fläche“, ohne Rücksicht auf Groß- und Kleinschreibung - die
 * sichere Richtung ist „verbergen“.
 */
export function isLandscapeHandle(name: string, type: string): boolean {
    const trimmed = name.trim();
    if (trimmed === "") return true;
    const griffe = [...new Set([GRIFF_PRAEFIX[type] ?? RUECKFALL_GRIFF, RUECKFALL_GRIFF])].map(escapeRegExp);
    return new RegExp(`^(?:${griffe.join("|")})-\\d+$`, "iu").test(trimmed);
}

/**
 * Der deutsche Name einer Landschaftsart für die SUCHE auf dem Server (WI-0257 S3a, „Wald in Kosch“): Legacys `label`, derselbe Stamm wie bei den
 * Klimazonen (`climate_zone_type.label`). Wie die Art auf der Seite heißt, steht weiter in den Sprachtafeln (`landscape.type.*`); hier steht nur, was der
 * Server braucht, um eine deutsche Anfrage zu verstehen. `undefined` für eine Art, die es nicht gibt.
 */
export function landscapeTypeNameDe(type: string): string | undefined {
    return Object.hasOwn(GRIFF_PRAEFIX, type) ? GRIFF_PRAEFIX[type] : undefined;
}

/** Der Name einer Landschaft, wie ein Leser ihn sieht - `null`, wo nur ein Griff steht. */
export function landscapeReaderName(name: string, type: string): string | null {
    return isLandscapeHandle(name, type) ? null : name.trim();
}

/**
 * Der Griff-Riegel der SUCHE (WI-0047, Legacy `landschaften-in-der-suche-design.md` §5, Owner 14.09.2026):
 * strenger als die Anzeige. Er verbirgt den Griff JEDER Art und „Fläche“, nicht nur den der jetzigen Art -
 * eine Region, die als „Wald-003“ angelegt wurde und heute Urwald ist, trägt ihren alten Griff weiter. Die
 * Frage lautet hier nicht „ist der Name automatisch?“, sondern „würde ein Leser danach suchen?“.
 *
 * Als Muster für PostgreSQL (`~*`, ohne Rücksicht auf die Schreibweise): Die Suche filtert in der Abfrage,
 * damit Griffe nicht den Deckel der Trefferliste belegen.
 */
export function landscapeSearchHandlePattern(): string {
    const griffe = [...new Set([...Object.values(GRIFF_PRAEFIX), RUECKFALL_GRIFF])].map(escapeRegExp);
    return `^\\s*(?:${griffe.join("|")})-[0-9]+\\s*$`;
}
