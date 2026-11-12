import { watch } from "vue";
import type {
    LandscapeBooleanBody,
    LandscapeBooleanPreview,
    LandscapeBooleanPreviewBody,
    LandscapePartsBody,
    LandscapeSplitBody,
    OperationReceipt,
    PinselStrich,
} from "@avesmaps3d/shared";
import type { Bearbeitung } from "../../fenster/bearbeitung";
import type { MessageKey } from "../../i18n/i18n";
import { teileAus, type FormStand } from "./formentwurf";
import type { Punkt } from "./geometrie";

/**
 * Woran die Werkzeuge der Form an einer Fläche arbeiten (WI-0261 Stufe 2; Betreiber 2026-10-31, wörtlich: „beim editieren der sprachflächen wär es gut,
 * wenn wir die tools des flächeneditors hätten“): „Fläche vereinfachen“, „Verschieben“, „Fläche malen“ und „Fläche radieren“ der Derographie
 * (`landschaftseditor/flaeche-*.ts`) sind EIN Satz Modi; was sie lesen und wohin sie schreiben, sagt die Quelle. Die Modi nehmen sie beim Start
 * (`starte(…, quelle)`), ohne Angabe die Landschaft. Ziehen, Vorschau und Besitzer der Karte bleiben die des Geometrie-Moduls (`geometry-edit`).
 *
 * | Griff | Landschaft (`landschaftseditor/landschaft-flaechen.ts`) | Teilfläche einer Sprache (`spracheditor/sprachflaeche-werkzeuge.ts`) |
 * |---|---|---|
 * | `bearbeitung` | die Bearbeitung der Landschaft (öffnet ihr Fenster) | eine Bearbeitung der Teilfläche, ohne Felder |
 * | `lade` | alle Teilflächen, Nachbarn derselben Ebene, Flusspunkte; meldet den Aufbau an die Art | die eine Teilfläche; keine Nachbarn, keine Flüsse (E2, E4) |
 * | `strich` | `POST …/landscapes/:id/brush` | `POST …/sprachen/:id/flaechen/:flaeche/brush` |
 * | `getragen` | das Fenster der Landschaft steht | immer (kein Fenster trägt den Entwurf) |
 * | `mitNachbarn` | ja (feste Ecken, Gestensatz mit ihnen) | nein |
 *
 * 🔴 **Ein Entwurf** (EDIT-0003 G4, O3): Jedes Werkzeug ändert nur den Entwurf der Bearbeitung (`formEntwurf`); erst „Fertig“ schreibt, als EINE
 * Operation der Art (Landschaft `landscape.update`, Sprache `sprache_flaeche.reshape`). Der Strich des Pinsels rechnet nur.
 */

/** Was die Modi und ihre Leisten von einer Bearbeitung brauchen (`fenster/bearbeitung.ts`): Zustand, Lage, die Sicht auf die Form und „Fertig“. */
export type FormBearbeitung = Pick<
    Bearbeitung<unknown, unknown, FormStand>,
    "zustand" | "lage" | "formEntwurf" | "zurueck" | "wieder" | "verwerfen" | "fertig" | "antworte"
>;

/** Eine Fläche mit Kennung, Revision und Polygonen (Ringe ohne Schlusspunkt, je Polygon zuerst außen). */
export interface FlaechenForm {
    readonly id: string;
    readonly revision: number;
    readonly polygons: readonly (readonly (readonly [number, number])[])[][];
}

/** Was eine Quelle zum Start liest. */
export interface FlaechenGelesen {
    /** Der Name des Objekts in Leiste und Hinweis. */
    readonly name: string;
    /** Die eigenen Teilflächen. */
    readonly flaechen: readonly FlaechenForm[];
    /** Die Nachbarn derselben Ebene (Vereinfachen hält ihre gemeinsamen Ecken fest). */
    readonly nachbarn: readonly (FlaechenForm & { readonly name: string })[];
    /** Die Stützpunkte der Flüsse (ebenso fest). */
    readonly fluesse: readonly Punkt[];
}

export type StrichAntwort = { ok: true; polygons: [number, number][][][] } | { ok: false; satz: string };

export interface FlaechenQuelle<B extends FormBearbeitung = FormBearbeitung> {
    /** Die Bearbeitung des Objekts mit dem EINEN Entwurf; ohne Schreibrecht keine: Dann beginnt nichts. */
    bearbeitung(id: string): B | undefined;
    /** Das Objekt, wie die Werkzeuge es brauchen; `null`: Es gibt es nicht. Ein Fehler wirft. */
    lade(id: string, bearbeitung: B, signal: AbortSignal): Promise<FlaechenGelesen | null>;
    /** Ein Strich des Pinsels an dieser Teilfläche, gerechnet vom Server; ohne Pinsel keiner. */
    strich?(id: string, flaecheId: string, strich: PinselStrich): Promise<StrichAntwort>;
    /** Steht noch, was den Entwurf trägt (das Fenster)? Sonst endet der Modus, der Entwurf bleibt dort (D19, G5). */
    getragen(id: string): boolean;
    /** Das Werkzeug, dessen angedocktes Fenster seine Liste einzieht, solange der Modus läuft (`belegeGeometrie`, „Liste beim Modus“). */
    readonly werkzeug: string;
    /**
     * Spielen Nachbarn derselben Ebene und Flüsse mit (Landschaft ja, Sprache nein: E2, E4)? Nur dann gibt es feste Ecken, und nur dann nennt
     * die Leiste von „Fläche vereinfachen“ sie (Editor-Orchestrierung 2026-10-31: Der Gestensatz nennt nur, was an der Art gilt).
     */
    readonly mitNachbarn: boolean;
}

// ---------------------------------------------------------------------------------------------------------------------
// Die sofort schreibenden Werkzeuge (WI-0261 Stufe 3)
// ---------------------------------------------------------------------------------------------------------------------

/** Was eine Art einem sofort schreibenden Werkzeug antwortet: den Wert oder den Satz, warum nicht (schon in der Sprache der Seite). */
export type SofortAntwort<T> = { readonly ok: true; readonly wert: T } | { readonly ok: false; readonly satz: string };

type Ring = readonly (readonly [number, number])[];

/** Eine Teilfläche für diese Werkzeuge: der Name des Objekts (Leiste), ihre Stücke (je Polygon die Ringe ohne Schlusspunkt), ihre Revision. */
export interface SofortTeilflaeche {
    readonly name: string;
    readonly teile: readonly (readonly Ring[])[];
    readonly revision: number;
}

/** Ein Feature unter dem Zeiger, wie der Koordinator es liefert. */
export interface ZielFeature {
    readonly properties: Readonly<Record<string, unknown>>;
    readonly id?: string | number | undefined;
}

/** Wozu ein Werkzeug geschrieben hat: Danach meldet die Art, was nur sie sagt (an der Sprache „gespeichert“ nach „Mit anderer Fläche“). */
export type SofortWerkzeug = "unterflaechen" | "zerschneiden" | "mitAnderer";

/**
 * Woran „Unterflächen ›“, „Zerschneiden“ und „Mit anderer Fläche ›“ arbeiten (WI-0261 Stufe 3; Betreiber 2026-10-31: „bau weiter“): Die Werkzeuge der
 * Derographie (`landschaftseditor/unterflaechen.ts`, `zerschneiden.ts`, `mit-anderer-flaeche.ts`) sind EIN Satz Modi mit ihren Leisten; was sie lesen, wohin
 * sie schreiben und welche Flächen Ziele sind, sagt diese Quelle. Sie nehmen sie beim Start (`starte(…, quelle)`), ohne Angabe die Landschaft. Sie schreiben
 * nach Wahl und Vorschau sofort EINE Operation (Ausnahme von EDIT-0003 G4, an beiden Arten gleich).
 *
 * | Griff | Landschaft (`landschaftSofort`, `landschaftseditor/landschaft-flaechen.ts`) | Teilfläche einer Sprache (`spracheditor/sprachflaeche-sofort.ts`) |
 * |---|---|---|
 * | `lies` | das Detail der Landschaft | die Form der Teilfläche |
 * | `teile`, `schneide`, `vorschau`, `verknuepfe` | `POST …/landscapes/:id/parts`, `split`, `boolean-preview`, `boolean` | `POST …/sprachen/:id/flaechen/:flaeche/…`, unter der Sperre |
 * | `zielEbenen`, `ziel` | die gezeichneten Füllebenen (`landscape-fill-*`, Wasser: `flaechenEbenenImStil`); die oberste andere, nie eine für Klicks gesperrte | `sprachen-fill`; die kleinste Teilfläche einer ANDEREN Sprache |
 * | `vereinigtMitAnderen` | nein: „Alle Unterflächen vereinigen“ verschmilzt die Stücke der Teilfläche | ja: auch die Teilflächen derselben Sprache, die mit ihr zusammenhängen |
 */
export interface FlaechenSofort {
    /** Der Besitzer der Geometrie (`belegeGeometrie`): Sein angedocktes Fenster zieht die Liste ein, solange der Modus läuft. */
    readonly werkzeug: string;
    /** Die Teilfläche; `undefined`: Es gibt sie nicht (still). */
    lies(id: string, flaecheId: string): Promise<SofortAntwort<SofortTeilflaeche | undefined>>;
    /** „Unterflächen ›“: schreibt; die Quittung nennt die Zahl der Teile vorher und nachher. */
    teile(
        id: string,
        flaecheId: string,
        body: Omit<LandscapePartsBody, "areaId">,
    ): Promise<SofortAntwort<OperationReceipt & { readonly partsBefore?: number; readonly partsAfter?: number }>>;
    /** „Zerschneiden“: schreibt. */
    schneide(
        id: string,
        flaecheId: string,
        body: Omit<LandscapeSplitBody, "areaId">,
    ): Promise<SofortAntwort<OperationReceipt>>;
    /** „Mit anderer Fläche“ rechnen; ohne Verbindung oder abgebrochen wirft es (das nächste Zeigen fragt wieder). */
    vorschau(
        id: string,
        flaecheId: string,
        body: Omit<LandscapeBooleanPreviewBody, "areaId">,
        signal: AbortSignal,
    ): Promise<SofortAntwort<LandscapeBooleanPreview>>;
    /** „Mit anderer Fläche“: schreibt. */
    verknuepfe(
        id: string,
        flaecheId: string,
        body: Omit<LandscapeBooleanBody, "areaId">,
    ): Promise<SofortAntwort<OperationReceipt>>;
    /** Die Füllebenen, deren Flächen Ziele von „Mit anderer Fläche“ sein können. */
    zielEbenen(): readonly string[];
    /** Das Ziel unter dem Zeiger aus den Features dort (in der Folge des Koordinators); sonst keins. */
    ziel(features: readonly ZielFeature[], flaecheId: string): string | undefined;
    /** Geschrieben: Kacheln, Fenster und Liste der Art nach. */
    geschrieben(quittung: OperationReceipt, werkzeug: SofortWerkzeug): void;
    /** Nimmt „Alle Unterflächen vereinigen“ auch andere Teilflächen mit? Dann fragt der Modus nicht vorab, ob es zwei Stücke gibt. */
    readonly vereinigtMitAnderen: boolean;
    /** Die Sätze nach dem Herauslösen und Zerschneiden („eine eigene Landschaft“, „eine eigene Teilfläche“). */
    readonly saetze: { readonly herausgeloest: MessageKey; readonly geschnitten: MessageKey };
}

/** Wartet, bis die Bearbeitung ihren Stand gelesen hat; `false`, wenn es ihn nicht gibt oder das Lesen scheiterte. */
export function bereitVon(bearbeitung: Pick<FormBearbeitung, "zustand">): Promise<boolean> {
    const fertig = (art: string): boolean | undefined =>
        art === "laedt" ? undefined : art !== "fehlt" && art !== "lesefehler";
    const sofort = fertig(bearbeitung.zustand.value.art);
    if (sofort !== undefined) return Promise.resolve(sofort);
    return new Promise((resolve) => {
        const stop = watch(
            () => bearbeitung.zustand.value.art,
            (art) => {
                const ja = fertig(art);
                if (ja === undefined) return;
                stop();
                resolve(ja);
            },
        );
    });
}

/** Der Stand zum Start: die eigenen Teilflächen und die Nachbarn als Teile. */
export function startStand(gelesen: FlaechenGelesen): FormStand {
    return {
        teile: teileAus(gelesen.flaechen, gelesen.name),
        nachbarn: gelesen.nachbarn.flatMap((nachbar) => teileAus([nachbar], nachbar.name)),
    };
}
