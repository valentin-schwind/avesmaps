/**
 * Der Titel hinter einer gespeicherten Wiki-Aventurica-Adresse (WI-0253 B-1; Legacy `avesmapsWikiNamespaceFromWikiUrl`).
 *
 * 🔴 NUR ADRESSEN DES WIKIS. Der Wirt wird auf Suffix-Grenze geprüft (`wiki-aventurica.de` oder `….wiki-aventurica.de`): ein Wirt wie
 * `wiki-aventurica.de.angreifer.example` oder eine Briefspielseite (`garetien.de/wiki/Inoffiziell:Apfeldorn`) ist keine Wiki-Adresse und
 * liefert keinen Titel. Ein fehlender Wirt (relativer Pfad, schemalose Adresse) wird abgewiesen, nicht durchgelassen: Er ließe sich von
 * einer fremden schemalosen Adresse nicht unterscheiden.
 *
 * Gelesen werden beide Formen des Wikis, `/wiki/<Titel>` und `index.php?title=<Titel>`. Am `/wiki/` wird getrennt, nicht am letzten
 * Schrägstrich (aventurische Titel tragen selbst welche: `Inoffiziell:Trutzbach/Zollhaus`). Es wird GENAU EINMAL dekodiert, Unterstriche
 * sind Leerzeichen, Abfrage und Sprungmarke gehören nicht zum Titel.
 */
export function titelAusWikiAdresse(adresse: string | null): string | null {
    if (adresse === null) return null;
    let url: URL;
    try {
        url = new URL(adresse.trim());
    } catch {
        return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const wirt = url.hostname.toLowerCase();
    if (wirt !== "wiki-aventurica.de" && !wirt.endsWith(".wiki-aventurica.de")) return null;
    let roh: string | null = null;
    const marke = url.pathname.indexOf("/wiki/");
    if (marke !== -1) {
        try {
            roh = decodeURIComponent(url.pathname.slice(marke + "/wiki/".length));
        } catch {
            return null;
        }
    } else if (url.pathname.includes("index.php")) {
        // `searchParams` hat schon einmal dekodiert; ein zweites Mal machte aus einem kodierten Prozentzeichen wieder einen Doppelpunkt.
        roh = url.searchParams.get("title");
    }
    const titel = (roh ?? "").replaceAll("_", " ").trim();
    return titel === "" ? null : titel;
}

/** Die Titel, unter denen eine Adresse im Dump stehen kann: wörtlich und mit großem Anfangsbuchstaben (MediaWiki, `first-letter`). */
export function titelKandidaten(titel: string): string[] {
    const gross = titel.charAt(0).toUpperCase() + titel.slice(1);
    return gross === titel ? [titel] : [titel, gross];
}
