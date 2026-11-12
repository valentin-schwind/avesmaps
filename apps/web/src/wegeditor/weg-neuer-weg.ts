import {
    EDITOR_PATHS_NEUER_WEG_URL,
    pathReaderName,
    type EditorPathStreet,
    type PathNeuerWegBody,
    type PathNeuerWegReceipt,
} from "@avesmaps3d/shared";
import { newOperationId, type Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import type { MessageKey } from "../i18n/i18n";

/**
 * „Auswahl zu neuem Weg“ im Browser (WI-0252; Betreiber 2026-10-24: „schön wäre, wenn es einen button "Auswahl zu neuem Weg" geben könnte
 * (bei Form bzw. im kontextmenü). bestehende zuweisungen werden aufgehoben und die neue straße kann einen namen bekommen (alles was
 * "gemischt" wird dann zu einem namen)“; Schreibweg `path.regroup`, `editor-path-sammel.ts`).
 *
 * - **Die Auswahl** eines Wege-Fensters sind Abschnitte: mit Mehrfachauswahl alle Abschnitte der angehakten Wege, sonst die mit der Leiste
 *   (1) (2) … gewählten Abschnitte EINES Wegs, wenn es nicht alle sind (`auswahlAus`). Nur auf der Karte.
 * - **Der Name**: Heißen alle gewählten Wege gleich, steht ihr Name vor; sonst ist das Feld leer und nennt „gemischt“ (`namensVorschlag`).
 *   Ein Griff („Pfad-3443“) ist kein Name (WI-0105, `pathReaderName`), leer auch nicht (`namensGrund`).
 */

export interface WegAuswahl {
    /** Die gewählten Abschnitte mit der Revision, die das Fenster gelesen hat. */
    readonly abschnitte: readonly { readonly publicId: string; readonly baseRevision: number }[];
    /** Je Abschnitt sein Wegtyp (für die Prüfung „ein Griff ist kein Name“). */
    readonly arten: readonly string[];
    /** Die echten Namen der beteiligten Wege, je einmal; ein Weg ohne Namen zählt als „“. */
    readonly namen: readonly string[];
}

/** Die Auswahl aus gelesenen Straßen, beschränkt auf die genannten Abschnitte (ohne Angabe alle). Abseits der Karte keine. */
export function auswahlAus(strassen: readonly EditorPathStreet[], nur?: ReadonlySet<string>): WegAuswahl | undefined {
    if (strassen.some((s) => s.offMap === true || s.deleted === true)) return undefined;
    const teile = strassen.flatMap((strasse) =>
        strasse.segments.filter((a) => nur === undefined || nur.has(a.id)).map((abschnitt) => ({ strasse, abschnitt })),
    );
    if (teile.length === 0) return undefined;
    const beteiligt = [...new Set(teile.map(({ strasse }) => strasse))];
    return {
        abschnitte: teile.map(({ abschnitt }) => ({ publicId: abschnitt.id, baseRevision: abschnitt.revision })),
        arten: teile.map(({ strasse, abschnitt }) => abschnitt.art ?? abschnitt.subtype ?? strasse.subtype),
        namen: [...new Set(beteiligt.map((s) => pathReaderName(s.name, s.subtype) ?? ""))],
    };
}

/** Was im Namensfeld vorsteht: der gemeinsame echte Name, sonst nichts und „gemischt“. */
export function namensVorschlag(auswahl: Pick<WegAuswahl, "namen">): {
    readonly name: string;
    readonly gemischt: boolean;
} {
    const [einziger, ...rest] = auswahl.namen;
    return rest.length === 0 && einziger !== undefined
        ? { name: einziger, gemischt: false }
        : { name: "", gemischt: true };
}

/** Warum der Name nicht geht; `undefined`, wenn er geht. */
export function namensGrund(name: string, auswahl: Pick<WegAuswahl, "arten">): MessageKey | undefined {
    const getrimmt = name.trim();
    if (getrimmt === "") return "wegeditor.neuerWeg.grund.leer";
    if (auswahl.arten.some((art) => pathReaderName(getrimmt, art) === null)) return "wegeditor.neuerWeg.grund.griff";
    return undefined;
}

/** Schreibt „Auswahl zu neuem Weg“ als EINE Operation. */
export function schreibeNeuenWeg(
    fetcher: Fetcher,
    auswahl: WegAuswahl,
    name: string,
): Promise<SchreibAntwort<PathNeuerWegReceipt>> {
    const body: PathNeuerWegBody = {
        operationId: newOperationId(),
        name: name.trim(),
        sections: auswahl.abschnitte.map((a) => ({ publicId: a.publicId, baseRevision: a.baseRevision })),
    };
    return sende<PathNeuerWegReceipt>(EDITOR_PATHS_NEUER_WEG_URL, body, "POST", (eingabe, init) =>
        fetcher(String(eingabe), init),
    );
}
