import { EDITOR_PLACES_URL, type EditorPlaceList, type EditorPlaceRow } from "@avesmaps3d/shared";
import { ApiFailure, type Fetcher } from "../auth/api";
import { t, type MessageKey } from "../i18n/i18n";
import { nachName, nachRang, type Kreis, type ListenOptionen, type ListenZeile } from "./liste-modell";

/**
 * Die Orte als Liste (WI-0128 E5; Vertrag `EditorPlaceList`, E4; Blatt Fassung 3 „N1 Listenzeilen“): wie eine Zeile aus dem Server
 * eine Zeile der Liste wird, mit Legacys Design und den Abweichungen aus WI-0126 §4.1.
 *
 * - **Unterzeile** ist die Wiki-Zuordnung statt des Gebiets: „✓ Wiki: Gratenfels“, „⚠ kein Wiki-Artikel“, „○ nur Wiki (nicht
 *   platziert)“; bei einer Stätte dazu die Siedlung, denn viele Stätten heißen gleich („Praios-Tempel“).
 * - **Rechts** die Ortsgröße einer Siedlung, die Art eines Bauwerks oder einer Stätte (Legacy: `settlement_label` bzw. `type`).
 * - **Facetten** aus dem Register (`EDITORPANEL`, Subjekt `orte`): Karte, Typ, Lage, Art, Kontinent, Quelle, Wappen, Bilder. Lage und
 *   Art gelten nur für Bauwerke und Stätten (Legacy: Unterfilter von „Besondere Bauwerke/Stätten“). Kontinent kennt der Vertrag noch
 *   nicht; die Facette bleibt leer und erscheint darum nicht.
 * - **„Karte“ statt der Reiter Alle · Platziert · Fehlt** (Betreiber 2026-10-11): „Auf der Karte“ ist ein Ort mit Kartenpunkt, „Nicht
 *   auf der Karte“ eine Wiki-Siedlung ohne Punkt (früher „Fehlt“); nichts gewählt ist „Alle“. Sie zählt wie jede Facette unter allen
 *   anderen Filtern, so dass die Zahlen im Trichter zusammen stimmen.
 * - **Lage** innerorts · außerorts · unklar wie Legacy (`review-settlement-list.js`): das Urteil rechnet der Server (`scope`, Legacys
 *   `place-scope.php` über Wiki-Keys, Betreiber 2026-10-11), ohne Urteil außerorts; eine Stätte liegt in ihrer Siedlung. Vorbelegt
 *   „außerorts + unklar“ (Legacy, Owner 2026-07-27), und an der Zeile steht „in Khunchom“ oder „unklar: Punin“, damit ein Fehlurteil
 *   nicht wie fehlende Daten aussieht.
 */

const SIEDLUNGEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf"] as const;
const BAUWERKE = ["gebaeude", "stadtviertel"] as const;
/** Die Ortsgrößen in ihrer Folge; Stätten zuletzt. */
const GROESSE: Readonly<Record<string, number>> = {
    metropole: 1,
    grossstadt: 2,
    stadt: 3,
    kleinstadt: 4,
    dorf: 5,
    gebaeude: 6,
    stadtviertel: 7,
    staette: 8,
};
/** Sortiert nach „Zustand“: von ○ (weder platziert noch Wiki) über ◐ (nur Wiki) und ◑ (platziert ohne Artikel) zu ●. */
const KREIS_RANG = { leer: 0, halb: 1, "halb-rechts": 2, voll: 3 } as const;

/**
 * Der Kreis einer Ortszeile in VIER Zuständen (WI-0187; EDIT-0003 T26 (5); Betreiber 2026-10-16, wörtlich: „platziert und dem Wiki
 * zugewiesen ● … nur im Wiki, nicht platziert ◐ … platziert, ohne Wiki-Artikel ◑ … nicht platziert, ohne Wiki-Artikel ○ … diese
 * systematik für alle übernehmen - außer für herrschaftsgebiete, da gilt die alte regel aus legacy“; vier Zustände bestätigt).
 *
 * - ● platziert und dem Wiki zugewiesen · ◐ nur im Wiki, nicht platziert (Wiki-Siedlung, Stätte, ein Ort ohne Lage mit Artikel)
 * - ◑ platziert, ohne Wiki-Artikel · ○ nicht platziert, ohne Wiki-Artikel (etwa ein neuer Ort ohne Lage)
 *
 * 🪤 Der Server liefert noch Legacys drei Stufen (`circle`, `editorPlaceCircle`: ohne Kartenpunkt immer ○, platziert ohne Artikel ◐).
 * Die Liste leitet die vier aus Herkunft und Zuordnung ab; eine Adresse ohne Artikel (`address_only`) zählt wie keine Zuordnung.
 */
export function kreisVon(row: EditorPlaceRow): Kreis {
    const mitWiki = row.origin === "wiki" || row.assignment === "assigned";
    if (row.origin === "karte") return mitWiki ? "voll" : "halb-rechts";
    return mitWiki ? "halb" : "leer";
}

/** Die Namen der vier Zustände (`kreisVon`) für die Legende: unter der Ortsliste und im Steckbrief des Editorpanels (WI-0212). */
export const ORTE_LEGENDE = (): Record<Kreis, string> => ({
    voll: t("editorListe.kreis.voll"),
    halb: t("editorListe.kreis.halb"),
    "halb-rechts": t("editorListe.kreis.halbRechts"),
    leer: t("editorListe.kreis.leer"),
});

/** Der Typ einer Zeile: ihre Ortsgröße, eine Stätte (nur im Wiki, in einer Siedlung) oder unbekannt. */
export function typVon(row: EditorPlaceRow): string {
    if (row.subtype) return row.subtype;
    return row.within !== undefined ? "staette" : "unbekannt";
}

const istBauwerk = (typ: string): boolean => typ === "staette" || (BAUWERKE as readonly string[]).includes(typ);

type Lage = "innerorts" | "ausserorts" | "unklar";
const LAGE_NAMEN: Readonly<Record<Lage, MessageKey>> = {
    innerorts: "editorListe.lage.innerorts",
    ausserorts: "editorListe.lage.ausserorts",
    unklar: "editorListe.lage.unklar",
};
/** Die Lage eines Bauwerks: Legacys Urteil vom Server, eine Stätte in ihrer Siedlung, sonst außerorts (Legacys sichere Seite). */
const lageVon = (row: EditorPlaceRow): Lage => row.scope ?? (row.within !== undefined ? "innerorts" : "ausserorts");

const TYP_NAMEN: Readonly<Record<string, MessageKey>> = {
    metropole: "place.metropole",
    grossstadt: "place.grossstadt",
    stadt: "place.stadt",
    kleinstadt: "place.kleinstadt",
    dorf: "place.dorf",
    gebaeude: "place.gebaeude",
    stadtviertel: "place.stadtviertel",
    staette: "editorListe.typ.staette",
    unbekannt: "editorListe.typ.unbekannt",
};

/** Der Name eines Facettenwerts für die Anzeige. */
export function wertName(facette: string, wert: string): string {
    if (facette === "typ") return t(TYP_NAMEN[wert] ?? "editorListe.typ.unbekannt");
    if (facette === "lage") return t(LAGE_NAMEN[wert as Lage] ?? "editorListe.lage.ausserorts");
    if (facette === "karte") return t(wert === "auf" ? "editorListe.karte.auf" : "editorListe.karte.nicht");
    if (facette === "quelle") return t(wert === "wiki" ? "editorListe.quelle.wiki" : "editorListe.quelle.keine");
    if (facette === "wappen" || facette === "bilder") return t(wert === "ja" ? "editorListe.ja" : "editorListe.nein");
    return wert;
}

function unterzeile(row: EditorPlaceRow): NonNullable<ListenZeile["unter"]> {
    const teile: string[] = [];
    let ton: "gut" | "warnung" | "leise" = "leise";
    if (row.origin === "wiki") teile.push(t("editorListe.unter.nurWiki"));
    else if (row.origin === "ohne-lage") teile.push(t("editorListe.unter.ohneLage"));
    else if (row.assignment === "assigned") {
        teile.push(t("editorListe.unter.wiki", { titel: row.wiki?.title ?? row.name }));
        ton = "gut";
    } else {
        teile.push(t("editorListe.unter.keinArtikel"));
        ton = "warnung";
    }
    if (row.within !== undefined)
        teile.push(
            t(row.scope === "unklar" ? "editorListe.unter.unklar" : "editorListe.unter.in", { siedlung: row.within }),
        );
    if (row.hidden) teile.push(t("editorListe.unter.verborgen"));
    return { text: teile.join(" · "), ton };
}

export function zeileVon(row: EditorPlaceRow): ListenZeile {
    const typ = typVon(row);
    const bauwerk = istBauwerk(typ);
    const rechts = bauwerk ? (row.kind ?? t(TYP_NAMEN[typ] ?? "editorListe.typ.unbekannt")) : t(TYP_NAMEN[typ]!);
    return {
        key: row.key,
        name: row.name,
        kreis: kreisVon(row),
        facetten: {
            karte: row.origin === "karte" ? "auf" : "nicht",
            typ,
            lage: bauwerk ? lageVon(row) : undefined,
            art: bauwerk ? row.kind : undefined,
            quelle: row.wiki ? "wiki" : "keine",
            wappen: row.hasCoat ? "ja" : "nein",
            bilder: row.imageCount ? "ja" : "nein",
        },
        rechts,
        unter: unterzeile(row),
        ...(row.imageCount ? { bilder: row.imageCount } : {}),
        bild: { url: row.coat },
        rang: { groesse: GROESSE[typ] ?? 9, kreis: KREIS_RANG[kreisVon(row)] },
    };
}

export const ORTE_SORTIERUNGEN = ["name", "groesse", "kreis"] as const;

export const ORTE_OPTIONEN: Omit<ListenOptionen, "facetten"> = {
    form: "flach",
    // Legacy (Owner 2026-07-27, `review-settlement-list.js`): „Stadttempel und Gassen sollen von vornherein draußen sein, „unklar“
    // bleibt drin, weil es ungeprüft ist.“
    vorbelegt: new Map([["lage", new Set<string>(["ausserorts", "unklar"])]]),
    sortierungen: { name: nachName, groesse: nachRang("groesse"), kreis: nachRang("kreis") },
};

/** Die Masken (WI-0126 §4.1 „Maske, neu“): ein schneller Blick auf Siedlungen oder auf Bauwerke und Stätten. */
export const ORTE_MASKEN = {
    alle: undefined,
    siedlungen: (zeile: ListenZeile) => (SIEDLUNGEN as readonly string[]).includes(zeile.facetten["typ"] ?? ""),
    bauwerke: (zeile: ListenZeile) => istBauwerk(zeile.facetten["typ"] ?? ""),
} as const satisfies Record<string, ((zeile: ListenZeile) => boolean) | undefined>;
export type OrteMaske = keyof typeof ORTE_MASKEN;

/**
 * Die Liste vom Server. 🪤 Nicht über `getJson`: Das fragt mit `cache: "no-store"` und ließe den ETag ungenutzt. Hier fragt der
 * Browser mit `no-cache` nach (`If-None-Match`) und nimmt einen unveränderten Stand als 304 aus seinem Cache; nur eine geänderte
 * Liste reist neu (E4: rund 400 KB gepackt).
 */
export async function ladeOrte(
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<EditorPlaceList> {
    let antwort: Response;
    try {
        antwort = await fetcher(EDITOR_PLACES_URL, {
            method: "GET",
            headers: { accept: "application/json" },
            credentials: "same-origin",
            cache: "no-cache",
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
    }
    const body = (await antwort.json().catch(() => undefined)) as unknown;
    if (antwort.ok) return body as EditorPlaceList;
    const fehler = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    throw new ApiFailure(
        antwort.status,
        typeof fehler?.code === "string" ? fehler.code : antwort.status >= 500 ? "unavailable" : "failed",
        typeof fehler?.message === "string" ? fehler.message : antwort.statusText,
    );
}
