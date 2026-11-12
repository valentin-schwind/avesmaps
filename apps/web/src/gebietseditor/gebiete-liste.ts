import { EDITOR_TERRITORIES_URL, type EditorTerritoryList, type EditorTerritoryRow } from "@avesmaps3d/shared";
import { nachName, nachRang, type Kreis, type ListenOptionen, type ListenZeile } from "../editor-liste/liste-modell";
import { ApiFailure, type Fetcher } from "../auth/api";
import { isMessageKey, t } from "../i18n/i18n";

/**
 * Die Herrschaftsgebiete als Baum (WI-0209 Paket A2; EDIT-0005 §3; Muster `landschaftseditor/landschaften-liste.ts`): Der Adapter
 * macht aus den Zeilen des Lesepfads (`GET /api/editor/territories`, A1) die Zeilen des gemeinsamen Bauteils `editor-liste.vue` in der
 * Form `baum`; Regeln und Darstellung bleiben dort.
 *
 * - **Baum:** jedes Gebiet unter seinem gespeicherten Elter (`parent`); ein Treffer bringt seine Vorfahren als Zusammenhang mit
 *   (`liste-modell.ts`). Alle Gebiete stehen da, auch die 795 ohne eigene Fläche mit ○ an ihrem Platz (Frage 9, kein eigener Abschnitt).
 * - **Kreis nach Legacys Regel über die Untergebiete** (EDIT-0003 T26 (5)): vom Server; die Legende nennt Legacys Bedeutung, die bei
 *   Gebieten anders lautet als in den anderen Listen (`gebietseditor.kreis.*`).
 * - **Facetten:** Karte (mit eigener Fläche oder ohne), Jahr (gilt im Anzeigejahr oder nicht), Art, Befund („Prüfen“, D6: mit oder
 *   ohne; erst wenn die Befunde da sind), Stand (EDIT-0003 T54, Werte gemeinsam für alle Listen: auf der Karte, nicht auf der Karte wie
 *   Legacys ○, gelöscht; „Gelöscht“ ist standardmäßig aus).
 * - **Unterzeile:** die Zoomspanne (offene Grenzen als 0 und 8), ohne eigene Fläche, außerhalb des Jahrs.
 * - **Sortierung** wie Legacys Baum: zuerst die Reihenfolge der Geschwister (`sort_order`), dann Name oder Zustand.
 */

export const GEBIETE_FACETTEN = ["karte", "jahr", "art", "befund", "stand"] as const;
export const GEBIETE_SORTIERUNGEN = ["reihenfolge", "name", "kreis"] as const;

/** Sortiert nach „Zustand“ wie die anderen Listen: von ○ über ◐ und ◑ zu ●. */
const KREIS_RANG: Readonly<Record<Kreis, number>> = { leer: 0, halb: 1, "halb-rechts": 2, voll: 3 };

/** Legacys Bedeutung des Kreises im Baum der Gebiete (`wiki-sync-monitor.html`, coverage). */
export const GEBIETE_LEGENDE = (): Record<Kreis, string> => ({
    voll: t("gebietseditor.kreis.voll"),
    "halb-rechts": t("gebietseditor.kreis.halbRechts"),
    halb: t("gebietseditor.kreis.halb"),
    leer: t("gebietseditor.kreis.leer"),
});

/** Die Art (`territory.territory_type`) steht roh da, wie im Infopanel; ohne Art ein Wort dafür. */
export function artName(art: string | undefined): string {
    return art === undefined || art === "" ? t("gebietseditor.art.ohne") : art;
}

/** Der Name einer Facette für den Trichter: wie jede Facette des Registers (`nav.editorpanel.facette.*`). */
export function facettenName(id: string): string {
    const key = `nav.editorpanel.facette.${id}`;
    return isMessageKey(key) ? t(key) : id;
}

/** Der Name eines Facettenwerts für die Anzeige. */
export function wertName(facette: string, wert: string, jahr: number): string {
    if (facette === "karte")
        return t(wert === "eigene" ? "gebietseditor.flaeche.eigene" : "gebietseditor.flaeche.keine");
    if (facette === "jahr")
        return t(wert === "gilt" ? "gebietseditor.jahr.gilt" : "gebietseditor.jahr.giltNicht", { jahr });
    if (facette === "befund") return t(wert === "mit" ? "gebietseditor.befund.mit" : "gebietseditor.befund.ohne");
    if (facette === "stand") {
        const key = `editorListe.stand.${wert}`;
        return isMessageKey(key) ? t(key) : wert;
    }
    return artName(wert);
}

function unterzeile(
    row: EditorTerritoryRow,
    jahr: number,
    befunde: number | undefined,
): NonNullable<ListenZeile["unter"]> {
    if (row.deleted) return { text: t("editorListe.stand.geloescht"), ton: "warnung" };
    const teile = [t("gebietseditor.unter.spanne", { von: row.minZoom ?? 0, bis: row.maxZoom ?? 8 })];
    if (!row.area) teile.push(t("gebietseditor.unter.ohneFlaeche"));
    if (row.notInYear) teile.push(t("gebietseditor.jahr.giltNicht", { jahr }));
    if (befunde !== undefined && befunde > 0) teile.push(t("gebietseditor.unter.befunde", { n: befunde }));
    return { text: teile.join(" · "), ton: row.notInYear ? "warnung" : "leise" };
}

/**
 * Eine Zeile; `elternBekannt` falsch macht das Gebiet zur Wurzel (sein Elter steht nicht in der Liste). `befunde`: wie viele Befunde
 * das Gebiet trägt, fehlt, solange sie nicht geladen sind.
 */
export function zeileVon(
    row: EditorTerritoryRow,
    jahr: number,
    elternBekannt = true,
    befunde?: number | undefined,
): ListenZeile {
    return {
        key: row.id,
        name: row.name,
        kreis: row.circle,
        facetten: {
            karte: row.area ? "eigene" : "keine",
            jahr: row.notInYear ? "giltNicht" : "gilt",
            art: row.type ?? "",
            befund: befunde === undefined ? undefined : befunde > 0 ? "mit" : "ohne",
            stand: row.deleted ? "geloescht" : row.circle === "leer" ? "nichtAufDerKarte" : "aufDerKarte",
        },
        rechts: artName(row.type),
        unter: unterzeile(row, jahr, befunde),
        ...(row.parent && elternBekannt ? { eltern: row.parent } : {}),
        rang: { reihenfolge: row.order, kreis: KREIS_RANG[row.circle] },
        ...(row.deleted ? { zaehltNicht: true as const } : {}),
    };
}

/**
 * Alle Zeilen der Liste; ein Elter, der nicht mehr in der Liste steht, macht das Gebiet zur Wurzel. `befunde`: Zahl je Gebiet
 * (`befundZahlen`), fehlt, solange sie nicht geladen sind.
 */
export function zeilenVon(list: EditorTerritoryList, befunde?: ReadonlyMap<string, number>): ListenZeile[] {
    const da = new Set(list.rows.map((row) => row.id));
    return list.rows.map((row) =>
        zeileVon(
            row,
            list.yearBf,
            row.parent === undefined || da.has(row.parent),
            befunde === undefined ? undefined : (befunde.get(row.id) ?? 0),
        ),
    );
}

export const GEBIETE_OPTIONEN: ListenOptionen = {
    form: "baum",
    facetten: GEBIETE_FACETTEN,
    // Gelöschtes steht nur unter „Gelöscht“ (EDIT-0003 T54): Vorbelegt ist alles andere; es zählt wie jede Wahl im Trichter.
    vorbelegt: new Map([["stand", new Set<string>(["aufDerKarte", "nichtAufDerKarte"])]]),
    sortierungen: { reihenfolge: nachRang("reihenfolge"), name: nachName, kreis: nachRang("kreis") },
};

export const sortierungsName = (wert: string): string =>
    wert === "reihenfolge"
        ? t("gebietseditor.sortierung.reihenfolge")
        : wert === "kreis"
          ? t("editorListe.sortierung.kreis")
          : t("editorListe.sortierung.name");

/**
 * Die Liste vom Server, mit `no-cache` wie die Landschaften: Der Browser fragt mit `If-None-Match` nach und nimmt einen unveränderten
 * Stand als 304 aus seinem Cache (rund 1.700 Zeilen).
 */
export async function ladeGebiete(
    signal: AbortSignal,
    fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<EditorTerritoryList> {
    let antwort: Response;
    try {
        antwort = await fetcher(EDITOR_TERRITORIES_URL, {
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
    if (antwort.ok) return body as EditorTerritoryList;
    const fehler = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
    throw new ApiFailure(
        antwort.status,
        typeof fehler?.code === "string" ? fehler.code : antwort.status >= 500 ? "unavailable" : "failed",
        typeof fehler?.message === "string" ? fehler.message : antwort.statusText,
    );
}
