import { shallowRef, type ShallowRef } from "vue";
import {
    editorPathStreetUrl,
    pathReaderName,
    type EditorPathRow,
    type EditorPathStreet,
    type EditorPathStreetSegment,
} from "@avesmaps3d/shared";
import { getJson, type Fetcher } from "../auth/api";
import { ueberAlle, type Ueber } from "../fenster/sammel";
import { WEG_NAME_MARKE } from "../map/mehrfach-markierung";
import { nacheinander } from "../ortseditor/ort-sammel";

/**
 * Die Mehrfachauswahl der Wege (WI-0252; Muster `kraftlinieneditor/kraftlinie-sammel.ts`, EDIT-0003 T57): Die Häkchen stehen in der Liste
 * (`EditorListe v-model:mehrfach v-model:angehakt`, gehalten je Fenster in `wegeditor-steuerung.ts`); ab zwei angehakten Wegen zeigt das
 * Fenster statt der Eigenschaften eines Wegs diese Auswahl (`weg-sammel.vue`).
 *
 * - **Ein Weg ist sein Name** (WI-0177 Schritt 2): Angehakt wird eine Zeile der Liste, also eine Straße samt allen Abschnitten. Ein
 *   Umschalt-Klick auf einen Abschnitt nimmt seine Straße auf (wie die Kraftlinie ihre Linie); ein namenloser Abschnitt ist ein Weg für sich.
 * - Gelesen werden die Straßen (`GET …/street`), höchstens sechs zugleich (`nacheinander`): Sie tragen die Abschnitte mit ihren Werten und
 *   Revisionen. Gleiche Werte stehen normal da, verschiedene als „gemischt“ (`sammelWerte`).
 * - Die Auswahl ist flüchtig: Ein anderer Satz Häkchen beginnt eine neue; sie hält keine Sperre.
 */

export interface WegSammel {
    /** Die Anker der angehakten Straßen, in der Folge des Anhakens. */
    readonly ids: readonly string[];
    /** Die gelesenen Straßen; bis alle da sind, steht „wird gelesen“. */
    readonly strassen: Readonly<ShallowRef<ReadonlyMap<string, EditorPathStreet>>>;
    readonly ladeFehler: Readonly<ShallowRef<boolean>>;
    /** Die Zeilen der Liste, soweit angehakt (für Namen und Stand). */
    zeilen(): readonly EditorPathRow[];
    /** Neu lesen (nach einer Änderung an Wegen). */
    neuLesen(): Promise<void>;
    destroy(): void;
}

export interface WegSammelOptionen {
    readonly fetcher: Fetcher;
    /** Die Liste, wie sie gerade steht. */
    zeilen(): readonly EditorPathRow[];
}

/** Ein Abschnitt mit seiner Straße (für die Werte, die je Abschnitt stehen). */
export interface SammelAbschnitt {
    readonly strasse: EditorPathStreet;
    readonly abschnitt: EditorPathStreetSegment;
}

/** Alle Abschnitte der gelesenen Straßen, in der Folge der Auswahl und je Straße in ihrer Folge. */
export function abschnitteDer(strassen: readonly EditorPathStreet[]): SammelAbschnitt[] {
    return strassen.flatMap((strasse) => strasse.segments.map((abschnitt) => ({ strasse, abschnitt })));
}

/** Der Wegtyp eines Abschnitts als Wahl der Liste: sein eigener, sonst der der Straße; ein Bach als „Bach“. */
export const artDes = ({ strasse, abschnitt }: SammelAbschnitt): string =>
    (abschnitt.bach ?? strasse.isBach) ? "Bach" : (abschnitt.art ?? abschnitt.subtype ?? strasse.subtype);

/** Was die Mehrfachauswahl zeigt: je Feld gleich (mit Wert) oder gemischt. */
export interface SammelWerte {
    /** Der echte Name (nie ein Griff, WI-0105); ein Weg ohne Namen zählt als leer. */
    readonly name: Ueber<string>;
    readonly wegtyp: Ueber<string>;
    readonly karawanenroute: Ueber<boolean>;
    readonly nameAufKarte: Ueber<boolean>;
    readonly tunnel: Ueber<boolean>;
    /** Der Artikel (sein Titel, sonst seine Adresse); ohne Artikel leer. */
    readonly artikel: Ueber<string>;
    /** Wie viele Abschnitte die Auswahl hat. */
    readonly abschnitte: number;
}

export function sammelWerte(strassen: readonly EditorPathStreet[]): SammelWerte {
    const teile = abschnitteDer(strassen);
    return {
        name: ueberAlle(strassen, (s) => pathReaderName(s.name, s.subtype) ?? ""),
        wegtyp: ueberAlle(teile, artDes),
        karawanenroute: ueberAlle(teile, ({ abschnitt }) => abschnitt.mark === "karawanenroute"),
        nameAufKarte: ueberAlle(teile, ({ abschnitt }) => abschnitt.labelVisible),
        tunnel: ueberAlle(teile, ({ abschnitt }) => abschnitt.tunnel === true),
        artikel: ueberAlle(teile, ({ strasse, abschnitt }) =>
            abschnitt.wiki ? (strasse.wiki?.title ?? strasse.wiki?.url ?? "") : "",
        ),
        abschnitte: teile.length,
    };
}

/**
 * Die Marke einer Zeile für die Karte (`mehrfach-markierung.ts`, Art `path`): eine Straße mit echtem Namen als `name:<Name>` (alle ihre
 * Abschnitte leuchten), ein namenloser Abschnitt als seine Kennung. Was nicht auf der Karte ist, trägt die Kennung und leuchtet nirgends.
 */
export function wegMarke(row: Pick<EditorPathRow, "id" | "name" | "subtype" | "offMap" | "deleted">): string {
    const name = pathReaderName(row.name, row.subtype);
    return name === null || row.offMap === true || row.deleted === true ? row.id : `${WEG_NAME_MARKE}${row.name}`;
}

export function createWegSammel(ids: readonly string[], optionen: WegSammelOptionen): WegSammel {
    const strassen = shallowRef<ReadonlyMap<string, EditorPathStreet>>(new Map());
    const ladeFehler = shallowRef(false);
    const steuer = new AbortController();
    // Immer frisch (Revisionen) und abbrechbar, wenn die Auswahl wechselt.
    const holen: Fetcher = (url, init) => optionen.fetcher(url, { ...init, cache: "no-store", signal: steuer.signal });

    async function lade(): Promise<void> {
        try {
            const gelesen = await nacheinander(ids, (id) => getJson<EditorPathStreet>(editorPathStreetUrl(id), holen));
            if (!steuer.signal.aborted) {
                ladeFehler.value = false;
                strassen.value = new Map(ids.map((id, i) => [id, gelesen[i]!] as const));
            }
        } catch {
            if (!steuer.signal.aborted) ladeFehler.value = true;
        }
    }
    void lade();

    return {
        ids,
        strassen,
        ladeFehler,
        zeilen: () => {
            const je = new Map(optionen.zeilen().map((row) => [row.id, row] as const));
            return ids.flatMap((id) => (je.has(id) ? [je.get(id)!] : []));
        },
        neuLesen: lade,
        destroy() {
            steuer.abort();
        },
    };
}
