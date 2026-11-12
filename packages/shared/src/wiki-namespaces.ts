/**
 * Die Namensräume des Wiki Aventurica als Vorgabe (WI-0253 B-1/B-2; Legacy `api/_internal/wiki/namespaces.php`, Vertrag
 * `wiki-link-targets.yaml` und `sources.yaml`). Die Vorgabe gilt, bis eine Umgebung sie in ihrer Tafel überschreibt (B-2, Migration
 * 0223, `apps/server/src/kanon/tafel.ts`); dann bleibt sie der Ausgangsstand, und „zurücksetzen“ führt zu ihr zurück. Die Rechenregeln der
 * Tafel (Zusammenführen, Titel → Raum, Prüfung) stehen in `kanon-tafel.ts`.
 *
 * 🔴 ZWEI FRAGEN, NICHT EINE (Legacy: „kostete beim ersten Anlauf 264 falsche Dörfer“):
 *
 * 1. **Kanon:** Ist eine QUELLE aus diesem Raum offiziell? Antwort für 0, 218 und 220: offiziell; für 222 und 444: inoffiziell.
 * 2. **Kartenobjekte:** Aus welchen Räumen sammeln wir Kartenobjekte ein? Nur aus 0 und 222. ns 218 und 220 liefern keine, ns 444 nur
 *    Fehltreffer (Regelwerk-Vorteile, deren Namen wie Orte aussehen).
 *
 * Dazu der **Bezeichner** im Kanon-Etikett (Vali 2026-10-25): die rechte Seite der geteilten Pille, frei, höchstens 40 Zeichen, leer =
 * runde Pille. Vorgabe: 222 und 444 „Wiki Aventurica“ (Legacy: „Inoffiziell │ Wiki Aventurica“), sonst leer.
 *
 * Ein Raum ungleich 0 heißt nicht „inoffiziell“ („Die Schwarze Katze“, ns 218, ist eine offizielle Produktlinie). Und ein Raum, der hier
 * nicht steht, ist KEIN Inhalt (Kategorie 14, Datei 6, Vorlage 10, Diskussionen …): Für ihn ist die Kanonfrage nicht „nein“, sie stellt
 * sich nicht. Deshalb liefert `wikiNamespaceKanon` für ihn `null`, nicht `false`.
 */

/** Die Einordnung einer Quelle aus einem Inhaltsraum. */
export const WIKI_KANON = ["offiziell", "inoffiziell"] as const;
export type WikiKanon = (typeof WIKI_KANON)[number];

/** Der Bezeichner im Etikett ist höchstens so lang (Zeichen), damit die Pille nicht überläuft. */
export const KANON_BEZEICHNER_MAX = 40;

/** Eine Zeile der Tafel der Namensräume. */
export interface WikiNamespaceZeile {
    /** Die Nummer des Raums im Wiki (0 Hauptraum). */
    ns: number;
    /** Das Titelpräfix als Wort (`Inoffiziell`, ohne Doppelpunkt); im Hauptraum leer. */
    praefix: string;
    /** Frage 1: der Kanon einer Quelle aus diesem Raum. */
    kanon: WikiKanon;
    /** Frage 2: sammeln wir aus diesem Raum Kartenobjekte ein? Wirkt erst beim nächsten Lauf. */
    einsammeln: boolean;
    /** Der Bezeichner rechts in der Pille; leer = runde Pille. */
    bezeichner: string;
}

/** Die Vorgabe, aufsteigend nach Nummer. Eine Umgebung weicht davon ab, indem sie eine Zeile ersetzt oder hinzufügt. */
export const WIKI_NAMESPACE_VORGABE: readonly WikiNamespaceZeile[] = [
    { ns: 0, praefix: "", kanon: "offiziell", einsammeln: true, bezeichner: "" },
    { ns: 218, praefix: "DSK", kanon: "offiziell", einsammeln: false, bezeichner: "" },
    { ns: 220, praefix: "Elf", kanon: "offiziell", einsammeln: false, bezeichner: "" },
    { ns: 222, praefix: "Inoffiziell", kanon: "inoffiziell", einsammeln: true, bezeichner: "Wiki Aventurica" },
    { ns: 444, praefix: "Ilaris", kanon: "inoffiziell", einsammeln: false, bezeichner: "Wiki Aventurica" },
];

/** Frage 1: der Kanon je Inhaltsraum der Vorgabe. Was hier fehlt, ist kein Inhalt. */
export const WIKI_KANON_NAMESPACES: Readonly<Record<number, WikiKanon>> = Object.fromEntries(
    WIKI_NAMESPACE_VORGABE.map((zeile) => [zeile.ns, zeile.kanon]),
);

/** Frage 2: die Räume der Vorgabe, aus denen Kartenobjekte eingesammelt werden. Enger als der Kanon, absichtlich. */
export const WIKI_KARTENOBJEKT_NAMESPACES: readonly number[] = WIKI_NAMESPACE_VORGABE.filter(
    (zeile) => zeile.einsammeln,
).map((zeile) => zeile.ns);

/**
 * Die Titelpräfixe derselben Räume (ein Titel trägt den Raum als WORT, nicht als Nummer: `Inoffiziell:Apfeldorn`). Der Hauptraum hat
 * keines. Nur bekannte Präfixe zählen, nie „alles vor dem ersten Doppelpunkt“: aventurische Titel tragen reichlich Doppelpunkte.
 */
export const WIKI_NAMESPACE_PRAEFIXE: Readonly<Record<number, string>> = Object.fromEntries(
    WIKI_NAMESPACE_VORGABE.filter((zeile) => zeile.praefix !== "").map((zeile) => [zeile.ns, zeile.praefix]),
);

/** Trägt dieser Namensraum Inhalt (steht er in der Vorgabe)? */
export function wikiNamespaceIstInhalt(ns: number): boolean {
    return Object.hasOwn(WIKI_KANON_NAMESPACES, ns);
}

/** Der Kanon einer Quelle aus diesem Raum; `null`: kein Inhaltsraum, die Frage stellt sich nicht (nie `false`, nie „inoffiziell“). */
export function wikiNamespaceKanon(ns: number): WikiKanon | null {
    return WIKI_KANON_NAMESPACES[ns] ?? null;
}

/** Sammeln wir aus diesem Raum Kartenobjekte ein? */
export function wikiNamespaceTraegtKartenobjekte(ns: number): boolean {
    return WIKI_KARTENOBJEKT_NAMESPACES.includes(ns);
}
