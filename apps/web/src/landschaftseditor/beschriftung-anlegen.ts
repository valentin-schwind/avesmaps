import {
    beschriftungsPunkt,
    editorLandscapeLabelRetireUrl,
    editorLandscapeLabelsUrl,
    freierPunkt,
    type EditorLandscapeArea,
    type EditorLandscapeDetail,
    type EditorLandscapeList,
    type LandscapeLabelCreateBody,
    type LandscapeLabelCreateReceipt,
    type LandscapeLabelRetireBody,
} from "@avesmaps3d/shared";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";
import type { MessageKey } from "../i18n/i18n";
import { mapUnitsPerPixel } from "../map/traveler-view";
import { createLandschaftArt } from "./landschaft-art";

/**
 * Beschriftungen einer Landschaft anlegen, duplizieren und löschen (WI-0232, Werkzeug 2; Teilung der Derographie 2026-10-19): Daten und
 * Ablauf. Je EINE Sofort-Operation wie „Gipfel setzen“ (`label.create`, `label.retire`; Server `apps/server/src/editor/landscape-labels.ts`).
 * Danach zeichnet die Karte mit der Revision der Quittung neu, und das Fenster liest die Landschaft neu. Ein zweiter Auftrag, solange
 * einer läuft, tut nichts.
 *
 * - **Gesperrt** (Grund im Knopf, hier nicht geprüft): solange an der Landschaft eine Bearbeitung läuft („Erst „Fertig“ oder
 *   „Verwerfen“.“), an einer Landschaft „entlang der Fläche“ (F7) und ohne Schreibrecht.
 * - **Die letzte Beschriftung** nimmt die Landschaft mit (Betreiber 2026-07-28 in Legacy, Editor-Orchestrierung 2026-10-19 „B“): über
 *   „Fläche entfernen …“ (`landscape.retire`, D2), nicht hier. Der Server weist sie hier mit 409 `last_label` ab; `loesche` meldet das als
 *   `"letzte"`, das Fenster fragt dann mit dem Satz der Rückfrage und entfernt über D2.
 * - **Position zurücksetzen** ist keine Operation, sondern ein Schritt im Entwurf (`labels[id].x/y`, „Fertig“ schreibt): Punkt aus
 *   `packages/shared/src/beschriftung-punkt.ts`.
 */
export interface BeschriftungDaten {
    lege(regionId: string, body: LandscapeLabelCreateBody): Promise<SchreibAntwort<LandscapeLabelCreateReceipt>>;
    nimmWeg(regionId: string, labelId: string, body: LandscapeLabelRetireBody): Promise<SchreibAntwort>;
}

export function createBeschriftungDaten(
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
): BeschriftungDaten {
    return {
        lege: (regionId, body) =>
            sende<LandscapeLabelCreateReceipt>(editorLandscapeLabelsUrl(regionId), body, "POST", fetcher),
        nimmWeg: (regionId, labelId, body) =>
            sende(editorLandscapeLabelRetireUrl(regionId, labelId), body, "POST", fetcher),
    };
}

export interface BeschriftungAnlegenOptionen {
    readonly daten: BeschriftungDaten;
    /** Nach dem Speichern: Karte mit der Revision der Quittung neu. */
    readonly geaendert: (revision: number | undefined) => void;
    /** Nach dem Speichern: das Fenster liest die Landschaft neu (neue Revision, neue Beschriftung). */
    readonly neuLesen: (regionId: string) => void;
    readonly melde: (text: string, ton: "success" | "warning") => void;
    readonly neueKennung?: () => string;
}

/** Was `loesche` erreicht hat: gelöscht, die letzte (dann über D2) oder ein Fehler (gemeldet). */
export type LoeschAusgang = "geloescht" | "letzte" | "fehler";

export interface BeschriftungAnlegen {
    /** „Neue Beschriftung“: an der Stelle des Menüs, ohne Punkt irgendwo in der Fläche (der Server wählt). */
    neu(regionId: string, baseRevision: number, punkt?: readonly [number, number]): Promise<boolean>;
    /** „Duplizieren“: mit den Werten von `vorlage`, am Punkt neben dem Original. */
    dupliziere(
        regionId: string,
        baseRevision: number,
        vorlage: string,
        punkt: readonly [number, number],
    ): Promise<boolean>;
    /** „Löschen …“ nach der Rückfrage: still legen. */
    loesche(regionId: string, baseRevision: number, label: { id: string; revision: number }): Promise<LoeschAusgang>;
    /** Läuft gerade ein Auftrag? */
    readonly laeuft: () => boolean;
}

export function createBeschriftungAnlegen(optionen: BeschriftungAnlegenOptionen): BeschriftungAnlegen {
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    let laeuft = false;
    /** EIN Auftrag zur Zeit; nach Erfolg Karte und Fenster neu, nach einem Fehler der Satz des Servers. */
    const einmal = async <Q extends { mapRevision?: number | undefined }>(
        regionId: string,
        auftrag: () => Promise<SchreibAntwort<Q>>,
    ): Promise<SchreibAntwort<Q> | undefined> => {
        if (laeuft) return undefined;
        laeuft = true;
        try {
            const antwort = await auftrag();
            if (antwort.ok) {
                optionen.geaendert(antwort.quittung.mapRevision);
                optionen.neuLesen(regionId);
            }
            return antwort;
        } finally {
            laeuft = false;
        }
    };
    const angelegt = async (
        regionId: string,
        body: Omit<LandscapeLabelCreateBody, "operationId">,
    ): Promise<boolean> => {
        const antwort = await einmal(regionId, () =>
            optionen.daten.lege(regionId, { operationId: neueKennung(), ...body }),
        );
        if (antwort === undefined) return false;
        if (!antwort.ok) optionen.melde(antwort.fehler.message, "warning");
        return antwort.ok;
    };
    return {
        neu: (regionId, baseRevision, punkt) =>
            angelegt(regionId, { baseRevision, ...(punkt === undefined ? {} : { position: [punkt[0], punkt[1]] }) }),
        dupliziere: (regionId, baseRevision, vorlage, punkt) =>
            angelegt(regionId, { baseRevision, from: vorlage, position: [punkt[0], punkt[1]] }),
        async loesche(regionId, baseRevision, label) {
            const antwort = await einmal(regionId, () =>
                optionen.daten.nimmWeg(regionId, label.id, {
                    operationId: neueKennung(),
                    baseRevision,
                    labelRevision: label.revision,
                }),
            );
            if (antwort === undefined) return "fehler";
            if (antwort.ok) return "geloescht";
            if (antwort.fehler.code === "last_label") return "letzte";
            optionen.melde(antwort.fehler.message, "warning");
            return "fehler";
        },
        laeuft: () => laeuft,
    };
}

/** Legacys Ausweichschritt beim Zurücksetzen (`LABEL_ZURUECK_VERSATZ_PX`, Owner 25.08.2026): 20 Bildschirmpixel. */
export const ZURUECKSETZEN_VERSATZ_PX = 20;

const innen = (ring: readonly (readonly [number, number])[], x: number, y: number): boolean => {
    let drin = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, ay] = ring[i]!;
        const [bx, by] = ring[j]!;
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) drin = !drin;
    }
    return drin;
};
const liegtIn = (polygone: EditorLandscapeArea["polygons"], x: number, y: number): boolean =>
    polygone.some(([aussen, ...loecher]) => innen(aussen!, x, y) && !loecher.some((loch) => innen(loch, x, y)));

/**
 * „Position zurücksetzen“ (Legacys `avesmapsLabelPositionZuruecksetzen`, Mirror a7f2dac8 `map-features-labels.js#L2077-L2149`): der Point
 * of Inaccessibility der Teilfläche, in der die Beschriftung liegt, sonst der nächsten; liegt dort schon eine andere Beschriftung derselben
 * Landschaft, je `schritt` Karteneinheiten nach rechts unten ausgewichen (Legacy 20 px; der Aufrufer rechnet sie mit dem Zoom um).
 * `undefined` ohne Fläche.
 */
export function zuruecksetzPunkt(
    flaechen: readonly Pick<EditorLandscapeArea, "polygons">[],
    label: { readonly x: number; readonly y: number },
    andere: readonly (readonly [number, number])[],
    schritt: number,
): [number, number] | undefined {
    const kandidaten = flaechen
        .map((flaeche) => ({ flaeche, punkt: beschriftungsPunkt(flaeche.polygons) }))
        .filter(
            (k): k is { flaeche: (typeof flaechen)[number]; punkt: NonNullable<typeof k.punkt> } => k.punkt !== null,
        );
    if (kandidaten.length === 0) return undefined;
    const darunter = kandidaten.find((k) => liegtIn(k.flaeche.polygons, label.x, label.y));
    const naechste = (): (typeof kandidaten)[number] =>
        kandidaten.reduce((beste, k) =>
            Math.hypot(k.punkt.x - label.x, k.punkt.y - label.y) <
            Math.hypot(beste.punkt.x - label.x, beste.punkt.y - label.y)
                ? k
                : beste,
        );
    const ziel = (darunter ?? naechste()).punkt;
    return freierPunkt([ziel.x, ziel.y], andere, schritt, [1, -1]);
}

/** Legacys Versatz einer Kopie (`duplicateLabelEntry`): ihre eigene Höhe plus 8 px nach unten, ohne Messung 48 px. */
export const DUPLIZIEREN_VERSATZ_PX = 48;

export interface BeschriftungenOptionen {
    /** Die Fenster des Landschaftseditors: Stand und Neulesen der offenen Landschaft, das Fenster am Reiter „Beschriftungen“. */
    readonly steuerung: {
        bearbeitungVon(
            id: string | undefined,
        ):
            | { readonly detail: { readonly value: EditorLandscapeDetail | undefined }; neuLesen(): Promise<void> }
            | undefined;
        oeffneFuer(id: string, reiter?: "beschriftungen"): unknown;
    };
    /** Nach dem Speichern: Karte mit der Revision der Quittung neu. */
    readonly geaendert: (revision: number | undefined) => void;
    readonly melde: (text: string, ton: "success" | "warning") => void;
    /** Der Zoom der Karte: Legacys Versätze sind Bildschirmpixel, gerechnet wird in Karteneinheiten. */
    readonly zoom: () => number;
    /** Der frische Stand einer Landschaft ohne offenes Fenster (Revision für „Neue Beschriftung hier“); ohne Angabe gelesen wie „Verbergen“. */
    readonly lade?: (id: string) => Promise<EditorLandscapeDetail | null>;
    readonly daten?: BeschriftungDaten;
    readonly neueKennung?: () => string;
}

/** Was Fenster und Kartenmenü an Beschriftungen tun (WI-0232). */
export interface Beschriftungen {
    /** „Neue Beschriftung hier“ im Kartenmenü: an der Stelle des Rechtsklicks, danach das Fenster am Reiter „Beschriftungen“. */
    neuHier(regionId: string, punkt: { readonly x: number; readonly y: number } | undefined): Promise<boolean>;
    /** „+ Neue Beschriftung“ im Fenster: ein Punkt in der Fläche (der Server wählt). */
    neu(regionId: string): Promise<boolean>;
    /** „Duplizieren“: Kopie unter dem Original, mit seinen Werten. */
    dupliziere(regionId: string, labelId: string): Promise<boolean>;
    /** „Löschen …“ nach der Rückfrage; `"letzte"`: das Fenster fragt dann nach „Fläche entfernen …“. */
    loesche(regionId: string, labelId: string): Promise<LoeschAusgang>;
    /** „Position zurücksetzen“: der Punkt für den Entwurf; `undefined` ohne Fläche. */
    zuruecksetzen(
        detail: EditorLandscapeDetail,
        lage: { readonly x: number; readonly y: number },
        andere: readonly (readonly [number, number])[],
    ): [number, number] | undefined;
    readonly laeuft: () => boolean;
}

export function createBeschriftungen(optionen: BeschriftungenOptionen): Beschriftungen {
    const ablauf = createBeschriftungAnlegen({
        daten: optionen.daten ?? createBeschriftungDaten(),
        geaendert: optionen.geaendert,
        neuLesen: (id) => void optionen.steuerung.bearbeitungVon(id)?.neuLesen(),
        melde: optionen.melde,
        ...(optionen.neueKennung === undefined ? {} : { neueKennung: optionen.neueKennung }),
    });
    const offen = (id: string): EditorLandscapeDetail | undefined =>
        optionen.steuerung.bearbeitungVon(id)?.detail.value;
    const einheitenProPixel = (punkt: { readonly x: number; readonly y: number }): number =>
        mapUnitsPerPixel(punkt, optionen.zoom());
    const lade =
        optionen.lade ??
        ((id: string) =>
            createLandschaftArt()
                .lade(id, new AbortController().signal)
                .catch(() => null));
    return {
        async neuHier(regionId, punkt) {
            const detail = offen(regionId) ?? (await lade(regionId));
            if (!detail) return false;
            const ok = await ablauf.neu(
                regionId,
                detail.revision,
                punkt === undefined ? undefined : [punkt.x, punkt.y],
            );
            if (ok) optionen.steuerung.oeffneFuer(regionId, "beschriftungen");
            return ok;
        },
        async neu(regionId) {
            const detail = offen(regionId);
            return detail === undefined ? false : ablauf.neu(regionId, detail.revision);
        },
        async dupliziere(regionId, labelId) {
            const detail = offen(regionId);
            const original = detail?.labels.find((label) => label.id === labelId);
            if (detail === undefined || original === undefined) return false;
            // Unter dem Original, damit die Kopie nicht im Kasten des Originals verschwindet (Legacy, Owner 2026-07-28).
            const hoehe = original.size === undefined ? DUPLIZIEREN_VERSATZ_PX : Math.ceil(original.size * 1.25) + 8;
            const versatz = hoehe * einheitenProPixel(original);
            return ablauf.dupliziere(regionId, detail.revision, labelId, [original.x, original.y - versatz]);
        },
        async loesche(regionId, labelId) {
            const detail = offen(regionId);
            const label = detail?.labels.find((l) => l.id === labelId);
            if (detail === undefined || label === undefined) return "fehler";
            return ablauf.loesche(regionId, detail.revision, { id: label.id, revision: label.revision });
        },
        zuruecksetzen: (detail, lage, andere) =>
            zuruecksetzPunkt(detail.areas, lage, andere, ZURUECKSETZEN_VERSATZ_PX * einheitenProPixel(lage)),
        laeuft: ablauf.laeuft,
    };
}

/** Der Grund im Kartenmenü für „Neue Beschriftung hier“ (F7): an einer Landschaft „entlang der Fläche“ gibt es keine Punkte. */
export function beschriftungGrund(liste: EditorLandscapeList | undefined, regionId: string): MessageKey | undefined {
    return liste?.rows.find((row) => row.id === regionId)?.curve === true
        ? "landschaftseditor.beschriftung.grund.entlang"
        : undefined;
}
