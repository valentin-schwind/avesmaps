import { computed, shallowRef, type ComputedRef } from "vue";
import type { OperationReceipt } from "@avesmaps3d/shared";

/**
 * Gespeicherte Gebietsflächen, die die Karte noch nicht zeigt (WI-0209; Betreiberfunde 2026-10-19: „ich habe ein neues herrschaftsgebiet
 * erstellt aber es ist dann sofort von der karte verschwunden“ und „wenn ich … ein untergebiet in seiner form ändere, hat das nur
 * auswirkungen auf die kontur …“). Die politische Karte zeichnet Gebiete nur aus der Ableitung `territory_derive`; die wartet nach jeder
 * Speicherung die Sammelzeit ab und rechnet dann (Stage 2026-10-19: 120 s und 48 s). Bis dahin zeigt die Karte hier, was gespeichert ist:
 * gestrichelt über den gemeinsamen Baustein `map/entwurfs-flaechen.ts`, mit der eigenen Ebenenkennung `GEBIETE_EBENE`.
 *
 * - **Hinein** nach einer erfolgreichen Speicherung: ein neues Gebiet oder eine neue Grenze („Neue Fläche“, C3) mit ihrem Ring, eine
 *   geänderte Form (C1) mit jeder geschriebenen Fläche, auch den mitgezogenen der Nachbarn. Je Fläche mit dem Auftrag aus der Quittung
 *   (`derivedWork`); eine spätere Speicherung derselben Fläche ersetzt die frühere.
 * - **Hinaus**, wenn dieser Auftrag die Gebiete neu abgeleitet hat (`map.changed` mit seiner Kennung): Dann zeichnen die Kacheln die Fläche
 *   selbst. Ein anderer Auftrag nimmt sie nicht mit, denn er las die Eingabe vielleicht vor der Speicherung. Ohne Meldung (der Auftrag fand
 *   nichts zu rechnen) fällt eine Fläche nach `AUSSTEHEND_HOECHSTENS_MS` weg.
 * - **Farbe:** die der Speicherung, sonst die des Gebiets aus der Liste des Gebietseditors, sonst Legacys Grau.
 */

/** Die Ebenenkennung der Gebiete im Baustein der Entwurfsflächen; gezeichnet wird, wo die Karte die Gebietsfüllung zeigt. */
export const GEBIETE_EBENE = "herrschaftsgebiete";
/** So lange bleibt eine Fläche höchstens stehen, wenn keine Ableitung sie meldet. */
export const AUSSTEHEND_HOECHSTENS_MS = 10 * 60_000;
const GRAU = "#888888";

type Ring = readonly (readonly [number, number])[];

export interface AusstehendeFlaeche {
    /** Die Fläche (`territory_area.public_id`). */
    readonly flaeche: string;
    /** Das Gebiet, dem sie gehört. */
    readonly gebiet: string;
    readonly farbe?: string | undefined;
    /** Je Polygon die Ringe (außen, dann Löcher), in Kartenkoordinaten ohne Schlusspunkt. */
    readonly polygone: readonly (readonly Ring[])[];
    /** Der Auftrag `territory_derive`, der sie ableiten wird (aus der Quittung). */
    readonly job?: string | undefined;
}

/** Die Form, die `map/entwurfs-flaechen.ts` zeichnet (`EntwurfsFlaeche`). */
export interface GezeichneteFlaeche {
    readonly id: string;
    readonly ebene: string;
    readonly farbe: string;
    readonly polygone: readonly (readonly Ring[])[];
}

export interface AusstehendeGebiete {
    readonly flaechen: ComputedRef<readonly GezeichneteFlaeche[]>;
    merke(neu: readonly AusstehendeFlaeche[]): void;
    /** Ein Auftrag hat abgeleitet; ohne Kennung (unbekannt) gehen alle. */
    abgeleitet(job?: string): void;
}

/** Der Auftrag `territory_derive` aus der Quittung einer Operation. */
export const ableitungAus = (receipt: Pick<OperationReceipt, "derivedWork">): string | undefined =>
    receipt.derivedWork.find((arbeit) => arbeit.kind === "territory_derive")?.jobId ?? undefined;

export function createAusstehendeGebiete(optionen: {
    /** Die Farbe eines Gebiets (aus der Liste des Gebietseditors). */
    farbe(gebiet: string): string | undefined;
    jetzt?: () => number;
}): AusstehendeGebiete {
    const jetzt = optionen.jetzt ?? (() => Date.now());
    const liste = shallowRef<readonly (AusstehendeFlaeche & { readonly seit: number })[]>([]);
    const frisch = () => liste.value.filter((f) => jetzt() - f.seit < AUSSTEHEND_HOECHSTENS_MS);
    return {
        flaechen: computed(() =>
            liste.value.map((f) => ({
                id: f.flaeche,
                ebene: GEBIETE_EBENE,
                farbe: f.farbe ?? optionen.farbe(f.gebiet) ?? GRAU,
                polygone: f.polygone,
            })),
        ),
        merke(neu) {
            if (neu.length === 0) return;
            const ersetzt = new Set(neu.map((f) => f.flaeche));
            const seit = jetzt();
            liste.value = [...frisch().filter((f) => !ersetzt.has(f.flaeche)), ...neu.map((f) => ({ ...f, seit }))];
        },
        abgeleitet(job) {
            const bleibt = frisch().filter((f) => job !== undefined && f.job !== undefined && f.job !== job);
            if (bleibt.length !== liste.value.length) liste.value = bleibt;
        },
    };
}
