import { wikiNamespaceZeile, type WikiNamespaceTafel } from "@avesmaps3d/shared";

/**
 * Die Kanon-Regel (offiziell/inoffiziell und der Bezeichner), rein (WI-0253 B-2). Bis hierher wurde `<träger>_canon` nur aus Legacys Ergebnis
 * importiert (`migration/sources-import.ts`); diese Datei rechnet Rang 1 bis 3 selbst, nach `sources.yaml` (`kanon.raenge`) und Legacys
 * `avesmapsFeatureSourcesDeriveKanon` als Evidenz. Rang 4 (weder Wiki noch Quelle noch Publikation) gehört nicht hierher: Er wird beim
 * LESEN aufgelöst (`subjects/carrier-tables.ts`, `kanonMitRang4`), die Zeilen bleiben unberührt.
 *
 * 1. **Die Wiki-Zuweisung entscheidet:** Der Namensraum der gespeicherten Wiki-Adresse, über die Namensraum-Tafel der Umgebung: Kanon und
 *    Bezeichner der Zeile. Ein Raum, den die Tafel nicht kennt (Kategorie, Vorlage, Datei), sagt nichts und fällt durch. Eine Eigenkennung
 *    (Zuweisung ohne Wiki-Adresse) hat keinen Raum: Es gelten die lokalen Daten.
 * 2. **Ohne Zuweisung zählen die Quellen der Editoren UND die Publikationen gemeinsam** (Vali 2026-10-25): mindestens eine offiziell angehakte
 *    gibt OFFIZIELL; gezählt werden dafür nur die offiziellen. Bezeichner ist die ART, wenn alle Zählenden dieselbe haben, nie ein Titel; die
 *    Anzahl ab zwei Zählenden (Legacy: „Briefspiel (2)“).
 * 3. **Sonst** (nur inoffizielle): INOFFIZIELL, Bezeichner wie bei Rang 2.
 *
 * Mit Wiki-Zuweisung zählen Publikationen weiter nicht (sie werden gelistet, sonst nichts).
 *
 * `regelstand: "legacy"` rechnet die Regel, wie Legacy sie bis zum 2026-10-25 anwendete (Publikationen zählen nie, OFFIZIELL ohne Bezeichner):
 * Das ist der Maßstab des Orakels, nicht ein Betriebsmodus. Die Differenz der beiden Stände ist genau die gewollte Abweichung.
 */

export type KanonRegelstand = "avesmaps" | "legacy";

/** Ein Verweis eines Trägers auf eine Katalogquelle. Ein Verweis ohne Katalogzeile kommt nie hierher (er zählt nicht). */
export interface KanonQuelle {
    /** `feature_source.is_official`. */
    offiziell: boolean;
    /** `feature_source.source_type`, wörtlich. */
    art: string;
    /** `reference_kind` gesetzt: „Beschrieben“/„Erwähnt“ statt einer Quelle. */
    publikation: boolean;
}

export interface KanonEingabe {
    /** Der Namensraum der Wiki-Zuweisung; `null`: keine Zuweisung, Eigenkennung oder fremde Adresse. */
    ns: number | null;
    quellen: readonly KanonQuelle[];
}

export interface KanonErgebnis {
    kanon: "official" | "unofficial";
    designatorType: string | null;
    designatorCount: number | null;
    designatorLabel: string | null;
}

/** `null`: Rang 1 bis 3 sagen nichts. */
export function leiteKanonAb(
    eingabe: KanonEingabe,
    tafel: WikiNamespaceTafel,
    regelstand: KanonRegelstand = "avesmaps",
): KanonErgebnis | null {
    if (eingabe.ns !== null) {
        const zeile = wikiNamespaceZeile(tafel, eingabe.ns);
        if (zeile !== undefined) {
            return {
                kanon: zeile.kanon === "offiziell" ? "official" : "unofficial",
                designatorType: null,
                designatorCount: null,
                designatorLabel: zeile.bezeichner === "" ? null : zeile.bezeichner,
            };
        }
    }
    const zaehlend = eingabe.quellen.filter((quelle) => regelstand === "avesmaps" || !quelle.publikation);
    const offizielle = zaehlend.filter((quelle) => quelle.offiziell);
    const gruppe = offizielle.length > 0 ? offizielle : zaehlend;
    if (gruppe.length === 0) return null;
    const kanon = offizielle.length > 0 ? "official" : "unofficial";
    // Legacy: OFFIZIELL ist die ganze, runde Pille. Seit 2026-10-25 trägt es rechts die Art.
    if (kanon === "official" && regelstand === "legacy") {
        return { kanon, designatorType: null, designatorCount: null, designatorLabel: null };
    }
    const arten = new Set(gruppe.map((quelle) => quelle.art.trim()).filter((art) => art !== ""));
    const [einzige] = [...arten];
    return {
        kanon,
        designatorType: arten.size === 1 && einzige !== undefined ? einzige : null,
        designatorCount: gruppe.length > 1 ? gruppe.length : null,
        designatorLabel: null,
    };
}

/**
 * Die Erbschaft der Wegegruppe (Legacy `avesmapsMapFeaturesWegGruppeErbtZuweisung`, Owner 2026-09-08: „segmente eines flusses, der gleich
 * heisst, sollten gleich behandelt werden“): Ein Abschnitt ohne eigene Zuweisung erbt den Namensraum seiner Gruppe (Wegart und Name) von den
 * zugewiesenen Abschnitten. Zwei Riegel: Sind die zugewiesenen Abschnitte UNEINIG (verschiedene Räume), erbt niemand (lieber kein Etikett als ein
 * erfundenes); und ein Abschnitt mit eigener Aussage wird nie überschrieben. Eine Gruppe ohne Namen gibt es nicht (`gruppe: null`).
 */
export function erbeGruppenNamensraum(
    eintraege: readonly { gruppe: string | null; ns: number | null }[],
): (number | null)[] {
    const raeume = new Map<string, Set<number>>();
    for (const eintrag of eintraege) {
        if (eintrag.gruppe === null || eintrag.ns === null) continue;
        const menge = raeume.get(eintrag.gruppe) ?? new Set<number>();
        menge.add(eintrag.ns);
        raeume.set(eintrag.gruppe, menge);
    }
    return eintraege.map((eintrag) => {
        if (eintrag.ns !== null || eintrag.gruppe === null) return eintrag.ns;
        const menge = raeume.get(eintrag.gruppe);
        if (menge === undefined || menge.size !== 1) return null;
        const [raum] = [...menge];
        return raum ?? null;
    });
}
