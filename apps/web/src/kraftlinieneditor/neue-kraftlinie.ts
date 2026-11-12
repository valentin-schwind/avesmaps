import { shallowRef, type ShallowRef } from "vue";
import type {
    AnlegenEingabe,
    AnlegenGrund,
    AnlegenModus,
    AnlegenPunkt,
    AnlegenStand,
    AnlegenZeiger,
} from "../map/geometrie/anlegen";
import type { Punkt, Ziel } from "../map/geometrie/geometrie";
import { KRAFTLINIE_ANLEGEN } from "../map/geometrie/kraftlinie-anlegen";
import { zieleAus } from "./kraftlinie-art";
import type { KraftlinienDaten } from "./kraftlinien-daten";

/**
 * Die Steuerung von „Neue Kraftlinie“ (WI-0205 K9; Blatt Kraftlinien R4; EDIT-0003 T39): der Modus „Anlegen“ des Geometrie-Moduls mit
 * der Art `KRAFTLINIE_ANLEGEN`; hier steht, was er liest und wann geschrieben wird. Muster `wegeditor/neuer-weg.ts`.
 *
 * - **Start** an einem Nodix („Neue Kraftlinie“ am Nodix in der Ansicht Kraftlinien): Er ist der feste Anfang. Ohne Nodix (aus „Hier
 *   hinzufügen“ der Ansicht Standard, wo an der Stelle keiner liegt) wartet der Modus auf den ersten Klick auf einen Nodix; daneben setzt
 *   auch der erste Klick nichts. Vorher liest die Steuerung alle Nodices der Karte einmal (einige Dutzend,
 *   `GET /api/editor/powerline-targets`); während des Zeichnens fragt niemand den Server.
 * - **Aus einer anderen Ansicht** (`wechsel`, Betreiber 2026-10-18 zum Menü der Ansicht Standard: „Neue Kraftlinie (automatischer
 *   Wechsel zur kraftlnie)“): Die Karte stellt auf die Kraftlinien und sperrt den Wechsel, solange gezeichnet wird, wie „Neue Fläche“ (C3).
 *   Nach dem Speichern bleibt die Ansicht; ein Abbruch (Esc, ein Ladefehler) stellt die vorige wieder her.
 * - **Der Klick auf einen zweiten Nodix** schließt ab und schreibt EINE Operation `powerline.create`; daneben setzt er nichts (R4). Mit
 *   `name` schließt der Abschnitt an die Linie dieses Namens an („Nodix anfügen“), sonst heißt er „A - B“.
 * - Danach endet der Modus, die Meldung nennt die Linie, und das Kraftlinien-Fenster öffnet sie. Kein Zurücknehmen-Feld (T24).
 * - **Ablehnung:** Der Modus bleibt, die Meldung trägt den Satz des Servers. **Esc** beendet (es steht nie ein ungespeicherter Abschnitt).
 * - Kein Sperren: Eine neue Linie ändert keine andere.
 */

export interface NeueKraftlinieAnfang {
    /** Der Nodix, an dem es beginnt (Ort, Beschriftung oder Kraftlinienpunkt); ohne: der erste Klick auf einen Nodix setzt ihn. */
    readonly knoten?: string | undefined;
    /** Ohne `knoten`: die Stelle des Menüs (Karteneinheiten); der Nodix im Fangradius dort wird der Anfang (`karte.naechster`). */
    readonly bei?: Punkt | undefined;
    /** Aus einer anderen Ansicht gestartet: auf die Kraftlinien stellen, nach einem Abbruch zurück. */
    readonly wechsel?: true | undefined;
    /** An welche Linie der neue Abschnitt anschließt („Nodix anfügen“); ohne: eine neue Linie „A - B“. */
    readonly name?: string | undefined;
}

export interface NeueKraftlinieLauf {
    readonly phase: "laedt" | "bereit" | "speichert";
    /** Der Name des Nodix am Anfang (leer bei einem Kraftlinienpunkt ohne Namen). */
    readonly von: string;
    /** Noch kein Anfang: Der erste Klick auf einen Nodix setzt ihn. */
    readonly offen?: true | undefined;
    readonly stand: AnlegenStand;
}

export type NeueKraftlinieMeldung =
    | { readonly art: "gespeichert"; readonly publicId: string; readonly name: string }
    | { readonly art: "abgelehnt"; readonly satz: string }
    | { readonly art: "abgewiesen"; readonly grund: AnlegenGrund }
    | { readonly art: "verworfen" }
    /** Die Nodices ließen sich nicht lesen, oder der Anfang ist keiner (mehr). */
    | { readonly art: "ladefehler" };

export interface NeueKraftlinieKarte {
    /** Schaltet den Modus „Anlegen“ ein (`map/geometrie/anlegen-modus.ts`); ohne Karte `undefined`. */
    ein(eingabe: AnlegenEingabe): AnlegenModus | undefined;
    /** Nach dem Speichern: Karte und Bögen mit der Revision der Quittung neu. */
    geaendert(revision: number | undefined): void;
    /**
     * Stellt auf die Ansicht „Kraftlinien“ und sperrt den Wechsel (`wechsel`); die Antwort beendet das: `zurueck` stellt die vorige
     * Ansicht wieder her, `bleib` lässt die Kraftlinien stehen. Ohne kein Wechsel.
     */
    zuKraftlinien?(): { zurueck(): void; bleib(): void };
    /**
     * Der Nodix, der am Schirm einer Stelle am nächsten liegt, im Fangradius; sonst keiner. Gerechnet über die Lagen der Nodices, nicht
     * über die gezeichnete Ebene: Aus einer anderen Ansicht sind die Kraftlinien noch nicht gezeichnet.
     */
    naechster?(bei: Punkt, ziele: readonly Ziel[], radius: number): Ziel | undefined;
}

export interface NeueKraftlinieOptionen {
    readonly daten: Pick<KraftlinienDaten, "nodices" | "legeAn">;
    readonly karte: NeueKraftlinieKarte;
    readonly fangradius: () => number;
    /** Die neue Linie ist gespeichert: das Kraftlinien-Fenster an ihr öffnen. */
    readonly geoeffnet?: (publicId: string) => void;
    readonly neueKennung?: () => string;
}

export interface NeueKraftlinie {
    readonly laufend: Readonly<ShallowRef<NeueKraftlinieLauf | undefined>>;
    readonly meldung: Readonly<ShallowRef<NeueKraftlinieMeldung | undefined>>;
    /** Das Ziel unter dem Zeiger, für das Schild (`anlegen-schild.vue`). */
    readonly zeiger: Readonly<ShallowRef<AnlegenZeiger | undefined>>;
    starte(anfang: NeueKraftlinieAnfang): Promise<void>;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    fertig(): void;
    /** Esc: beendet, was läuft. Gibt zurück, ob etwas lief. */
    abbrechen(): boolean;
    beende(): void;
    destroy(): void;
}

export function createNeueKraftlinie(optionen: NeueKraftlinieOptionen): NeueKraftlinie {
    const { daten, karte } = optionen;
    const neueKennung = optionen.neueKennung ?? ((): string => crypto.randomUUID());
    const laufend = shallowRef<NeueKraftlinieLauf | undefined>(undefined);
    const meldung = shallowRef<NeueKraftlinieMeldung | undefined>(undefined);
    const zeiger = shallowRef<AnlegenZeiger | undefined>(undefined);
    let modus: AnlegenModus | undefined;
    let lesen: AbortController | undefined;
    /** Jeder Start bekommt eine eigene Marke; was zu einem älteren gehört, kommt zu spät und zählt nicht. */
    let lauf: object | undefined;
    let linie: string | undefined;
    /** Die vorige Ansicht, solange ein Start aus ihr läuft. */
    let vorher: { zurueck(): void; bleib(): void } | undefined;

    const setze = (teil: Partial<NeueKraftlinieLauf>): void => {
        if (laufend.value !== undefined) laufend.value = { ...laufend.value, ...teil };
    };

    /** Beendet, was läuft; `gespeichert` lässt die Kraftlinien-Ansicht stehen, sonst kommt die vorige zurück. */
    function beende(gespeichert = false): void {
        const ansicht = vorher;
        vorher = undefined;
        if (gespeichert) ansicht?.bleib();
        else ansicht?.zurueck();
        lesen?.abort();
        lesen = undefined;
        modus?.aus();
        modus = undefined;
        lauf = undefined;
        linie = undefined;
        zeiger.value = undefined;
        laufend.value = undefined;
    }

    async function schreibe(punkte: readonly AnlegenPunkt[]): Promise<void> {
        const meiner = lauf;
        const von = punkte[0]?.ziel?.objekt;
        const nach = punkte.at(-1)?.ziel?.objekt;
        if (laufend.value?.phase !== "bereit" || modus === undefined || von === undefined || nach === undefined) return;
        modus.sperre(true);
        setze({ phase: "speichert" });
        const antwort = await daten.legeAn({
            operationId: neueKennung(),
            from: von,
            to: nach,
            ...(linie === undefined ? {} : { name: linie }),
        });
        // Gespeichert ist gespeichert: Karte und Bögen folgen, auch wenn der Modus inzwischen endete.
        if (antwort.ok) karte.geaendert(antwort.quittung.mapRevision);
        if (lauf !== meiner) return;
        if (antwort.ok) {
            const { publicId, name } = antwort.quittung;
            beende(true);
            meldung.value = { art: "gespeichert", publicId, name };
            optionen.geoeffnet?.(publicId);
            return;
        }
        modus?.sperre(false);
        setze({ phase: "bereit" });
        meldung.value = { art: "abgelehnt", satz: antwort.fehler.message };
    }

    async function starte(anfang: NeueKraftlinieAnfang): Promise<void> {
        beende();
        meldung.value = undefined;
        const meiner = {};
        lauf = meiner;
        linie = anfang.name;
        laufend.value = {
            phase: "laedt",
            von: "",
            stand: { punkte: 0, abschnitte: 0, zurueck: false, wieder: false, fertig: "zuWenig" },
        };
        if (anfang.wechsel === true) vorher = karte.zuKraftlinien?.();
        const eigene = new AbortController();
        lesen = eigene;
        const antwort = await daten.nodices(eigene.signal).catch(() => null);
        if (lauf !== meiner) return;
        lesen = undefined;
        const ziele: readonly Ziel[] = antwort === null ? [] : zieleAus(antwort);
        const start =
            anfang.knoten !== undefined
                ? ziele.find((ziel) => ziel.objekt === anfang.knoten)
                : anfang.bei !== undefined
                  ? karte.naechster?.(anfang.bei, ziele, optionen.fangradius())
                  : undefined;
        if (antwort === null || (anfang.knoten !== undefined && start === undefined)) {
            beende();
            meldung.value = { art: "ladefehler" };
            return;
        }
        const erster: AnlegenPunkt | undefined = start === undefined ? undefined : { at: start.at, ziel: start };
        const ein = karte.ein({
            art: KRAFTLINIE_ANLEGEN,
            anfang: erster,
            ziele: () => ziele,
            fangradius: optionen.fangradius,
            stand(stand) {
                if (start !== undefined) {
                    setze({ stand });
                    return;
                }
                // Ohne festen Anfang setzt ihn der erste Klick, und ↶ nimmt ihn zurück: Die Leiste nennt ihn.
                const gesetzt = stand.punkte > 0 ? modus?.entwurf().punkte[0]?.ziel : undefined;
                setze(
                    gesetzt === undefined
                        ? { stand, von: "", offen: true }
                        : { stand, von: gesetzt.name, offen: undefined },
                );
            },
            zeiger(neu) {
                zeiger.value = neu;
            },
            fertig(punkte) {
                void schreibe(punkte);
            },
            abgewiesen(grund) {
                meldung.value = { art: "abgewiesen", grund };
            },
        });
        if (ein === undefined) {
            beende();
            return;
        }
        modus = ein;
        setze(start === undefined ? { phase: "bereit", offen: true } : { phase: "bereit", von: start.name });
    }

    return {
        laufend,
        meldung,
        zeiger,
        starte,
        zurueck: () => modus?.zurueck(),
        wieder: () => modus?.wieder(),
        verwerfen() {
            if (laufend.value?.phase !== "bereit") return;
            modus?.verwerfen();
            meldung.value = { art: "verworfen" };
        },
        fertig: () => modus?.fertig(),
        abbrechen() {
            const jetzt = laufend.value;
            if (jetzt === undefined) return false;
            if (jetzt.phase !== "speichert") beende();
            return true;
        },
        beende,
        destroy: beende,
    };
}
