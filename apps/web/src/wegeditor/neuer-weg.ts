import { shallowRef, type ShallowRef } from "vue";
import {
    EDITOR_LANDSCAPE_LAYERS,
    PATH_TARGETS_MAX_SIDE,
    type EditorLandscapeLayer,
    type EditorPathEnds,
    type EditorPathTargets,
    type PathCreateArt,
} from "@avesmaps3d/shared";
import type {
    AnlegenEingabe,
    AnlegenGrund,
    AnlegenModus,
    AnlegenPunkt,
    AnlegenStand,
    AnlegenZeiger,
} from "../map/geometrie/anlegen";
import { FLUSS_ANLEGEN, WEG_ANLEGEN } from "../map/geometrie/arten";
import { geometrieBelegt, meldeBelegt } from "../map/geometrie/besitzer";
import type { Pixel, Punkt, Ziel } from "../map/geometrie/geometrie";
import { kantenZiele } from "../map/geometrie/formentwurf";
import { einrasten } from "../map/geometrie/rechnung";
import type { Kasten, WegeditorDaten } from "./wegeditor-daten";

/**
 * Die Steuerung von „Neuer Weg“ (WI-0177; EDIT-0003 T40 (3), T24, R12; Probierentwurf P5): der Modus „Anlegen“ des Geometrie-Moduls
 * mit der Art `WEG_ANLEGEN`; hier steht, was er liest und wann geschrieben wird.
 *
 * - **Start** an einem Ort („Neuer Weg ab hier“: der Ort ist der feste Anfang, gelesen mit Lage und Namen) oder an einer Stelle der
 *   Karte („Hier hinzufügen › Neuer Weg“: die Stelle ist der Anfang, eingerastet an einem Ort oder Stützpunkt im Fangradius, wie P5).
 *   Vorher liest er die Ziele um den sichtbaren Ausschnitt, höchstens `PATH_TARGETS_MAX_SIDE` um den letzten Punkt; danach liest er
 *   sie neu, wann immer die Karte zur Ruhe kommt (`ladeZiele`), nie während einer Geste.
 * - **Ein Modus zur Zeit** (`map/geometrie/besitzer.ts`): Läuft schon einer, beginnt das Zeichnen nicht; der laufende bleibt, ein
 *   Hinweis sagt es.
 * - **Fluss und Bach** (Plan Fluss/Bach; Betreiber 2026-10-20: „sind im standard unsichtbar, wär cool, wenn die ansicht auf die
 *   topographie wechselt“): Der Start stellt auf Landschaft, Ebene Topographie (`zuTopographie`, derselbe Weg wie „Neue Fläche“ und
 *   „Neue Kraftlinie“) und sperrt den Wechsel; nach dem Speichern bleibt die Ansicht, nach einem Abbruch kommt die vorige zurück. Jeder
 *   Klick rastet dazu an Ecken und Kanten der Flächen der sichtbaren Ebenen (auch Seeufern) und an Strecken anderer Flüsse ein
 *   (`FLUSS_ANLEGEN`, `flussZiele`; Vali 2026-11-08).
 * - **Kein Sperren:** Ein neuer Weg ändert kein anderes Objekt. Ein Ende an einem Ort oder am Stützpunkt eines Wegs ist ein Knoten
 *   der Wegfindung, kein Kreuzungsobjekt (Entscheid 2026-10-10).
 * - **„Fertig“** (Klick am Ort, Doppelklick, Enter, Knopf) schreibt EINE Operation `path.create`. Danach endet der Modus, die Meldung
 *   nennt den Weg und woran seine Enden hängen (aus der Quittung, Entscheid 2026-10-10), und das Wege-Fenster öffnet ihn (wie Legacy
 *   seinen Dialog „Weg bearbeiten“ und P5 den Reiter „Eigenschaften“). Ein Zurücknehmen-Feld gibt es nicht (T24).
 * - **Ablehnung:** Der Entwurf bleibt, die Meldung trägt den Satz des Servers; man ändert ihn oder verwirft. Ein Fehler des Servers
 *   (5xx) oder keine Antwort sagt das mit Status statt „interner Fehler“ (Fund von Thomas auf der Stage, 2026-10-17).
 * - 🔴 **Esc verlässt den Modus immer** (Editor-Orchestrierung 2026-10-17): Sobald ein Abschnitt steht, fragt das erste Esc (R2), das
 *   zweite verwirft und beendet; ohne Abschnitt endet er gleich. Auch während des Schreibens beendet Esc den Modus: Kommt die Quittung
 *   später, folgen die Kacheln trotzdem. Vorher schaltete Esc die Frage nur an und aus, und nach einem Fehler des Servers kam man nicht
 *   mehr heraus. „Verwerfen“ in der Leiste stellt den Beginn her, der Modus bleibt.
 */

/**
 * Woran das Anlegen beginnt: ein Ort (seine Kennung) oder eine Stelle der Karte; dazu, was entsteht (`art`, Plan Fluss/Bach 2026-10-19):
 * ohne Angabe ein Weg, sonst ein Fluss oder ein Bach. Gezeichnet wird gleich; die Zeichenrichtung ist die Fließrichtung.
 */
export type NeuerWegAnfang = ({ readonly ort: string } | { readonly punkt: Punkt }) & { readonly art?: PathCreateArt };

export interface NeuerWegLauf {
    readonly phase: "laedt" | "bereit" | "speichert";
    /** Was entsteht: ein Weg, ein Fluss oder ein Bach; die Leiste nennt es („Neuer Fluss“, „Ein Bach braucht …“). */
    readonly art: PathCreateArt;
    /** Wo er beginnt: am Ort (Name), am Stützpunkt eines Wegs, frei; `undefined`, solange kein Punkt steht. */
    readonly von: { readonly art: "ort" | "weg"; readonly name: string } | { readonly art: "frei" } | undefined;
    readonly stand: AnlegenStand;
    /** Esc mit ungespeicherten Abschnitten: die Frage, ob verworfen wird. */
    readonly frage: boolean;
}

export type NeuerWegMeldung = (
    | { readonly art: "gespeichert"; readonly publicId: string; readonly name: string; readonly enden: EditorPathEnds }
    | { readonly art: "abgelehnt"; readonly satz: string }
    /** Der Server scheiterte (5xx) oder antwortete nicht (`status` 0); der Entwurf bleibt. */
    | { readonly art: "serverfehler"; readonly status: number }
    | { readonly art: "abgewiesen"; readonly grund: AnlegenGrund }
    | { readonly art: "verworfen" }
    /** Der Ort am Anfang ließ sich nicht lesen oder hat keine Lage. */
    | { readonly art: "ladefehler" }
) & {
    /** Was angelegt werden sollte, bei Fluss und Bach; ohne Angabe ein Weg. Die Meldung nennt es („✓ Neuer Bach angelegt.“). */
    readonly anlage?: Exclude<PathCreateArt, "weg">;
};

export interface NeuerWegKarte {
    /** Schaltet den Modus „Anlegen“ ein (`map/geometrie/anlegen-modus.ts`); ohne Karte `undefined`. */
    ein(eingabe: AnlegenEingabe): AnlegenModus | undefined;
    /** Der sichtbare Ausschnitt in Karteneinheiten. */
    sichtbar(): Kasten | undefined;
    /** Ein Kartenpunkt am Schirm, in Bildpunkten der Karte. */
    schirm(p: Punkt): Pixel;
    /** Nach dem Speichern: Wege neu zeichnen (`mapRevision` aus der Quittung, WI-0128 E13). */
    geaendert(revision: number | undefined): void;
    /**
     * Stellt auf die Ansicht, in der Flüsse und Bäche zu sehen sind (Landschaft, Ebene Topographie), und sperrt den Wechsel, wie
     * `zuKraftlinien` von „Neue Kraftlinie“; die Antwort beendet das: `zurueck` stellt die vorige Ansicht wieder her, `bleib` lässt sie
     * stehen. Ohne kein Wechsel.
     */
    zuTopographie?(): { zurueck(): void; bleib(): void };
}

export interface NeuerWegOptionen {
    readonly daten: Pick<WegeditorDaten, "zieleImKasten" | "legeAn" | "ort">;
    readonly karte: NeuerWegKarte;
    readonly fangradius: () => number;
    /** Die sichtbaren Ebenen der Derographie: Nur deren Flächenkanten sind Ziele eines Flusses oder Bachs; ohne Angabe alle drei. */
    readonly ebenen?: () => readonly EditorLandscapeLayer[];
    /** Der neue Weg ist gespeichert: das Wege-Fenster an ihm öffnen. */
    readonly geoeffnet?: (publicId: string) => void;
    readonly neueKennung?: () => string;
}

export interface NeuerWeg {
    readonly laufend: Readonly<ShallowRef<NeuerWegLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<NeuerWegMeldung | undefined>>;
    /** Das Ziel unter dem Zeiger, für das Schild (`anlegen-schild.vue`). */
    readonly zeiger: Readonly<ShallowRef<AnlegenZeiger | undefined>>;
    starte(anfang: NeuerWegAnfang): Promise<void>;
    /** Die Ziele neu lesen (die Karte ist zur Ruhe gekommen). */
    ladeZiele(): Promise<void>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): void;
    /** Die Antwort auf die Frage beim Verlassen: verwerfen und enden, oder weiter zeichnen. */
    antworte(verwerfen: boolean): void;
    /** Esc: schließt die Frage, fragt bei ungespeicherten Abschnitten, sonst endet der Modus. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    beende(): void;
    destroy(): void;
}

const LEER: AnlegenStand = { punkte: 0, abschnitte: 0, zurueck: false, wieder: false, fertig: "zuWenig" };

/** Die Geländemarken als Ziele: nur Flüsse und Bäche rasten an ihnen ein und folgen ihnen (OPS-000088). */
export function markenZiele(antwort: Pick<EditorPathTargets, "peaks">): Ziel[] {
    return antwort.peaks.map((marke): Ziel => ({
        art: "gipfel",
        at: { x: marke.x, y: marke.y },
        objekt: marke.publicId,
        name: marke.name,
    }));
}

/**
 * Was nur ein Fluss oder Bach dazu bekommt (Vali 2026-11-08): Ecken und Kanten der Flächen (`kantenZiele`, wie „Ecken bearbeiten“) und
 * die Strecken anderer Flüsse (ihre Stützpunkte stehen schon unter `vertices`). Ohne beide Felder (älterer Server) nichts.
 */
export function flussZiele(antwort: Pick<EditorPathTargets, "areaEdges" | "riverEdges">): Ziel[] {
    const raus: Ziel[] = [];
    kantenZiele(antwort.areaEdges ?? [], new Set(), raus);
    for (const kante of antwort.riverEdges ?? [])
        raus.push({
            art: "kante",
            at: { x: kante.a[0], y: kante.a[1] },
            bis: { x: kante.b[0], y: kante.b[1] },
            objekt: kante.pathId,
            name: kante.name,
            stelle: { objekt: kante.pathId, nr: 0, index: kante.index },
        });
    return raus;
}

/** Die Ziele aus der Antwort des Servers: Orte, Stützpunkte anderer Wege und, für Fluss und Bach, Geländemarken, Flächen und Flüsse. */
export function zieleAus(antwort: EditorPathTargets, art: PathCreateArt = "weg"): Ziel[] {
    return [
        ...(art === "weg" ? [] : markenZiele(antwort)),
        ...(art === "weg" ? [] : flussZiele(antwort)),
        ...antwort.places.map((ort): Ziel => ({
            art: "ort",
            at: { x: ort.x, y: ort.y },
            objekt: ort.publicId,
            name: ort.name,
        })),
        ...antwort.vertices.map((v): Ziel => ({
            art: "ecke",
            at: { x: v.x, y: v.y },
            objekt: v.pathId,
            name: v.name,
            stelle: { objekt: v.pathId, nr: 0, index: v.index },
        })),
    ];
}

/**
 * Der Kasten der Ziele: der sichtbare Ausschnitt, und ist er breiter oder höher als `PATH_TARGETS_MAX_SIDE`, ein Kasten dieser Größe
 * um `um` (den letzten Punkt), damit am Anfang und am Ende des Zeichnens dort Ziele sind, wo man klickt.
 */
export function kastenUm(sichtbar: Kasten, um: Punkt | undefined): Kasten {
    const seite = (a: number, b: number, mitte: number | undefined): [number, number] => {
        if (b - a <= PATH_TARGETS_MAX_SIDE) return [a, b];
        const m = mitte ?? (a + b) / 2;
        return [m - PATH_TARGETS_MAX_SIDE / 2, m + PATH_TARGETS_MAX_SIDE / 2];
    };
    const [x0, x1] = seite(Math.min(sichtbar.x0, sichtbar.x1), Math.max(sichtbar.x0, sichtbar.x1), um?.x);
    const [y0, y1] = seite(Math.min(sichtbar.y0, sichtbar.y1), Math.max(sichtbar.y0, sichtbar.y1), um?.y);
    return { x0, y0, x1, y1 };
}

/** Wo der Weg beginnt, aus seinem ersten Punkt. */
const vonAus = (punkt: AnlegenPunkt | undefined): NeuerWegLauf["von"] =>
    punkt === undefined
        ? undefined
        : punkt.ziel === undefined
          ? { art: "frei" }
          : { art: punkt.ziel.art === "ort" || punkt.ziel.art === "gipfel" ? "ort" : "weg", name: punkt.ziel.name };

export function createNeuerWeg(optionen: NeuerWegOptionen): NeuerWeg {
    const { daten, karte } = optionen;
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const laufend = shallowRef<NeuerWegLauf | undefined>(undefined);
    const meldung = shallowRef<NeuerWegMeldung | undefined>(undefined);
    const zeiger = shallowRef<AnlegenZeiger | undefined>(undefined);
    let modus: AnlegenModus | undefined;
    let ziele: readonly Ziel[] = [];
    let lesen: AbortController | undefined;
    /** Jeder Start bekommt eine eigene Marke; was zu einem älteren gehört, kommt zu spät und zählt nicht. */
    let lauf: object | undefined;
    /** Was der laufende Start anlegt. */
    let art: PathCreateArt = "weg";
    /** Die Ansicht von vorher, solange ein Fluss oder Bach in der Topographie gezeichnet wird. */
    let vorher: { zurueck(): void; bleib(): void } | undefined;

    const setze = (teil: Partial<NeuerWegLauf>): void => {
        if (laufend.value !== undefined) laufend.value = { ...laufend.value, ...teil };
    };
    /** Eine Meldung, bei Fluss und Bach mit der Art. */
    const melde = (neu: NeuerWegMeldung): void => {
        meldung.value = art === "weg" ? neu : { ...neu, anlage: art };
    };

    async function holeZiele(signal: AbortSignal, um: Punkt | undefined): Promise<readonly Ziel[] | null> {
        const sichtbar = karte.sichtbar();
        if (sichtbar === undefined) return null;
        try {
            const antwort = await daten.zieleImKasten(
                kastenUm(sichtbar, um),
                signal,
                art === "weg" ? undefined : { art, ebenen: optionen.ebenen?.() ?? EDITOR_LANDSCAPE_LAYERS },
            );
            return antwort === null ? null : zieleAus(antwort, art);
        } catch {
            return null;
        }
    }

    /**
     * Beendet, was läuft. Die Ansicht (Fluss und Bach): nach dem Speichern und beim Abbruch während des Schreibens bleibt sie (ob er
     * entstand, sagt erst die Quittung; wie „Neue Fläche“), sonst kommt die vorige zurück.
     */
    function beende(ansicht: "bleib" | "zurueck" = "zurueck"): void {
        const zuvor = vorher;
        vorher = undefined;
        if (ansicht === "bleib") zuvor?.bleib();
        else zuvor?.zurueck();
        lesen?.abort();
        lesen = undefined;
        modus?.aus();
        modus = undefined;
        ziele = [];
        lauf = undefined;
        zeiger.value = undefined;
        laufend.value = undefined;
    }

    async function schreibe(punkte: readonly AnlegenPunkt[]): Promise<void> {
        const meiner = lauf;
        if (laufend.value?.phase !== "bereit" || modus === undefined) return;
        modus.sperre(true);
        setze({ phase: "speichert", frage: false });
        // Auch eine Ausnahme beim Lesen der Antwort lässt den Modus nie im Schreiben hängen.
        const antwort = await daten
            .legeAn({
                operationId: neueKennung(),
                points: punkte.map((p) => ({ x: p.at.x, y: p.at.y })),
                ...(art === "weg" ? {} : { art }),
            })
            .catch(() => ({ ok: false as const, status: 0, fehler: { code: "network_error", message: "" } }));
        // Gespeichert ist gespeichert: Die Kacheln folgen, auch wenn der Modus inzwischen endete.
        if (antwort.ok) karte.geaendert(antwort.quittung.mapRevision);
        if (lauf !== meiner) return;
        if (antwort.ok) {
            const { publicId, name, ends } = antwort.quittung;
            beende("bleib");
            melde({ art: "gespeichert", publicId, name, enden: ends });
            optionen.geoeffnet?.(publicId);
            return;
        }
        modus?.sperre(false);
        setze({ phase: "bereit" });
        melde(
            antwort.status === 0 || antwort.status >= 500
                ? { art: "serverfehler", status: antwort.status }
                : { art: "abgelehnt", satz: antwort.fehler.message },
        );
    }

    async function starte(anfang: NeuerWegAnfang): Promise<void> {
        if (geometrieBelegt()) {
            meldeBelegt();
            return;
        }
        beende();
        meldung.value = undefined;
        const meiner = {};
        lauf = meiner;
        art = anfang.art ?? "weg";
        laufend.value = { phase: "laedt", art, von: undefined, stand: LEER, frage: false };
        // Fluss und Bach sind in Standard nicht zu sehen (Betreiber 2026-10-20: „wär cool, wenn die ansicht auf die topographie
        // wechselt“): erst die Topographie, dann das Zeichnen an derselben Stelle; die Kamera bleibt.
        if (art !== "weg") vorher = karte.zuTopographie?.();
        const eigene = new AbortController();
        lesen = eigene;
        let ort: AnlegenPunkt | undefined;
        if ("ort" in anfang) {
            const gelesen = await daten.ort(anfang.ort, eigene.signal).catch(() => null);
            if (lauf !== meiner) return;
            if (gelesen?.position === undefined || !gelesen.active) {
                beende();
                melde({ art: "ladefehler" });
                return;
            }
            const at = { x: gelesen.position.x, y: gelesen.position.y };
            ort = { at, ziel: { art: "ort", at, objekt: gelesen.publicId, name: gelesen.name } };
        }
        const um = ort?.at ?? ("punkt" in anfang ? anfang.punkt : undefined);
        const geladen = (await holeZiele(eigene.signal, um)) ?? [];
        if (lauf !== meiner) return;
        lesen = undefined;
        ziele = geladen;
        let erster: AnlegenPunkt;
        if (ort !== undefined) {
            erster = ort;
        } else if ("punkt" in anfang) {
            // Die Stelle des Rechtsklicks rastet wie ein Klick ein (P5): am Ort oder am Stützpunkt im Fangradius.
            const treffer = einrasten(
                karte.schirm(anfang.punkt),
                ziele,
                art === "weg" ? ["ort", "ecke"] : FLUSS_ANLEGEN.ziele("anfang"),
                optionen.fangradius(),
                karte.schirm,
            );
            erster = { at: treffer?.at ?? anfang.punkt, ziel: treffer?.ziel };
        } else {
            beende();
            return;
        }
        const ein = karte.ein({
            art: art === "weg" ? WEG_ANLEGEN : FLUSS_ANLEGEN,
            anfang: erster,
            ziele: () => ziele,
            fangradius: optionen.fangradius,
            stand(stand) {
                setze({ stand, von: vonAus(modus?.entwurf().punkte[0] ?? erster) });
            },
            zeiger(neu) {
                zeiger.value = neu;
            },
            fertig(punkte) {
                void schreibe(punkte);
            },
            abgewiesen(grund) {
                melde({ art: "abgewiesen", grund });
            },
        });
        if (ein === undefined) {
            beende();
            return;
        }
        modus = ein;
        setze({ phase: "bereit", von: vonAus(erster) });
    }

    return {
        laufend,
        meldung,
        zeiger,
        starte,
        async ladeZiele() {
            if (laufend.value?.phase !== "bereit") return;
            lesen?.abort();
            const eigene = new AbortController();
            lesen = eigene;
            const neu = await holeZiele(eigene.signal, modus?.entwurf().punkte.at(-1)?.at);
            if (lesen !== eigene) return;
            lesen = undefined;
            if (neu === null) return;
            ziele = neu;
            modus?.aktualisiere();
        },
        zurueck: () => modus?.zurueck(),
        wieder: () => modus?.wieder(),
        verwerfen() {
            if (laufend.value?.phase !== "bereit") return;
            modus?.verwerfen();
            setze({ frage: false });
            melde({ art: "verworfen" });
        },
        fertig: () => modus?.fertig(),
        antworte(verwerfen) {
            if (laufend.value === undefined) return;
            if (!verwerfen) {
                setze({ frage: false });
                return;
            }
            beende();
            melde({ art: "verworfen" });
        },
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            // Während des Schreibens nicht mehr warten: Der Modus endet, eine spätere Quittung bringt die Kacheln trotzdem.
            if (jetzt.phase === "speichert") {
                beende("bleib");
                return true;
            }
            // Das zweite Esc beantwortet die Frage: verwerfen und enden.
            if (jetzt.frage) {
                beende();
                melde({ art: "verworfen" });
                return true;
            }
            if (jetzt.stand.abschnitte > 0) {
                setze({ frage: true });
                return true;
            }
            beende();
            return true;
        },
        beende: () => beende(),
        destroy: () => beende(),
    };
}
