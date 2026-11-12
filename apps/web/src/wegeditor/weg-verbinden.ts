import {
    EDITOR_PATHS_VERBINDEN_URL,
    type EditorPathStreet,
    type PathVerbindenBody,
    type PathVerbindenGrund,
    type PathVerbindenPruefung,
    type PathVerbindenReceipt,
} from "@avesmaps3d/shared";
import { getJson, newOperationId, type Fetcher } from "../auth/api";
import type { HandgriffWahl } from "../editor-menu/action";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import type { MessageKey } from "../i18n/i18n";
import { wegName } from "./wegeditor-texte";

/**
 * „Wege verbinden ›“ im Browser (WI-0252; Betreiber 2026-10-24: „wenn ich mehrere abschnitte eines weges auswähle, sollen bei mehreren
 * wegen, die "aneinenaderhängen" beim rechtsklick über "Weg entfernen" die menü option "Wege verbinden" stehen. ähnlich wie bei
 * "wegkurve bearbeiten" kann ich dann im untermenü auswählen wessen abschnittseinstellungen dann übernommen werden sollen.“; Server
 * `path-verbinden.ts`).
 *
 * - **Die Auswahl** eines Wege-Fensters als Abschnitte: mit Mehrfachauswahl alle Abschnitte der angehakten Wege, sonst die mit der Leiste
 *   gewählten EINES Wegs, (W) heißt alle seine Abschnitte; mindestens zwei (`verbindenAuswahlAus`).
 * - **Ob es geht**, sagt der Server (`GET …/verbinden?ids=`, dieselbe Rechnung wie beim Schreiben): die Kette in ihrer Folge oder der Grund.
 *   Das Untermenü listet die Abschnitte in Kettenfolge „n · Name (Wegtyp) · Von – Bis“, Zeigen lässt jeden auf der Karte leuchten; die Wahl
 *   ist die Vorlage, deren Abschnittseinstellungen der verbundene Weg trägt.
 */

/** Ein gewählter Abschnitt mit dem, was das Untermenü von ihm nennt. */
export interface VerbindenTeil {
    readonly publicId: string;
    readonly baseRevision: number;
    readonly name: string;
    readonly art: string;
    readonly von: string | undefined;
    readonly bis: string | undefined;
}

/** Die Abschnitte der Straßen, beschränkt auf die genannten (ohne Angabe alle); abseits der Karte oder unter zwei keine. */
export function verbindenAuswahlAus(
    strassen: readonly EditorPathStreet[],
    nur?: ReadonlySet<string>,
): VerbindenTeil[] | undefined {
    if (strassen.some((s) => s.offMap === true || s.deleted === true)) return undefined;
    const teile = strassen.flatMap((strasse) =>
        strasse.segments
            .filter((a) => nur === undefined || nur.has(a.id))
            .map((a): VerbindenTeil => ({
                publicId: a.id,
                baseRevision: a.revision,
                name: wegName(strasse),
                art: (a.bach ?? strasse.isBach) ? "Bach" : (a.art ?? a.subtype ?? strasse.subtype),
                von: a.von,
                bis: a.bis,
            })),
    );
    return teile.length < 2 ? undefined : teile;
}

/** Der Schlüssel einer Auswahl für die Prüfung: ihre Kennungen, geordnet. */
export const pruefSchluessel = (teile: readonly Pick<VerbindenTeil, "publicId">[]): string =>
    teile
        .map((t) => t.publicId)
        .sort()
        .join(",");

/** Die Prüfung beim Server. */
export function ladePruefung(fetcher: Fetcher, teile: readonly VerbindenTeil[]): Promise<PathVerbindenPruefung> {
    return getJson<PathVerbindenPruefung>(
        `${EDITOR_PATHS_VERBINDEN_URL}?ids=${encodeURIComponent(pruefSchluessel(teile))}`,
        (url, init) => fetcher(url, { ...init, cache: "no-store" }),
    );
}

/** Warum es nicht geht, als Satz des Menüs. */
export const VERBINDEN_GRUND: Readonly<Record<PathVerbindenGrund | "fehler" | "zuViele", MessageKey>> = {
    anzahl: "wegeditor.verbinden.grund.kette",
    karte: "wegeditor.verbinden.grund.karte",
    art: "wegeditor.verbinden.grund.art",
    kette: "wegeditor.verbinden.grund.kette",
    netz: "wegeditor.verbinden.grund.netz",
    punkte: "wegeditor.verbinden.grund.punkte",
    zuViele: "wegeditor.verbinden.grund.zuViele",
    fehler: "wegeditor.verbinden.grund.fehler",
};

/**
 * Die Wahlen des Untermenüs: die Abschnitte in Kettenfolge (sonst in der Folge der Auswahl), „n · Name (Wegtyp) · Von – Bis“, mit
 * Vorschau auf der Karte.
 */
export function verbindenWahlen(
    teile: readonly VerbindenTeil[],
    pruefung: PathVerbindenPruefung | undefined,
    texte: { readonly abzweig: string; readonly art: (art: string) => string },
): HandgriffWahl[] {
    const je = new Map(teile.map((t) => [t.publicId, t] as const));
    const folge = pruefung?.kette
        ?.map((g) => je.get(g.publicId))
        .filter((t): t is VerbindenTeil => t !== undefined) ?? [...teile];
    return folge.map((t, i) => ({
        id: t.publicId,
        text: `${String(i + 1)} · ${t.name} (${texte.art(t.art)}) · ${t.von ?? texte.abzweig} – ${t.bis ?? texte.abzweig}`,
        vorschau: true as const,
    }));
}

/** „Wege verbinden“ mit der Vorlage als EINE Operation. */
export function schreibeVerbinden(
    fetcher: Fetcher,
    teile: readonly VerbindenTeil[],
    vorlage: string,
): Promise<SchreibAntwort<PathVerbindenReceipt>> {
    const body: PathVerbindenBody = {
        operationId: newOperationId(),
        vorlage,
        sections: teile.map((t) => ({ publicId: t.publicId, baseRevision: t.baseRevision })),
    };
    return sende<PathVerbindenReceipt>(EDITOR_PATHS_VERBINDEN_URL, body, "POST", (eingabe, init) =>
        fetcher(String(eingabe), init),
    );
}
