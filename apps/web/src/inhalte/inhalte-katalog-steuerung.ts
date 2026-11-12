import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { ApiFailure, newOperationId } from "../auth/api";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import { createEntwurf, type Entwurf } from "../fenster/entwurf-kern";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { alsApiFailure, istAbbruch } from "../medien/medien-client";
import { inhalteMeldung } from "./inhalte-melde";

/**
 * Der gemeinsame Kern der Reiter des Fensters „Inhalte bearbeiten“ (WI-0254): ein Katalog links (Suche, Filter, Sortierung, seitenweise),
 * ein gewähltes Dokument mit seinem Entwurf (↶ ↷), Speichern, Verwerfen, der Konflikt und das Anlegen. Die Reiter Quellen und Literatur
 * sind je eine Fassung davon (`inhalte-quellen-steuerung.ts`, `inhalte-literatur-steuerung.ts`); was nur sie wissen, steht im Adapter:
 * der Stand des Entwurfs, der Körper des Speicherns, was sich überschneidet und wie eigene Änderungen auf einen fremden Stand wandern.
 *
 * - 🔴 **Ein Entwurf gehört zu EINEM Dokument.** Wer ein anderes wählt, während der Entwurf Änderungen trägt, bekommt die Frage
 *   (`wechselWunsch`); ein Entwurf wird nie stillschweigend auf ein anderes Dokument übertragen oder dort gespeichert.
 * - **Speichern** schickt EINE Operation mit dem gesehenen Stand (`baseRevision`). 409 `edit_conflict` ist der Zustand `konflikt`: Der
 *   Entwurf bleibt stehen; „eigene Änderungen anwenden“ geht nur ohne Überschneidung (oder mit `trotzdem`), „fremden Stand übernehmen“
 *   verwirft den Entwurf.
 * - Jede Anfrage kann abgebrochen werden; ein jüngerer Wunsch löst den älteren ab.
 * - **Zurückgenommen aus „Änderungen“** (WI-0265 B6g1, `inhalte-melde.ts`): Betrifft die Rücknahme Dokumente dieses Reiters (`quittungsArt`), liest er die Liste neu und, wenn er eines der berührten zeigt
 *   und keinen Entwurf trägt, auch dieses. Ein Entwurf mit Änderungen bleibt, wie er ist; das nächste Speichern ist ein gewöhnlicher Konflikt.
 */

export const SEITE = 50;
const ENTPRELL_VORGABE = 250;

export type SpeicherZustand<Dok> =
    | { readonly art: "bereit" }
    | { readonly art: "speichert" }
    | { readonly art: "gespeichert"; readonly revision: number | undefined }
    | { readonly art: "abgelehnt"; readonly code: string; readonly satz: string }
    | {
          // Dieselbe Form wie der Konflikt der Karteneditoren (`fenster/bearbeitung.ts`), damit `EntwurfKonflikt` ihn zeigt.
          readonly art: "konflikt";
          readonly grund: "fremd";
          /** Der fremde Stand, wie der Server ihn jetzt hat. */
          readonly jetzt: Dok;
          readonly wer: string | undefined;
          readonly wann: string | undefined;
          readonly fremde: readonly string[];
          readonly eigene: readonly string[];
          readonly beide: readonly string[];
      };

export type AnlegenZustand =
    | { readonly art: "aus" }
    | { readonly art: "offen" }
    | { readonly art: "laeuft" }
    | { readonly art: "abgelehnt"; readonly code: string; readonly satz: string };

export type HerkunftFilter = "alle" | "legacy" | "editor";

/**
 * Ein eigener Filter des Reiters statt „Herkunft“ und „Stillgelegte“ (die Korpora filtern nach Anzeigeform): die Abschnitte des Blatts, die gesetzte
 * Wahl, was ein Klick setzt und was „Filter lösen“ tut.
 */
export interface KatalogFilter {
    abschnitte: readonly FilterAbschnitt[];
    wahl: FilterWahl;
    setze(abschnitt: string, werte: string[]): void;
    loese(): void;
}

/** Was eine Listenanfrage trägt, bevor der Adapter sie in die Sprache seiner Route übersetzt. */
export interface ListenWunsch<Sort extends string> {
    q: string;
    offset: number;
    limit: number;
    sort: Sort;
    herkunft: HerkunftFilter;
    stand: "aktiv" | "alle";
    /** Der Unterreiter der Liste (etwa die Art bei den Vorkommen), wenn der Reiter einen hat; sonst `undefined`. */
    unter: string | undefined;
}

/** Was nur ein Reiter weiß. */
export interface KatalogAdapter<Dok, Zeile, Liste, Sort extends string, Stand, Koerper> {
    /** Wie die Quittung das Dokument nennt (`affected[].kind`), um die neue Revision zu lesen. */
    quittungsArt: string;
    idVon(dokument: Dok): string;
    revisionVon(dokument: Dok): number;
    zeileId(zeile: Zeile): string;
    zeilenVon(liste: Liste): readonly Zeile[];
    totalVon(liste: Liste): number;
    haengeAn(alt: Liste, neu: Liste): Liste;
    ladeListe(wunsch: ListenWunsch<Sort>, signal: AbortSignal): Promise<Liste>;
    ladeDokument(id: string, signal: AbortSignal): Promise<Dok>;
    aendere(
        id: string,
        body: { operationId: string; baseRevision: number } & Koerper,
    ): Promise<SchreibAntwort<OperationReceipt>>;
    standAus(dokument: Dok): Stand;
    koerperAus(start: Stand, jetzt: Stand): Koerper | undefined;
    zaehle(start: Stand, jetzt: Stand): number;
    /** Ein Fehler, der das Speichern vor dem Server aufhält (ein leerer Titel); sonst `undefined`. */
    pruefe(jetzt: Stand): { code: string; satz: string } | undefined;
    /** Was sich überschneidet: Felder und Gegenstände, die beide Seiten gegenüber `start` geändert haben. */
    konflikt(start: Stand, eigen: Stand, fremd: Stand): { eigene: string[]; fremde: string[]; beide: string[] };
    /** Die eigenen Änderungen (`start` → `eigen`) auf den fremden Stand legen; der Entwurf beginnt dann beim fremden. */
    uebertrage(fremd: Stand, start: Stand, eigen: Stand): Stand;
}

export interface KatalogOptionen<Dok, Zeile, Liste, Sort extends string, Stand, Koerper> {
    adapter: KatalogAdapter<Dok, Zeile, Liste, Sort, Stand, Koerper>;
    vorgabeSortierung: Sort;
    /** Der Unterreiter der Liste (Vorkommen: Alle, Fauna, Flora, Waren, Spezies): Der Aufrufer besitzt den Wert, ein Wechsel lädt die Liste neu. */
    unter?: Ref<string>;
    /** Wartezeit der Suche in Millisekunden; Tests nehmen 0. */
    entprellMs?: number;
    neueOperationId?: () => string;
}

export interface Katalog<Dok, Zeile, Liste, Sort extends string, Stand> {
    // --- Liste ---
    readonly suche: Ref<string>;
    readonly herkunft: Ref<HerkunftFilter>;
    readonly zeigeStillgelegte: Ref<boolean>;
    readonly sortierung: Ref<Sort>;
    readonly liste: ShallowRef<Liste | undefined>;
    readonly zeilen: ComputedRef<readonly Zeile[]>;
    readonly listeLaedt: Ref<boolean>;
    readonly listeFehler: ShallowRef<ApiFailure | undefined>;
    readonly mehrDa: ComputedRef<boolean>;
    ladeMehr(): void;
    ladeListeNeu(): void;
    // --- Auswahl ---
    readonly gewaehlt: Ref<string | undefined>;
    readonly wechselWunsch: Ref<string | undefined>;
    waehle(id: string): void;
    waehleDirekt(id: string): void;
    bestaetigeWechsel(): void;
    bleibe(): void;
    // --- Das Dokument und sein Entwurf ---
    readonly dokument: ShallowRef<Dok | undefined>;
    readonly dokumentLaedt: Ref<boolean>;
    readonly dokumentFehler: ShallowRef<ApiFailure | undefined>;
    readonly stand: ShallowRef<Stand | undefined>;
    readonly anzahl: ComputedRef<number>;
    readonly geaendert: ComputedRef<boolean>;
    readonly zustand: ShallowRef<SpeicherZustand<Dok>>;
    readonly kannZurueck: Ref<boolean>;
    readonly kannWieder: Ref<boolean>;
    jetzt(): Stand | undefined;
    schritt(neu: Stand, verschmelze?: string): void;
    feldSchluss(): void;
    zurueck(): void;
    wieder(): void;
    verwerfen(): void;
    speichern(): Promise<void>;
    eigeneAnwenden(trotzdem?: boolean): Promise<void>;
    fremdenUebernehmen(): Promise<void>;
    // --- Anlegen ---
    readonly anlegen: ShallowRef<AnlegenZustand>;
    oeffneAnlegen(): void;
    schliesseAnlegen(): void;
    legeAn(
        sende: () => Promise<SchreibAntwort<{ publicId: string }>>,
        bekannt?: { code: string; idAus: (details: unknown) => string | undefined },
    ): Promise<void>;
}

export function createKatalog<Dok, Zeile, Liste, Sort extends string, Stand, Koerper>(
    optionen: KatalogOptionen<Dok, Zeile, Liste, Sort, Stand, Koerper>,
): Katalog<Dok, Zeile, Liste, Sort, Stand> {
    const { adapter } = optionen;
    const neueOperationId = optionen.neueOperationId ?? newOperationId;
    const entprellMs = optionen.entprellMs ?? ENTPRELL_VORGABE;

    // --- Liste ---
    const suche = ref("");
    const herkunft = ref<HerkunftFilter>("alle");
    const zeigeStillgelegte = ref(false);
    const sortierung = ref(optionen.vorgabeSortierung) as Ref<Sort>;
    const liste = shallowRef<Liste | undefined>(undefined);
    const listeLaedt = ref(false);
    const listeFehler = shallowRef<ApiFailure | undefined>(undefined);
    const zeilen = computed(() => (liste.value === undefined ? [] : adapter.zeilenVon(liste.value)));
    const mehrDa = computed(() => liste.value !== undefined && adapter.totalVon(liste.value) > zeilen.value.length);
    let listeAbbruch: AbortController | undefined;

    async function holeListe(anhaengen: boolean, mindestens = 0): Promise<void> {
        listeAbbruch?.abort();
        const abbruch = new AbortController();
        listeAbbruch = abbruch;
        listeLaedt.value = true;
        const bisher = anhaengen ? zeilen.value.length : 0;
        try {
            const antwort = await adapter.ladeListe(
                {
                    q: suche.value,
                    offset: bisher,
                    limit: anhaengen ? SEITE : Math.max(SEITE, mindestens),
                    sort: sortierung.value,
                    herkunft: herkunft.value,
                    stand: zeigeStillgelegte.value ? "alle" : "aktiv",
                    unter: optionen.unter?.value,
                },
                abbruch.signal,
            );
            if (abbruch.signal.aborted) return;
            listeFehler.value = undefined;
            liste.value = anhaengen && liste.value !== undefined ? adapter.haengeAn(liste.value, antwort) : antwort;
        } catch (fehler) {
            if (istAbbruch(fehler, abbruch.signal)) return;
            listeFehler.value = alsApiFailure(fehler);
        } finally {
            if (listeAbbruch === abbruch) listeLaedt.value = false;
        }
    }

    let sucheTimer: ReturnType<typeof setTimeout> | undefined;
    watch(suche, () => {
        if (sucheTimer !== undefined) clearTimeout(sucheTimer);
        sucheTimer = setTimeout(() => void holeListe(false), entprellMs);
    });
    watch(
        [herkunft, zeigeStillgelegte, sortierung, ...(optionen.unter === undefined ? [] : [optionen.unter])],
        () => void holeListe(false),
    );

    // --- Auswahl und Dokument ---
    const gewaehlt = ref<string | undefined>(undefined);
    const wechselWunsch = ref<string | undefined>(undefined);
    const dokument = shallowRef<Dok | undefined>(undefined);
    const dokumentLaedt = ref(false);
    const dokumentFehler = shallowRef<ApiFailure | undefined>(undefined);
    const stand = shallowRef<Stand | undefined>(undefined);
    const zustand = shallowRef<SpeicherZustand<Dok>>({ art: "bereit" });
    const kannZurueck = ref(false);
    const kannWieder = ref(false);
    const kern: Entwurf<Stand> = createEntwurf<Stand>();
    let dokumentAbbruch: AbortController | undefined;

    const anzahl = computed(() => {
        const start = dokument.value === undefined ? undefined : adapter.standAus(dokument.value);
        return start === undefined || stand.value === undefined ? 0 : adapter.zaehle(start, stand.value);
    });
    const geaendert = computed(() => anzahl.value > 0);

    function spiegele(): void {
        stand.value = kern.jetzt();
        const lage = kern.lage();
        kannZurueck.value = lage.zurueck;
        kannWieder.value = lage.wieder;
    }

    function beginne(neu: Dok): void {
        dokument.value = neu;
        kern.beginne(adapter.standAus(neu));
        spiegele();
    }

    async function ladeDokument(id: string): Promise<boolean> {
        dokumentAbbruch?.abort();
        const abbruch = new AbortController();
        dokumentAbbruch = abbruch;
        dokumentLaedt.value = true;
        try {
            const neu = await adapter.ladeDokument(id, abbruch.signal);
            if (abbruch.signal.aborted) return false;
            dokumentFehler.value = undefined;
            beginne(neu);
            return true;
        } catch (fehler) {
            if (istAbbruch(fehler, abbruch.signal)) return false;
            dokumentFehler.value = alsApiFailure(fehler);
            dokument.value = undefined;
            kern.leere();
            spiegele();
            return false;
        } finally {
            if (dokumentAbbruch === abbruch) dokumentLaedt.value = false;
        }
    }

    function waehleDirekt(id: string): void {
        gewaehlt.value = id;
        wechselWunsch.value = undefined;
        zustand.value = { art: "bereit" };
        void ladeDokument(id);
    }

    function waehle(id: string): void {
        if (id === gewaehlt.value) return;
        if (geaendert.value) {
            wechselWunsch.value = id;
            return;
        }
        waehleDirekt(id);
    }

    // --- Der Entwurf ---
    const jetzt = (): Stand | undefined => kern.jetzt();
    function schritt(neu: Stand, verschmelze?: string): void {
        if (neu === kern.jetzt()) return;
        kern.schritt(neu, verschmelze);
        if (zustand.value.art === "gespeichert" || zustand.value.art === "abgelehnt") zustand.value = { art: "bereit" };
        spiegele();
    }
    function zurueck(): void {
        if (kern.zurueck()) spiegele();
    }
    function wieder(): void {
        if (kern.wieder()) spiegele();
    }
    function verwerfen(): void {
        kern.verwerfen();
        zustand.value = { art: "bereit" };
        spiegele();
    }
    function bestaetigeWechsel(): void {
        const id = wechselWunsch.value;
        if (id === undefined) return;
        waehleDirekt(id);
    }
    function bleibe(): void {
        wechselWunsch.value = undefined;
    }

    // --- Speichern ---
    async function speichern(): Promise<void> {
        const d = dokument.value;
        const start = d === undefined ? undefined : adapter.standAus(d);
        const aktuell = jetzt();
        if (d === undefined || start === undefined || aktuell === undefined || zustand.value.art === "speichert")
            return;
        const koerper = adapter.koerperAus(start, aktuell);
        if (koerper === undefined) return;
        const fehler = adapter.pruefe(aktuell);
        if (fehler !== undefined) {
            zustand.value = { art: "abgelehnt", code: fehler.code, satz: fehler.satz };
            return;
        }
        zustand.value = { art: "speichert" };
        const id = adapter.idVon(d);
        const antwort = await adapter.aendere(id, {
            operationId: neueOperationId(),
            baseRevision: adapter.revisionVon(d),
            ...koerper,
        });
        if (dokument.value === undefined || adapter.idVon(dokument.value) !== id) return;
        if (antwort.ok) {
            const revision = antwort.quittung.affected.find((eine) => eine.kind === adapter.quittungsArt)?.revision;
            if (await ladeDokument(id)) zustand.value = { art: "gespeichert", revision };
            void holeListe(false, zeilen.value.length);
            return;
        }
        if (antwort.status === 409 && antwort.fehler.code === "edit_conflict") {
            await konfliktLesen(d, start, aktuell, antwort.fehler.details as KonfliktDetails | undefined);
            return;
        }
        zustand.value = { art: "abgelehnt", code: antwort.fehler.code, satz: antwort.fehler.message };
    }

    interface KonfliktDetails {
        changedBy?: { displayName?: string };
        changedAt?: string;
    }

    /** Der fremde Stand und was sich überschneidet. */
    async function konfliktLesen(
        d: Dok,
        start: Stand,
        aktuell: Stand,
        details: KonfliktDetails | undefined,
    ): Promise<void> {
        let frisch: Dok;
        try {
            frisch = await adapter.ladeDokument(adapter.idVon(d), new AbortController().signal);
        } catch (fehler) {
            const f = alsApiFailure(fehler);
            zustand.value = { art: "abgelehnt", code: f.code, satz: f.message };
            return;
        }
        const ergebnis = adapter.konflikt(start, aktuell, adapter.standAus(frisch));
        zustand.value = {
            art: "konflikt",
            grund: "fremd",
            jetzt: frisch,
            wer: details?.changedBy?.displayName,
            wann: details?.changedAt,
            fremde: ergebnis.fremde,
            eigene: ergebnis.eigene,
            beide: ergebnis.beide,
        };
    }

    /** Die eigenen Änderungen auf den fremden Stand legen: ohne Überschneidung, oder mit `trotzdem` gewinnt der eigene Wert. */
    async function eigeneAnwenden(trotzdem = false): Promise<void> {
        const z = zustand.value;
        const d = dokument.value;
        const aktuell = jetzt();
        if (z.art !== "konflikt" || (z.beide.length > 0 && !trotzdem) || d === undefined || aktuell === undefined)
            return;
        const alterStart = adapter.standAus(d);
        // Der neue Stand beginnt beim fremden; die eigenen Änderungen kommen als Schritt darauf.
        dokument.value = z.jetzt;
        const neuerStart = adapter.standAus(z.jetzt);
        kern.beginne(neuerStart);
        const darauf = adapter.uebertrage(neuerStart, alterStart, aktuell);
        if (darauf !== neuerStart) kern.schritt(darauf);
        zustand.value = { art: "bereit" };
        spiegele();
    }

    async function fremdenUebernehmen(): Promise<void> {
        const z = zustand.value;
        if (z.art !== "konflikt") return;
        beginne(z.jetzt);
        zustand.value = { art: "bereit" };
        void holeListe(false, zeilen.value.length);
    }

    // --- Anlegen ---
    const anlegen = shallowRef<AnlegenZustand>({ art: "aus" });
    function oeffneAnlegen(): void {
        anlegen.value = anlegen.value.art === "aus" ? { art: "offen" } : { art: "aus" };
    }
    function schliesseAnlegen(): void {
        anlegen.value = { art: "aus" };
    }
    async function legeAn(
        sende: () => Promise<SchreibAntwort<{ publicId: string }>>,
        bekannt?: { code: string; idAus: (details: unknown) => string | undefined },
    ): Promise<void> {
        if (anlegen.value.art === "laeuft") return;
        anlegen.value = { art: "laeuft" };
        const antwort = await sende();
        if (antwort.ok) {
            anlegen.value = { art: "aus" };
            // Das neue Dokument steht in der Liste unter seinem Titel: erst die Liste laden, dann wählen.
            await holeListe(false);
            waehleDirekt(antwort.quittung.publicId);
            return;
        }
        anlegen.value = { art: "abgelehnt", code: antwort.fehler.code, satz: antwort.fehler.message };
        if (bekannt !== undefined && antwort.status === 409 && antwort.fehler.code === bekannt.code) {
            const vorhanden = bekannt.idAus(antwort.fehler.details);
            if (vorhanden !== undefined) waehle(vorhanden);
        }
    }

    // Der Reiter „Änderungen“ hat Inhalte zurückgenommen: Die Liste liest neu, und das gewählte Dokument, wenn es berührt ist und kein Entwurf daran hängt.
    watch(inhalteMeldung, (meldung) => {
        if (meldung === undefined) return;
        const meine = meldung.betroffen.filter((eines) => eines.kind === adapter.quittungsArt).map((eines) => eines.id);
        if (meine.length === 0) return;
        if (liste.value !== undefined) void holeListe(false, zeilen.value.length);
        const id = gewaehlt.value;
        if (id === undefined || !meine.includes(id) || geaendert.value || zustand.value.art === "speichert") return;
        zustand.value = { art: "bereit" };
        void ladeDokument(id);
    });

    onScopeDispose(() => {
        listeAbbruch?.abort();
        dokumentAbbruch?.abort();
        if (sucheTimer !== undefined) clearTimeout(sucheTimer);
    });

    return {
        suche,
        herkunft,
        zeigeStillgelegte,
        sortierung,
        liste,
        zeilen,
        listeLaedt,
        listeFehler,
        mehrDa,
        ladeMehr: () => void holeListe(true),
        ladeListeNeu: () => void holeListe(false),
        gewaehlt,
        wechselWunsch,
        waehle,
        waehleDirekt,
        bestaetigeWechsel,
        bleibe,
        dokument,
        dokumentLaedt,
        dokumentFehler,
        stand,
        anzahl,
        geaendert,
        zustand,
        kannZurueck,
        kannWieder,
        jetzt,
        schritt,
        feldSchluss: () => kern.schluss(),
        zurueck,
        wieder,
        verwerfen,
        speichern,
        eigeneAnwenden,
        fremdenUebernehmen,
        anlegen,
        oeffneAnlegen,
        schliesseAnlegen,
        legeAn,
    };
}
