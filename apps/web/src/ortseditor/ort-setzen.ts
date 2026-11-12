import { shallowRef, type ShallowRef } from "vue";
import {
    PLACE_SUBTYPES,
    type EditorPlaceDetail,
    type EditorPlaceRow,
    type OperationReceipt,
    type PlaceCreateBody,
    type PlaceMoveBody,
    type PlaceSubtype,
} from "@avesmaps3d/shared";
import type { ApiFehler } from "./ort-bearbeitung";
import type { VerschiebeSperre } from "./ort-verschieben";

/**
 * Einen Ort auf die Karte setzen, der noch nicht dort steht (WI-0128 E16; Betreiber 2026-10-11): aus der Liste auf die Karte ziehen oder
 * „● Auf der Karte setzen“ und dann auf die Karte klicken. Zwei Arten von Einträgen unter „Nicht auf der Karte“:
 *
 * - **ein Ort ohne Lage** (vom Editor angelegt): \`place.move\` setzt ihn, dieselbe Kennung, die Revision aus seinem Detail;
 * - **ein Wiki-Eintrag** (Legacys Verzeichnis, Schlüssel \`wiki:…\`): \`place.create\` mit Lage und \`wikiKey\`; der neue Ort trägt den
 *   Artikel, Name, Ortsgröße und Art aus dem Eintrag. Ein Eintrag ohne bekannte Ortsgröße lässt sich nicht setzen.
 *
 * 🔴 **Sperre** (EDIT-0003 §4, WI-0215): Ein Ort ohne Lage ist schon ein Objekt und wird gesperrt wie beim Verschieben, bevor der Modus
 * auf den Klick wartet und bevor gesendet wird; hält ihn ein anderer, beginnt nichts, und die Meldung nennt ihn. Ein Wiki-Eintrag wird
 * erst beim Setzen ein Ort; da gibt es nichts zu sperren.
 *
 * Stätten (\`staette:…\`) setzt das nicht, sie kommen mit E18. Was schon auf der Karte steht, ist nie setzbar (Betreiber: „natürlich darf
 * man nur orte auf die karte ziehen, die noch nicht auf der karte sind“).
 */

export interface SetzenApi {
    ort(publicId: string, signal: AbortSignal): Promise<EditorPlaceDetail | null>;
    verschiebe(publicId: string, body: PlaceMoveBody): Promise<Antwort>;
    lege(body: PlaceCreateBody): Promise<Antwort>;
}

type Antwort = { ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler };

const GROESSEN: ReadonlySet<string> = new Set(PLACE_SUBTYPES);

/** Steht der Eintrag noch nicht auf der Karte und lässt er sich setzen? */
export function setzbar(row: EditorPlaceRow | undefined): boolean {
    if (row === undefined) return false;
    if (row.origin === "ohne-lage") return true;
    return row.origin === "wiki" && row.key.startsWith("wiki:") && GROESSEN.has(row.subtype ?? "");
}

/** Der Auftrag für einen Wiki-Eintrag: Name, Ortsgröße und Art aus der Zeile, die Lage aus dem Klick. */
export function anlegenAus(row: EditorPlaceRow, punkt: { x: number; y: number }, operationId: string): PlaceCreateBody {
    const art = row.kind?.trim();
    return {
        operationId,
        name: row.name,
        subtype: row.subtype as PlaceSubtype,
        ...(art && art.length <= 80 ? { kind: art } : {}),
        position: { x: punkt.x, y: punkt.y },
        wikiKey: row.key,
    };
}

export interface SetzKarte {
    /** Schaltet den Klickmodus ein; ohne Karte \`undefined\`. */
    ein(gesetzt: (punkt: { x: number; y: number }) => void): { aus(): void } | undefined;
    /** Nach dem Setzen: Ort und Liste neu (Kachelrevision aus der Quittung, E13). */
    geaendert(revision: number | undefined): void;
}

/** Ein Ort wartet auf den Klick (Modus) oder wird gerade gesendet. */
export interface Setzen {
    readonly fenster: string | undefined;
    readonly key: string;
    readonly art: "wartet" | "sendet";
}

export type SetzMeldung =
    | { readonly art: "gesetzt"; readonly key: string; readonly publicId: string; readonly name: string }
    | { readonly art: "abgelehnt"; readonly key: string; readonly satz: string };

export interface OrtSetzen {
    readonly laufend: Readonly<ShallowRef<Setzen | undefined>>;
    readonly meldung: Readonly<ShallowRef<SetzMeldung | undefined>>;
    /** „● Auf der Karte setzen“: Der nächste Klick auf die Karte setzt den Eintrag. */
    starte(fenster: string, row: EditorPlaceRow): void;
    /** Setzt den Eintrag an diesen Punkt (Ablegen aus der Liste oder der Klick im Modus). */
    setze(row: EditorPlaceRow, punkt: { x: number; y: number }, fenster?: string): Promise<void>;
    /** Esc: beendet einen wartenden Modus. Gibt zurück, ob einer lief. */
    abbrechen(): boolean;
    destroy(): void;
}

export interface OrtSetzenOptionen {
    readonly api: SetzenApi;
    readonly karte: SetzKarte;
    /** Nach dem Setzen: den Ort öffnen und wählen (im Fenster, aus dem er kam). */
    readonly gesetzt: (fenster: string | undefined, publicId: string) => void;
    readonly ladefehler: string;
    readonly neueKennung?: () => string;
    /** Die Sperre der Orte und ihre Sätze, wie beim Verschieben; ohne sie setzt der Modus ungesperrt (Prüfungen ohne Server). */
    readonly sperre?: VerschiebeSperre | undefined;
}

export function createOrtSetzen(optionen: OrtSetzenOptionen): OrtSetzen {
    const { api, karte } = optionen;
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const laufend = shallowRef<Setzen | undefined>(undefined);
    const meldung = shallowRef<SetzMeldung | undefined>(undefined);
    let modus: { aus(): void } | undefined;
    /** Der Ort ohne Lage, dessen Sperre dieser Modus hält; `lauf` zählt die Starts, damit eine späte Antwort nichts mehr einschaltet. */
    let gesperrt: string | undefined;
    let lauf = 0;
    const halter = {};
    /** Die Anmeldung zur Freigabe auf Bitte (WI-0262), solange der Modus die Sperre hält: Er wartet nur auf einen Klick, es gibt nichts zu speichern. */
    let angebot: (() => void) | undefined;
    const bieteAn = (id: string): void => {
        if (angebot !== undefined || optionen.sperre?.ort.biete === undefined) return;
        angebot = optionen.sperre.ort.biete(id, {
            speichere() {
                // Ein Schreiben läuft: Der Modus endet nicht. Sonst endet der wartende Modus einfach.
                if (laufend.value?.art === "sendet") return Promise.resolve({ ok: false, grund: undefined });
                lauf += 1;
                modusAus();
                laufend.value = undefined;
                gibFrei();
                return Promise.resolve({ ok: true });
            },
        });
    };

    function modusAus(): void {
        modus?.aus();
        modus = undefined;
    }

    function gibFrei(): void {
        angebot?.();
        angebot = undefined;
        if (gesperrt !== undefined) optionen.sperre?.ort.gib(gesperrt, halter);
        gesperrt = undefined;
    }

    /** Braucht dieser Eintrag die Sperre? Nur ein Ort ohne Lage ist schon ein Objekt; ein Wiki-Eintrag wird erst beim Setzen einer. */
    const brauchtSperre = (row: EditorPlaceRow): boolean => optionen.sperre !== undefined && row.origin === "ohne-lage";

    /** Nimmt die Sperre des Orts; `undefined`, wenn er frei ist (oder keine braucht), sonst der Satz, der sagt warum nicht. */
    async function sichere(row: EditorPlaceRow): Promise<string | undefined> {
        const sperre = optionen.sperre;
        if (sperre === undefined || !brauchtSperre(row) || gesperrt === row.key) return undefined;
        gibFrei();
        const ergebnis = await sperre.ort.nimm(row.key, "form", halter);
        if (ergebnis.art !== "genommen")
            return ergebnis.art === "gesperrt" ? sperre.gesperrt(ergebnis.sperre) : sperre.fehler;
        gesperrt = row.key;
        bieteAn(row.key);
        return undefined;
    }

    const abmelden = optionen.sperre?.ort.beiVerlust((id) => {
        if (id !== gesperrt) return;
        gesperrt = undefined;
        angebot?.();
        angebot = undefined;
        // Wartet der Modus noch auf den Klick, endet er; gesendet ist gesendet.
        const jetzt = laufend.value;
        if (jetzt?.art !== "wartet" || jetzt.key !== id) return;
        lauf += 1;
        modusAus();
        laufend.value = undefined;
        meldung.value = { art: "abgelehnt", key: id, satz: optionen.sperre!.verloren };
    });

    /** Schaltet den Klickmodus ein (nach der Sperre, wenn eine nötig war). */
    function schalteEin(fenster: string, row: EditorPlaceRow): void {
        const ein = karte.ein((punkt) => void setze(row, punkt, fenster));
        if (ein === undefined) {
            gibFrei();
            return;
        }
        modus = ein;
        laufend.value = { fenster, key: row.key, art: "wartet" };
    }

    async function sende(row: EditorPlaceRow, punkt: { x: number; y: number }): Promise<Antwort> {
        if (row.origin === "wiki") return api.lege(anlegenAus(row, punkt, neueKennung()));
        const ort = await api.ort(row.key, new AbortController().signal).catch(() => null);
        if (ort === null) return { ok: false, status: 0, fehler: { code: "not_found", message: optionen.ladefehler } };
        return api.verschiebe(row.key, {
            operationId: neueKennung(),
            baseRevision: ort.revision,
            to: { x: punkt.x, y: punkt.y },
            pathEnds: [],
        });
    }

    async function setze(row: EditorPlaceRow, punkt: { x: number; y: number }, fenster?: string): Promise<void> {
        if (!setzbar(row) || laufend.value?.art === "sendet") return;
        modusAus();
        meldung.value = undefined;
        const von = fenster ?? (laufend.value?.key === row.key ? laufend.value.fenster : undefined);
        lauf += 1;
        laufend.value = { fenster: von, key: row.key, art: "sendet" };
        // Aus der Liste gezogen, ohne Modus: hier gesperrt; im Modus hält er die Sperre schon (EDIT-0003 §4).
        const satz = await sichere(row);
        if (satz !== undefined) {
            laufend.value = undefined;
            meldung.value = { art: "abgelehnt", key: row.key, satz };
            return;
        }
        const antwort = await sende(row, punkt);
        laufend.value = undefined;
        gibFrei();
        if (!antwort.ok) {
            meldung.value = { art: "abgelehnt", key: row.key, satz: antwort.fehler.message };
            return;
        }
        const publicId = antwort.quittung.affected.find((x) => x.kind === "place")?.id ?? row.key;
        meldung.value = { art: "gesetzt", key: row.key, publicId, name: row.name };
        karte.geaendert(antwort.quittung.mapRevision);
        optionen.gesetzt(von, publicId);
    }

    return {
        laufend,
        meldung,
        starte(fenster, row) {
            if (!setzbar(row) || laufend.value?.art === "sendet") return;
            modusAus();
            meldung.value = undefined;
            const diese = ++lauf;
            if (!brauchtSperre(row)) {
                gibFrei();
                laufend.value = undefined;
                schalteEin(fenster, row);
                return;
            }
            // Erst gesperrt, dann wartet der Modus auf den Klick (wie „Ort verschieben“): Hält ein anderer den Ort, beginnt er nicht.
            laufend.value = undefined;
            void sichere(row).then((satz) => {
                if (diese !== lauf) {
                    if (gesperrt === row.key && laufend.value?.key !== row.key) gibFrei();
                    return;
                }
                if (satz !== undefined) {
                    meldung.value = { art: "abgelehnt", key: row.key, satz };
                    return;
                }
                schalteEin(fenster, row);
            });
        },
        setze,
        abbrechen() {
            if (laufend.value?.art !== "wartet") return false;
            lauf += 1;
            modusAus();
            laufend.value = undefined;
            gibFrei();
            return true;
        },
        destroy() {
            lauf += 1;
            modusAus();
            laufend.value = undefined;
            gibFrei();
            abmelden?.();
        },
    };
}
