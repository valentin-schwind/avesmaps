import {
    landscapeCopyLayers,
    type EditorLandscapeDetail,
    type EditorLandscapeLayer,
    type EditorLandscapeRow,
    type LandscapeCopyBody,
} from "@avesmaps3d/shared";
import type { MessageKey } from "../i18n/i18n";
import { sprachKopierPlan, type SprachKopierWahl, type SprachZiel } from "../spracheditor/sprachflaeche-kopieren";

/**
 * Das Blatt „Fläche kopieren“ (WI-0178 Werkzeug 8, Betreiber 2026-10-19 wörtlich: „wie legacy B mit haken“; Legacy
 * `map-features-ecosystem-transfer.js`): die Regeln, die eine Entscheidung tragen, ohne Oberfläche, damit sie sich prüfen lassen.
 *
 * - **Zielebene:** der Zwilling zuerst (Vegetation ↔ Topographie), die eigene Ebene ZULETZT: Eine Kopie dort liegt deckungsgleich auf
 *   ihrer Quelle und darf nie die vorgewählte Antwort sein (`landscapeCopyLayers`).
 * - **Ziellandschaft:** zuerst „Neue Landschaft anlegen“ (der häufige Fall, Legacy), darunter die Landschaften der Zielebene auf der Karte.
 *   Bei jedem Wechsel der Ebene wieder „neu“: Ein mitgenommener Wert hängte die Kopie an eine Landschaft, die niemand gemeint hat.
 * - **Name und Art** nur für eine neue: der Name der Quelle vorbelegt, die Art leer und aus der Zielebene (die Art der Quelle gehört zu
 *   ihrer Ebene). Der Wiki-Artikel reist nur unter demselben Namen; das Blatt sagt es.
 * - **„Originalfläche löschen“** steht immer zuerst aus; darunter, was es der Quelle antut (die letzte Teilfläche nimmt die Landschaft mit,
 *   außer das Ziel ist ihre eigene Landschaft).
 * - **Ziel „Sprachen“** (WI-0261; Betreiber 2026-10-31: „Ja, bauen“): als letzte Wahl der Zielebene, nur mit Recht an den Sprachen. Dann ist das Ziel eine
 *   bestehende Sprache oder „Neue Sprache …“ wie im Kopierblatt des Spracheditors (`spracheditor/sprachflaeche-kopieren.ts`, dieselben Regeln und Wörter);
 *   kopiert wird dieselbe Einheit (die Teilfläche unter dem Kartenmenü) als EINE neue Teilfläche der Sprache. Kein Name und keine Art einer Landschaft, kein
 *   Wiki-Satz und kein „Originalfläche löschen“: Die Landschaft bleibt unberührt.
 */

/** Die Wahl „Sprachen“ in der Zielebene: keine Ebene der Landschaften, sondern das Ziel Sprache. */
export const SPRACHEN_ZIEL = "sprachen" as const;

/** Was das Blatt schickt; Kennung, Teilfläche und Revision setzt die Steuerung. */
export type KopierZiel = Omit<LandscapeCopyBody, "operationId" | "areaId" | "baseRevision">;

export interface KopierWahl {
    readonly ebene: EditorLandscapeLayer;
    /** Die Ziellandschaft; leer: eine neue. */
    readonly ziel: string;
    readonly name: string;
    /** Die Art der neuen; leer: ohne Art. */
    readonly art: string;
    readonly loeschen: boolean;
}

/** Die Wahl beim Öffnen: der Zwilling, eine neue Landschaft unter dem Namen der Quelle, ohne Art, ohne Haken. */
export function startWahl(quelle: Pick<EditorLandscapeDetail, "layer" | "name">): KopierWahl {
    return { ebene: landscapeCopyLayers(quelle.layer)[0]!, ziel: "", name: quelle.name, art: "", loeschen: false };
}

/** Die Zielebenen des Blatts: die der Landschaften (`landscapeCopyLayers`), mit Recht an den Sprachen zuletzt „Sprachen“. */
export function zielEbenen(
    quelle: EditorLandscapeLayer,
    mitSprachen: boolean,
): (EditorLandscapeLayer | typeof SPRACHEN_ZIEL)[] {
    return [...landscapeCopyLayers(quelle), ...(mitSprachen ? [SPRACHEN_ZIEL] : [])];
}

/** Der Plan für das Ziel Sprache (die Regeln des Kopierblatts der Sprachen, ohne „Originalfläche löschen“) oder der Satz, warum es so nicht geht. */
export function sprachPlan(wahl: Omit<SprachKopierWahl, "loeschen">): { ziel: SprachZiel } | { fehler: MessageKey } {
    const plan = sprachKopierPlan({ ...wahl, loeschen: false });
    if ("fehler" in plan) return plan;
    return {
        ziel: "targetId" in plan.ziel ? { targetId: plan.ziel.targetId } : { neueSprache: plan.ziel.neueSprache },
    };
}

/** Die Landschaften der Ebene, die eine Kopie aufnehmen können: auf der Karte, nach Namen. */
export function zielLandschaften(
    zeilen: readonly EditorLandscapeRow[],
    ebene: EditorLandscapeLayer,
    sprache?: string,
): EditorLandscapeRow[] {
    return zeilen
        .filter((zeile) => zeile.layer === ebene && zeile.state === undefined)
        .sort((a, b) => a.name.localeCompare(b.name, sprache));
}

/** Der Plan oder der Satz, warum es so nicht geht (geprüft, BEVOR etwas geschrieben wird). */
export function kopierPlan(wahl: KopierWahl): { ziel: KopierZiel } | { fehler: MessageKey } {
    if (wahl.ziel !== "") return { ziel: { layer: wahl.ebene, targetId: wahl.ziel, deleteSource: wahl.loeschen } };
    const name = wahl.name.trim();
    if (name === "") return { fehler: "landschaftseditor.kopieren.nameFehlt" };
    return {
        ziel: {
            layer: wahl.ebene,
            name,
            ...(wahl.art === "" ? {} : { type: wahl.art }),
            deleteSource: wahl.loeschen,
        },
    };
}

/** Der Satz zum Wiki-Artikel einer neuen Landschaft; `undefined` ohne Artikel oder mit bestehendem Ziel. */
export function wikiSatz(
    quelle: Pick<EditorLandscapeDetail, "name" | "wiki">,
    wahl: KopierWahl,
): "landschaftseditor.kopieren.wikiMit" | "landschaftseditor.kopieren.wikiOhne" | undefined {
    if (wahl.ziel !== "" || quelle.wiki === undefined) return undefined;
    return wahl.name.trim() === quelle.name.trim()
        ? "landschaftseditor.kopieren.wikiMit"
        : "landschaftseditor.kopieren.wikiOhne";
}

/** Was der Haken der Quelle antut; `undefined` ohne Haken. */
export function loeschFolge(
    quelle: Pick<EditorLandscapeDetail, "id" | "areas">,
    wahl: KopierWahl,
): "landschaftseditor.kopieren.folgeLetzte" | "landschaftseditor.kopieren.folge" | undefined {
    if (!wahl.loeschen) return undefined;
    return quelle.areas.length === 1 && wahl.ziel !== quelle.id
        ? "landschaftseditor.kopieren.folgeLetzte"
        : "landschaftseditor.kopieren.folge";
}
