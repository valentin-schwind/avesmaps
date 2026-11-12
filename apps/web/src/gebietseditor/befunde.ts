import {
    EDITOR_TERRITORY_FINDINGS_URL,
    EDITOR_TERRITORY_FINDING_KINDS,
    type EditorTerritoryFinding,
    type EditorTerritoryFindings,
} from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "../auth/api";
import { formatNumber, t } from "../i18n/i18n";

/**
 * „Prüfen“ im Gebietseditor (WI-0209 D6; EDIT-0005 §9 D6; Muster Ortseditor E20 `ortseditor/befunde.ts`): die Befunde vom Server
 * (`GET /api/editor/territories/findings`) als Sätze, **nie eine Sperre**. Reine Rechnung ohne Vue, damit Vitest sie prüft.
 *
 * - Je Gebiet die eigenen Befunde in fester Folge (N2, Lücke, Überlappung, Platzhalter, ungültig, Verweis, Hauptstadt).
 * - Für die Liste: welches Gebiet einen Befund trägt (Facette „Befund“).
 */

const RANG = new Map(EDITOR_TERRITORY_FINDING_KINDS.map((art, i) => [art, i]));

/** Die Befunde eines Gebiets, in der Folge der Arten. */
export function befundeDes(alle: EditorTerritoryFindings | undefined, id: string): EditorTerritoryFinding[] {
    return (alle?.findings ?? [])
        .filter((befund) => befund.territory === id)
        .sort((a, b) => (RANG.get(a.kind) ?? 0) - (RANG.get(b.kind) ?? 0));
}

/** Wie viele Befunde jedes Gebiet trägt. */
export function befundZahlen(alle: EditorTerritoryFindings | undefined): ReadonlyMap<string, number> {
    const zahl = new Map<string, number>();
    for (const befund of alle?.findings ?? []) zahl.set(befund.territory, (zahl.get(befund.territory) ?? 0) + 1);
    return zahl;
}

const baender = (befund: EditorTerritoryFinding): string => (befund.bands ?? []).join(", ");

/** Der Satz zu einem Befund. */
export function befundText(befund: EditorTerritoryFinding): string {
    switch (befund.kind) {
        case "n2":
            return t("gebietseditor.befund.n2", { baender: baender(befund) });
        case "luecke":
            return t("gebietseditor.befund.luecke", { baender: baender(befund) });
        case "ueberlappung":
            return t("gebietseditor.befund.ueberlappung", {
                name: befund.other?.name ?? "",
                groesse: formatNumber(befund.size ?? 0, befund.size !== undefined && befund.size < 1 ? 3 : 0),
            });
        case "platzhalter":
            return t("gebietseditor.befund.platzhalter");
        case "ungueltig":
            return t("gebietseditor.befund.ungueltig");
        case "verweis":
            return t(
                befund.field === "seat" ? "gebietseditor.befund.verweisSitz" : "gebietseditor.befund.verweisHauptstadt",
            );
        case "hauptstadt":
            return t("gebietseditor.befund.hauptstadt");
    }
}

/** Die Befunde vom Server; `no-cache` wie die Liste, ein unveränderter Stand kommt als 304. */
export function ladeBefunde(signal: AbortSignal, fetcher: Fetcher): Promise<EditorTerritoryFindings> {
    return getJson<EditorTerritoryFindings>(EDITOR_TERRITORY_FINDINGS_URL, (url, init) =>
        fetcher(url, { ...init, cache: "no-cache", signal }),
    );
}
