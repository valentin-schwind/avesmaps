import type {
    EditorGebirge,
    GebirgsPreset,
    GebirgsPresetGruppe,
    GebirgsStand,
    Gebirgstyp,
    ModellAbweichung,
    V12Bounds,
} from "@avesmaps3d/shared";

/**
 * Auftrag und Ergebnis der Gebirge-Vorschau (WI-0226), ohne die Rechnung: Diese Datei darf ins Hauptbündel, `rechnen.ts` (mit der V12)
 * nur in den Worker.
 */

/** Zellen je längerer Kante: grob beim Ziehen, feiner beim Loslassen (gemessen 0,2–0,9 s und bis rund 2 s, Notizordner `topographie/`). */
export const VORSCHAU_KANTE_GROB = 96;
export const VORSCHAU_KANTE_FEIN = 640;

export interface VorschauAuftrag {
    eingabe: EditorGebirge["eingabe"];
    /** Das Preset des Typs, `null` ohne Typ. */
    preset: GebirgsPreset | null;
    stand: Pick<GebirgsStand, "werte" | "muster" | "kammhoehe">;
    grundhoehe: number | null;
    /** Zellen je längerer Kante. */
    kante: number;
    /** Faktor für Kante und kleinste Zellweite der feinen Vorschau. */
    aufloesung?: 1 | 2 | 4;
    /**
     * Das Rückennetz (WI-0245 D4, Bauvorlage Gebirge-Entwurf V16/V17): Hat das Gebirge gezeichnete Kämme, rechnet die Vorschau sie mit dem
     * Modell der Topographie statt der V12. `talbodenFest`: ein eigener Talboden oder der gemerkte einer früheren feinen Rechnung;
     * `ableiten`: den Talboden aus dem Band des Typs suchen (langsam, nur fein); ohne beides gilt der Talboden des Typs.
     */
    rueckennetz?: {
        kaemme: EditorGebirge["stand"]["netz"]["kaemme"];
        nebengipfel: EditorGebirge["stand"]["netz"]["nebengipfel"];
        mulden?: EditorGebirge["stand"]["netz"]["mulden"];
        /** Eigene Höhen an Flüssen und Seen (WI-0249, `rueckennetz/wasser.ts`); die Vorschau zeigt sie wie das Gelände der Fassung 19. */
        flussHoehen?: EditorGebirge["stand"]["netz"]["flussHoehen"];
        seeHoehen?: EditorGebirge["stand"]["netz"]["seeHoehen"];
        typ: Gebirgstyp | null;
        gruppe: GebirgsPresetGruppe;
        modell: ModellAbweichung;
        talbodenFest?: number | undefined;
        ableiten: boolean;
    };
    /**
     * Nur dieser Rahmen (E), nur mit Rückennetz (`ausschnitt` des Moduls, WI-0246): die feine Rechnung großer Gebirge im sichtbaren
     * Ausschnitt. `kante` zählt dann die Zellen über dem Rahmen, nicht über dem ganzen Gebirge.
     */
    ausschnitt?: V12Bounds | undefined;
}

export interface VorschauErgebnis {
    w: number;
    hh: number;
    /** Zellweite in Karteneinheiten; Zeile `j` liegt bei `bounds.min_y + j · cell` (Zeile 0 ist der Süden). */
    cell: number;
    bounds: V12Bounds;
    /** 1 in der Fläche. */
    eigen: Uint8Array;
    /** Höhe in Schritt je Zelle, maßstäblich. */
    h: Float32Array;
    ms: number;
    /** Nur im Rückennetz: der wirksame Talboden (Anteil der Kammhöhe), abgeleitet, gemerkt oder eigener. */
    talboden?: number;
}
