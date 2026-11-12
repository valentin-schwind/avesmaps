import {
    EDITOR_POWERLINES_URL,
    type EditorPowerlineList,
    type EditorPowerlineRow,
    type PowerlineShape,
} from "@avesmaps3d/shared";
import { nachName, nachRang, type Kreis, type ListenOptionen, type ListenZeile } from "../editor-liste/liste-modell";
import { ApiFailure, type Fetcher } from "../auth/api";
import { isMessageKey, t, tPlural, type MessageKey } from "../i18n/i18n";

/**
 * Die Kraftlinien als Liste (WI-0205 Paket K2; Muster `landschaftseditor/landschaften-liste.ts`): Der Adapter macht aus den Zeilen des
 * Lesepfads (`GET /api/editor/powerlines`, K1) die Zeilen des gemeinsamen Bauteils `editor-liste.vue`.
 *
 * - **Kreis je Abschnitt** (EDIT-0003 T28 (1)): vom Server; die Legende unter der Liste nennt die vier Zustände mit den Wörtern aller
 *   Listen (`editorListe.kreis.*`), wie bei Wegen „im Wiki“ nur, wenn jeder Abschnitt den Artikel trägt.
 * - **Facetten:** Wiki (an jedem Abschnitt, an einem Teil, ohne), Gestalt (Strang, Ring, verzweigt, in Teilen) und Stand (EDIT-0003 T54,
 *   Werte gemeinsam für alle Listen: auf der Karte, nicht auf der Karte, gelöscht; „Gelöscht“ ist standardmäßig aus, Gelöschtes zählt in
 *   keiner Legende).
 * - **Unterzeile:** Nodices und Abschnitte, die Teilzuordnung „Wiki an n von m Abschnitten“, die Enden eines Strangs, fehlende Knoten
 *   als Warnung.
 */

export const KRAFTLINIEN_SORTIERUNGEN = ["name", "abschnitte", "kreis"] as const;

const KREIS_RANG: Readonly<Record<Kreis, number>> = { leer: 0, halb: 1, "halb-rechts": 2, voll: 3 };

/** Die Wörter der Legende, für alle Listen gleich (`editorListe.kreis.*`). */
export const KRAFTLINIEN_LEGENDE = (): Record<Kreis, string> => ({
    voll: t("editorListe.kreis.voll"),
    halb: t("editorListe.kreis.halb"),
    "halb-rechts": t("editorListe.kreis.halbRechts"),
    leer: t("editorListe.kreis.leer"),
});

type Wiki = "jeder" | "teil" | "ohne";

function wikiVon(row: EditorPowerlineRow): Wiki {
    if (!row.wiki) return "ohne";
    return row.wikiSegments === undefined ? "jeder" : "teil";
}

const WIKI_NAMEN: Readonly<Record<Wiki, MessageKey>> = {
    jeder: "kraftlinieneditor.wiki.jeder",
    teil: "kraftlinieneditor.wiki.teil",
    ohne: "kraftlinieneditor.wiki.ohne",
};
const GESTALT_NAMEN: Readonly<Record<PowerlineShape, MessageKey>> = {
    strang: "kraftlinieneditor.gestalt.strang",
    ring: "kraftlinieneditor.gestalt.ring",
    verzweigt: "kraftlinieneditor.gestalt.verzweigt",
    teile: "kraftlinieneditor.gestalt.teile",
};

/** Der Name einer Gestalt. */
export const gestaltName = (gestalt: PowerlineShape): string => t(GESTALT_NAMEN[gestalt]);

/** Der Name einer Facette für den Trichter: wie jede Facette des Registers (`nav.editorpanel.facette.*`). */
export function facettenName(id: string): string {
    const key = `nav.editorpanel.facette.${id}`;
    return isMessageKey(key) ? t(key) : id;
}

/** Der Name eines Facettenwerts für die Anzeige. */
export function wertName(facette: string, wert: string): string {
    if (facette === "wiki") return t(WIKI_NAMEN[wert as Wiki] ?? "kraftlinieneditor.wiki.ohne");
    if (facette === "stand") {
        const key = `editorListe.stand.${wert}`;
        return isMessageKey(key) ? t(key) : wert;
    }
    return GESTALT_NAMEN[wert as PowerlineShape] ? gestaltName(wert as PowerlineShape) : wert;
}

/** Der Name eines Endes; ein Kraftlinienpunkt hat keinen. */
export const endName = (name: string): string => (name === "" ? t("kraftlinieneditor.punkt") : name);

function unterzeile(row: EditorPowerlineRow): NonNullable<ListenZeile["unter"]> {
    if (row.deleted) return { text: t("editorListe.stand.geloescht"), ton: "warnung" };
    if (row.missingNodes !== undefined)
        return {
            text: tPlural("kraftlinieneditor.unter.fehlt", row.missingNodes, { n: row.missingNodes }),
            ton: "warnung",
        };
    const teile = [tPlural("kraftlinieneditor.unter.nodices", row.nodes, { n: row.nodes })];
    teile.push(
        row.wikiSegments !== undefined
            ? t("kraftlinieneditor.unter.wikiTeil", { n: row.wikiSegments, von: row.segments })
            : tPlural("kraftlinieneditor.unter.abschnitte", row.segments, { n: row.segments }),
    );
    if (row.ends) teile.push(`${endName(row.ends[0])} ↔ ${endName(row.ends[1])}`);
    // Gut nur, wenn jeder Abschnitt den Artikel trägt; ein Teil ist so unfertig wie keiner (der Kreis bleibt dann halb).
    return { text: teile.join(" · "), ton: wikiVon(row) === "jeder" ? "gut" : "warnung" };
}

export function zeileVon(row: EditorPowerlineRow): ListenZeile {
    return {
        key: row.id,
        name: row.name === "" ? t("kraftlinieneditor.ohneName") : row.name,
        kreis: row.circle,
        facetten: {
            wiki: wikiVon(row),
            gestalt: row.shape,
            stand: row.deleted ? "geloescht" : row.offMap ? "nichtAufDerKarte" : "aufDerKarte",
        },
        rechts: gestaltName(row.shape),
        unter: unterzeile(row),
        rang: { abschnitte: -row.segments, kreis: KREIS_RANG[row.circle] },
        ...(row.deleted ? { zaehltNicht: true as const } : {}),
    };
}

export const KRAFTLINIEN_OPTIONEN: ListenOptionen = {
    form: "flach",
    facetten: ["wiki", "gestalt", "stand"],
    // Gelöschtes steht nur unter „Gelöscht“ (EDIT-0003 T54): Vorbelegt ist alles andere.
    vorbelegt: new Map([["stand", new Set<string>(["aufDerKarte", "nichtAufDerKarte"])]]),
    sortierungen: { name: nachName, abschnitte: nachRang("abschnitte"), kreis: nachRang("kreis") },
};

export const sortierungsName = (wert: string): string =>
    wert === "abschnitte"
        ? t("kraftlinieneditor.sortierung.abschnitte")
        : wert === "kreis"
          ? t("editorListe.sortierung.kreis")
          : t("editorListe.sortierung.name");

/** Die Liste vom Server, mit `no-cache` wie die Landschaften: Ein unveränderter Stand kommt als 304 aus dem Cache des Browsers. */
export async function ladeKraftlinien(
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<EditorPowerlineList> {
    let antwort: Response;
    try {
        antwort = await fetcher(EDITOR_POWERLINES_URL, {
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
    if (antwort.ok) return body as EditorPowerlineList;
    const fehler = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    throw new ApiFailure(
        antwort.status,
        typeof fehler?.code === "string" ? fehler.code : antwort.status >= 500 ? "unavailable" : "failed",
        typeof fehler?.message === "string" ? fehler.message : antwort.statusText,
    );
}
