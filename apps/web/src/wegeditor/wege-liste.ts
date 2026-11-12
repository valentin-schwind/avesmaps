import { EDITOR_PATHS_URL, type EditorPathList, type EditorPathRow } from "@avesmaps3d/shared";
import { nachName, nachRang, type Kreis, type ListenOptionen, type ListenZeile } from "../editor-liste/liste-modell";
import { ApiFailure, type Fetcher } from "../auth/api";
import { isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";
import { wegName } from "./wegeditor-texte";

/**
 * Die Wege als Liste (WI-0177 Stufe 2, W5a; Muster `kraftlinieneditor/kraftlinien-liste.ts`): Der Adapter macht aus den Zeilen des
 * Lesepfads (`GET /api/editor/paths`) die Zeilen des gemeinsamen Bauteils `editor-liste.vue`.
 *
 * - **Eine Zeile je Straße** (Name und Art), wie die Auswahl auf der Karte; die Abschnitte stehen in den Eigenschaften.
 * - **Name:** 🔴 nie der Griff („Weg-6029“): ohne Lesenamen steht der Satz für einen Weg ohne Namen (`wegName`, WI-0105).
 * - **Kreis** vom Server, links das Wiki (voll nur, wenn jeder Abschnitt den Artikel trägt), rechts die Karte; die Legende nennt die
 *   Zustände mit den Wörtern aller Listen.
 * - **Facetten:** Stand (EDIT-0003 T54, die Werte gemeinsam für alle Listen: auf der Karte, nicht auf der Karte wie Stufe 3b, gelöscht;
 *   „Gelöscht“ ist standardmäßig aus, und Gelöschtes zählt in keiner Legende), Wiki (an jedem Abschnitt, an einem Teil, ohne) und Art
 *   (der Wegtyp; ein Bach heißt Bach). Der Stand ersetzt die frühere Facette „Karte“ der Wege, die dasselbe sagte.
 * - **Karawanenroute** (Kennzeichen über dem Wegtyp, Migration 0174, WI-0177 §30): EINE Zeile, auch auf gemischtem Untergrund; ihre
 *   Art in Facette und rechter Spalte ist die Karawanenroute, die Unterzeile nennt den Untergrund („auf Pfad, Wüstenpfad“).
 */

export const WEGE_SORTIERUNGEN = ["name", "abschnitte", "kreis"] as const;

const KREIS_RANG: Readonly<Record<Kreis, number>> = { leer: 0, halb: 1, "halb-rechts": 2, voll: 3 };

/** Die Wörter der Legende, für alle Listen gleich (`editorListe.kreis.*`). */
export const WEGE_LEGENDE = (): Record<Kreis, string> => ({
    voll: t("editorListe.kreis.voll"),
    halb: t("editorListe.kreis.halb"),
    "halb-rechts": t("editorListe.kreis.halbRechts"),
    leer: t("editorListe.kreis.leer"),
});

type Wiki = "jeder" | "teil" | "ohne";

function wikiVon(row: Pick<EditorPathRow, "wiki" | "wikiSegments">): Wiki {
    if (!row.wiki) return "ohne";
    return row.wikiSegments === undefined ? "jeder" : "teil";
}

const WIKI_NAMEN: Readonly<Record<Wiki, MessageKey>> = {
    jeder: "kraftlinieneditor.wiki.jeder",
    teil: "kraftlinieneditor.wiki.teil",
    ohne: "kraftlinieneditor.wiki.ohne",
};

/** Die Art eines Wegs als Facettenwert: das Kennzeichen, sonst der Wegtyp, ein Bach als eigene Art. */
const artVon = (row: Pick<EditorPathRow, "subtype" | "isBach" | "mark">): string =>
    row.mark ?? (row.isBach ? "Bach" : row.subtype);

/** Der Untergrund einer Straße auf mehreren Wegtypen (ein Weg ist sein Name) oder mit Kennzeichen: ihre Wegtypen, der häufigste zuerst. */
export const untergrundText = (row: Pick<EditorPathRow, "subtype" | "subtypes">): string =>
    (row.subtypes ?? [row.subtype]).map(artName).join(", ");

/** Der Name einer Art: der Wegtyp der Tafel (`path.*`), der Bach als „Bach“, das Kennzeichen „Karawanenroute“. */
export function artName(art: string): string {
    if (art === "Bach") return t("wegeditor.art.bach");
    if (art === "karawanenroute") return t("wegeditor.art.karawanenroute");
    const key = `path.${art}`;
    return isMessageKey(key) ? t(key) : art;
}

/** Der Name einer Facette für den Trichter: wie jede Facette des Registers (`nav.editorpanel.facette.*`). */
export function facettenName(id: string): string {
    const key = `nav.editorpanel.facette.${id}`;
    return isMessageKey(key) ? t(key) : id;
}

/** Der Stand einer Straße als Facettenwert (T54, gemeinsame Werte `editorListe.stand.*`). */
const standVon = (row: Pick<EditorPathRow, "offMap" | "deleted">): string =>
    row.deleted ? "geloescht" : row.offMap ? "nichtAufDerKarte" : "aufDerKarte";

/** Der Name eines Facettenwerts für die Anzeige. */
export function wertName(facette: string, wert: string): string {
    if (facette === "stand") {
        const key = `editorListe.stand.${wert}`;
        return isMessageKey(key) ? t(key) : wert;
    }
    if (facette === "wiki") return t(WIKI_NAMEN[wert as Wiki] ?? "kraftlinieneditor.wiki.ohne");
    return artName(wert);
}

function unterzeile(row: EditorPathRow): NonNullable<ListenZeile["unter"]> {
    if (row.deleted || row.offMap) return { text: wertName("stand", standVon(row)), ton: "warnung" };
    const teile = [
        ...(row.mark !== undefined || row.subtypes !== undefined
            ? [t("wegeditor.liste.auf", { arten: untergrundText(row) })]
            : []),
        row.wikiSegments !== undefined
            ? t("kraftlinieneditor.unter.wikiTeil", { n: row.wikiSegments, von: row.segments })
            : tPlural("kraftlinieneditor.unter.abschnitte", row.segments, { n: row.segments }),
    ];
    if (
        row.wiki?.title !== undefined &&
        wikiVon(row) === "jeder" &&
        row.mark === undefined &&
        row.subtypes === undefined
    )
        teile.unshift(t("editorListe.unter.wiki", { titel: row.wiki.title }));
    // Gut nur, wenn jeder Abschnitt den Artikel trägt; ein Teil ist so unfertig wie keiner (der Kreis bleibt dann halb).
    return { text: teile.join(" · "), ton: wikiVon(row) === "jeder" ? "gut" : "warnung" };
}

export function zeileVon(row: EditorPathRow): ListenZeile {
    return {
        key: row.id,
        name: wegName(row),
        kreis: row.circle,
        facetten: { stand: standVon(row), wiki: wikiVon(row), art: artVon(row) },
        rechts: artName(artVon(row)),
        unter: unterzeile(row),
        rang: { abschnitte: -row.segments, kreis: KREIS_RANG[row.circle] },
        ...(row.deleted ? { zaehltNicht: true as const } : {}),
    };
}

export const WEGE_OPTIONEN: ListenOptionen = {
    form: "flach",
    facetten: ["stand", "wiki", "art"],
    // „Gelöscht“ ist standardmäßig aus (T54).
    vorbelegt: new Map([["stand", new Set(["aufDerKarte", "nichtAufDerKarte"])]]),
    sortierungen: { name: nachName, abschnitte: nachRang("abschnitte"), kreis: nachRang("kreis") },
};

export const sortierungsName = (wert: string): string =>
    wert === "abschnitte"
        ? t("kraftlinieneditor.sortierung.abschnitte")
        : wert === "kreis"
          ? t("editorListe.sortierung.kreis")
          : t("editorListe.sortierung.name");

/** Die Liste vom Server, mit `no-cache` wie die Kraftlinien: Ein unveränderter Stand kommt als 304 aus dem Cache des Browsers. */
export async function ladeWege(
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<EditorPathList> {
    let antwort: Response;
    try {
        antwort = await fetcher(EDITOR_PATHS_URL, {
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
    if (antwort.ok) return body as EditorPathList;
    const fehler = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    throw new ApiFailure(
        antwort.status,
        typeof fehler?.code === "string" ? fehler.code : antwort.status >= 500 ? "unavailable" : "failed",
        typeof fehler?.message === "string" ? fehler.message : antwort.statusText,
    );
}
