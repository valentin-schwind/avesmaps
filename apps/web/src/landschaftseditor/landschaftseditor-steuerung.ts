import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    editorLandscapesBatchRetireUrl,
    type LandscapeBatchRetireBody,
    editorLandscapeCopyUrl,
    editorLandscapeRetireUrl,
    editorLandscapeUrl,
    type LandscapeCopyBody,
    type LandscapeCopyReceipt,
    type LandscapeUpdateBody,
    type EditorLandscapeDetail,
    type EditorLandscapeLayer,
    type EditorLandscapeList,
    type LandscapeRetireBody,
    type LANDSCHAFTSEDITOR as LANDSCHAFTSEDITOR_REITER,
    type EditorPeakDetail,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { sende } from "../fenster/entwurf-senden";
import { ApiFailure, type Fetcher } from "../auth/api";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { EditorSperre } from "../editor-sperre/sperre";
import { createBearbeitung, type Bearbeitung } from "../fenster/bearbeitung";
import { entwurfsTaste } from "../fenster/entwurf-kern";
import { gesicherte } from "../fenster/entwurf-sicherung";
import { createVerlauf, type Verlauf } from "../fenster/entwurf-verlauf";
import type { ListenSchalter } from "../fenster/listen-schalter";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import { t } from "../i18n/i18n";
import { createLandschaftArt, type LandschaftArt, type LandschaftFelder, type LandschaftForm } from "./landschaft-art";
import type { KopierZiel } from "./landschaft-kopieren";
import {
    LANDSCHAFTEN_OPTIONEN,
    gipfelGegenstand,
    gipfelVon,
    kandidatVon,
    wikiEintragVon,
    ladeLandschaften,
} from "./landschaften-liste";
import { createLandschaftVerlaufsArt } from "./landschaft-verlauf";
import { createGipfelVerlaufsArt } from "./gipfel-verlauf";
import { createGipfelArt, type GipfelFelder } from "./gipfel-art";
import { createGipfelDaten } from "./gipfel-daten";
import { landschaftMeldung } from "./landschaft-melde";

/**
 * Was die Seite für den Landschaftseditor hält (WI-0178 A3, B2; EDIT-0004 §2.2; EDIT-0003 T44; Muster `ortseditor/ortseditor-steuerung.ts`):
 * die Liste der Landschaften (einmal geladen, von allen Fenstern geteilt) samt Suche und Filter, und je Fenster EINE Landschaft mit
 * ihrer Bearbeitung (`fenster/bearbeitung.ts`). `app.vue` hängt nur ein.
 *
 * - 🔴 **Je Landschaft ein Fenster** (T44, wie je Ort, EDIT-0001 D19): Ein Klick in der Liste öffnet die Landschaft an der Stelle dieses
 *   Fensters, das bisherige wandert mit seinem Entwurf nach „Offene Bearbeitungen“. Verb, Handgriffe und ein Klick auf die Karte öffnen
 *   an der Stelle des vordersten Landschaftsfensters, sonst in einem neuen.
 * - **Eine Bearbeitung je Landschaft** (O3): gelesener Stand, EIN Entwurf für Felder und Form, „Fertig“ als `landscape.update`. Sie
 *   entsteht mit dem Fenster und geht mit ihm; ein Entwurf wird beim Schließen abgelegt, nie verworfen (`fenster-verwaltung.ts`).
 * - **Nach dem Neuladen** stehen im Browser gesicherte Entwürfe als abgelegte Fenster unter „Offene Bearbeitungen“ (R1, D19).
 * - **Von der Karte** (A4, T34 (1)): Ein Handgriff an einer Fläche oder ein Klick im Editor-Modus öffnet das Fenster an ihr, auf Wunsch
 *   an einem Reiter. Öffnet die Karte das Fenster erst, steht es nur mit den Eigenschaften (Variante A, `listen-schalter.ts`).
 */
export const LANDSCHAFTSEDITOR = "landschaftseditor";

/** Ein Reiter des Fensters (`LANDSCHAFTSEDITOR` in `packages/shared`). */
export type LandschaftReiter = (typeof LANDSCHAFTSEDITOR_REITER)["eintraege"][number]["id"];

export type LandschaftBearbeitung = Bearbeitung<EditorLandscapeDetail, LandschaftFelder, LandschaftForm> & {
    readonly art: LandschaftArt;
};

/**
 * Ein Gipfel oder Vulkan im selben Fenster (WI-0178 P2; Orchestrierung 2026-10-18: Gipfel sind Zeilen der Ebene Topographie): Sein
 * Gegenstand heißt `gipfel:<Kennung>`, damit Liste, Fenster und „Offene Bearbeitungen“ ihn von einer Fläche unterscheiden.
 */
export type GipfelBearbeitung = Bearbeitung<EditorPeakDetail, GipfelFelder, never>;
export { gipfelGegenstand, gipfelVon };

/** Was das Schreiben braucht; ohne bleibt der Editor lesend (Tests, Besucher). */
export interface LandschaftEntwurfOptionen {
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust">;
    /** Geschrieben: die Kachelrevision an die Karte. */
    geaendert(revision: number | undefined): void;
    /** Ein Gipfel geschrieben: wie `geaendert`, auch die Wege, weil Flussenden seiner Lage folgen (OPS-000088). Ohne Angabe `geaendert`. */
    gipfelGeaendert?(revision: number | undefined): void;
    readonly speicher?: Storage | undefined;
    /** Darf diese Sitzung Landschaften schreiben (Recht und `MAP_EDITING`)? */
    darfSchreiben(): boolean;
    /**
     * Die Ebene der Karte, wenn ein Fenster mit Ebenenwechsel im Entwurf aus dem Bild geht oder wiederkommt: `zeigt` sagt, ob die Karte
     * gerade diese Ebene der Derographie zeigt, `stelle` stellt sie um (wie der Ebenenwechsel im Fenster, `ansichtFuerHinflug`).
     */
    readonly ebene?:
        | {
              zeigt(ebene: EditorLandscapeLayer): boolean;
              stelle(ebene: EditorLandscapeLayer): void;
          }
        | undefined;
}

export interface LandschaftseditorSteuerung {
    readonly liste: Readonly<ShallowRef<EditorLandscapeList | undefined>>;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    readonly listenEinstellung: ListenEinstellung;
    /** Die Landschaft des vordersten Landschaftsfensters. */
    readonly auswahl: ComputedRef<string | undefined>;
    /** Die offenen Fenster dieses Werkzeugs, das vorderste zuletzt. */
    readonly fenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Bearbeitung einer Landschaft, solange ein Fenster sie trägt. */
    bearbeitungVon(id: string | undefined): LandschaftBearbeitung | undefined;
    /** Die Bearbeitung eines Gipfels (Gegenstand `gipfel:<Kennung>`), solange ein Fenster ihn trägt. */
    gipfelBearbeitungVon(gegenstand: string | undefined): GipfelBearbeitung | undefined;
    /**
     * Dieselbe Gipfelhöhe nur in EINEM Entwurf (P5, Fassung 16): Ändert das Fenster des Gipfels seine Höhe, ruht das Feld in der
     * Gipfelliste des Gebirges (`imGipfel`); ändert die Gipfelliste eines Gebirges sie, ruht das Feld im Fenster des Gipfels
     * (`imGebirge`). Der Satz sagt, wo sie gerade geändert wird.
     */
    gipfelHoeheImGipfel(id: string): string | undefined;
    gipfelHoeheImGebirge(id: string): string | undefined;
    /** Ein Gipfel von der Karte (Klick aufs ▲, Handgriff): das Fenster an ihm, am Reiter „Eigenschaften“. */
    oeffneGipfel(id: string, name?: string): string;
    /** Die Bearbeitung des vordersten sichtbaren Landschaftsfensters, wenn dort gerade bearbeitet wird (Leiste, Tasten, Esc). */
    readonly aktiv: ComputedRef<LandschaftBearbeitung | GipfelBearbeitung | undefined>;
    /** Esc für die laufende Bearbeitung (R2): fragt bei Ungeschriebenem, sonst endet sie. `true`, wenn sie die Taste nahm. */
    esc(): boolean;
    /** Strg+Z und Strg+Y (Mac ⌘) für die laufende Bearbeitung, nie im Textfeld. `true`, wenn sie die Taste nahm. */
    taste(event: KeyboardEvent): boolean;
    /** Ein Klick in der Liste eines Fensters (ohne Fenster: im vordersten): die Landschaft an dessen Stelle (D19). */
    waehle(id: string | undefined, fensterId?: string): void;
    /** Das Verb „Landschaften bearbeiten“: holt das vorderste Fenster hervor oder öffnet eins. */
    oeffneWerkzeug(): void;
    /** Ein Handgriff an der Karte (A4): das Fenster an dieser Landschaft, auf Wunsch an einem Reiter. Gibt das Fenster zurück. */
    oeffneFuer(id: string, reiter?: LandschaftReiter): string;
    /**
     * Ein Objekt der Karte wurde geöffnet (EDIT-0003 T34 (1)). Betreiber, wörtlich: „Der Landschafteditor bei Landschaften bearbeiten
     * muss automatisch kommen wenn man auf eine Fläche Landschaftsfläche geklickt hat. Bei Orten kommt er schon automatisch.“ Im
     * Editor-Modus (`editorModus`: kein Modus läuft, und die Lasche „Editor“ ist vorn, wie am Ort) öffnet ein Klick auf eine Fläche das
     * Fenster an ihrer Landschaft, auch wenn es zu war, und es kommt nach vorn. Ist „Info“ vorn, bleibt das Infopanel samt Gruppe
     * „Bearbeiten · nur Editoren“. `true`, wenn es sie nahm.
     */
    geoeffnet(ref: SubjectRef, options: OpenSubjectOptions, editorModus: boolean): boolean;
    /** Der Reiter, den zuletzt ein Handgriff verlangt hat; `mal` zählt, damit derselbe Wunsch zweimal wirkt. */
    readonly reiterWunsch: Readonly<ShallowRef<{ reiter: LandschaftReiter; mal: number } | undefined>>;
    ladeListe(): void;
    /**
     * Ein Handgriff im Kartenmenü ändert ein Feld (D1: Reihenfolge, Klicksperre): Das Fenster öffnet am Reiter „Eigenschaften“, der
     * Entwurf nimmt die Änderung, sobald der Stand gelesen ist; geschrieben wird mit „Fertig“.
     */
    aendere(id: string, neu: (felder: LandschaftFelder) => LandschaftFelder): void;
    /** „Fläche entfernen …“ (D2): schreibt `landscape.retire`; danach lesen Fenster und Liste neu. */
    entferne(id: string, stage: LandscapeRetireBody["stage"]): Promise<{ ok: true } | { ok: false; satz: string }>;
    /**
     * „Verbergen“ und „Zurückholen“ (T41 (4); Kartenmenü und Band im Fenster): schreibt sofort `landscape.update` mit `hidden` gegen den
     * frisch gelesenen Stand, wie am Ort; danach lesen Fenster und Liste neu. ↺ steht im Verlauf.
     */
    verberge(
        id: string,
        ja: boolean,
    ): Promise<{ ok: true; name: string; revision: number } | { ok: false; satz: string }>;
    /**
     * „Entfernen …“ für alle angehakten Landschaften der Mehrfachauswahl (EDIT-0003 T57): EINE Operation `landscape.retire` über alle,
     * gegen den Stand beim Schreiben; danach lesen ihre Fenster und die Liste neu. ↺ an einer holt alle zurück.
     */
    entferneAlle(
        ids: readonly string[],
        stage: LandscapeRetireBody["stage"],
    ): Promise<{ ok: true } | { ok: false; satz: string }>;
    /** Das Kartenmenü bittet um das Blatt „Fläche entfernen …“ im Fenster dieser Fläche; `mal` zählt, damit derselbe Wunsch zweimal wirkt. */
    readonly entfernenWunsch: Readonly<ShallowRef<{ id: string; mal: number } | undefined>>;
    /**
     * „Neue Fläche“ ist gespeichert (T47, C3 `geoeffnet`): die Liste neu, das Fenster an der neuen Fläche am Reiter „Eigenschaften“,
     * der Name markiert (`nameWunsch`), damit der Griff „Fläche-001“ gleich überschrieben wird.
     */
    angelegt(neu: { readonly publicId: string; readonly name: string }): void;
    /** „▲ Gipfel setzen …“ ist gespeichert (P7): wie `angelegt`, am Gegenstand `gipfel:<Kennung>`. */
    gipfelGesetzt(neu: { readonly publicId: string; readonly name: string }): void;
    /** Das Fenster dieser Fläche (oder dieses Gipfels) markiert seinen Namen; `mal` zählt, damit derselbe Wunsch zweimal wirkt. */
    readonly nameWunsch: Readonly<ShallowRef<{ id: string; mal: number } | undefined>>;
    oeffneEntfernen(id: string): void;
    /** Das Kartenmenü bittet um das Blatt „Fläche kopieren“ (Werkzeug 8) für diese Teilfläche im Fenster ihrer Landschaft; `mal` zählt. */
    readonly kopierenWunsch: Readonly<ShallowRef<{ id: string; areaId: string; mal: number } | undefined>>;
    oeffneKopieren(id: string, areaId: string): void;
    /** Das Fenster hat das Blatt geöffnet: Der Wunsch geht weg. */
    kopierenGesehen(): void;
    /**
     * „Kopieren“ im Blatt (Werkzeug 8): schreibt `landscape.copy` gegen die Revision der Teilfläche im gelesenen Stand. Danach lesen die
     * Fenster beider Landschaften und die Liste neu; zeigt die Karte nur die Ebene der Quelle, stellt sie die Zielebene ein, und das Fenster
     * der Ziellandschaft kommt nach vorn (Legacy: „Danach ist die Zielebene aktiv und die Kopie ausgewählt“).
     */
    kopiere(
        id: string,
        areaId: string,
        ziel: KopierZiel,
    ): Promise<{ ok: true; quittung: LandscapeCopyReceipt } | { ok: false; satz: string }>;
    /** Der Verlauf einer Fläche (D3) oder eines Gipfels (Gegenstand `gipfel:<Kennung>`), solange ein Fenster sie trägt. */
    verlaufVon(id: string | undefined): Verlauf<unknown> | undefined;
    /**
     * „Gipfel entfernen …“ am Gegenstand `gipfel:<Kennung>` (Editor-Orchestrierung 2026-10-19): `peak.retire` gegen den Stand des
     * Fensters, weich; danach lesen Fenster, Verlauf und Liste neu, die Karte bekommt die Revision. ↺ im Verlauf des Gipfels.
     */
    entferneGipfel(gegenstand: string): Promise<{ ok: true } | { ok: false; satz: string }>;
    destroy(): void;
}

/** Eine Bearbeitung, die nur liest (ohne Entwurfsoptionen): Sperre und Karte tun nichts. */
const OHNE_SPERRE: LandschaftEntwurfOptionen["sperre"] = {
    nimm: async () => ({ art: "fehler", fehler: new ApiFailure(423, "map_editing_off", "") }),
    gib: () => undefined,
    beiVerlust: () => () => undefined,
};

export function createLandschaftseditorSteuerung(
    werkzeugfenster: Werkzeugfenster,
    fetcher: Fetcher = (url, init) => fetch(url, init),
    /** Der gemeinsame Schalter der Listen: Von der Karte geöffnet, steht das Fenster mit eingeklappter Liste (EDIT-0003, Variante A). */
    listenSchalter?: Pick<ListenSchalter, "vorlaeufig">,
    entwurf?: LandschaftEntwurfOptionen,
): LandschaftseditorSteuerung {
    const liste = shallowRef<EditorLandscapeList | undefined>(undefined);
    const ladeFehler = ref<string | undefined>(undefined);
    const listenEinstellung = createListenEinstellung({
        vorbelegt: LANDSCHAFTEN_OPTIONEN.vorbelegt,
        sortierung: "name",
        // „Objekte: Alle“ (WI-0271 L4, `LANDSCHAFTEN_MASKEN`).
        maske: "alle",
    });
    const reiterWunsch = shallowRef<{ reiter: LandschaftReiter; mal: number } | undefined>(undefined);
    const entfernenWunsch = shallowRef<{ id: string; mal: number } | undefined>(undefined);
    const kopierenWunsch = shallowRef<{ id: string; areaId: string; mal: number } | undefined>(undefined);
    const nameWunsch = shallowRef<{ id: string; mal: number } | undefined>(undefined);
    let laden: AbortController | undefined;
    const bearbeitungen = shallowRef(new Map<string, LandschaftBearbeitung>());
    const gipfelBearbeitungen = shallowRef(new Map<string, GipfelBearbeitung>());
    const gipfelDaten = createGipfelDaten((eingabe, init) => fetcher(String(eingabe), init));
    const nurLesen = (): boolean => entwurf?.darfSchreiben() !== true;

    const fenster = computed(() =>
        werkzeugfenster.stand.value.fenster
            .filter((eintrag) => eintrag.werkzeug === LANDSCHAFTSEDITOR)
            .sort((a, b) => a.vorn - b.vorn),
    );
    /** Das vorderste sichtbare Landschaftsfenster: Dort öffnen Verb, Handgriffe und Karte (D19). */
    const vorderstes = computed(() => fenster.value.filter((eintrag) => eintrag.lage !== "versenkt").at(-1));
    const auswahl = computed(() => vorderstes.value?.gegenstand);

    const titelVon = (id: string | undefined, name?: string): string => {
        const gipfel = gipfelVon(id);
        const kandidat = kandidatVon(id);
        const eintrag = wikiEintragVon(id);
        const gefunden =
            name ??
            (gipfel !== undefined
                ? liste.value?.peaks?.find((row) => row.id === gipfel)?.name
                : kandidat !== undefined
                  ? liste.value?.kandidaten?.find((row) => row.id === kandidat)?.name
                  : eintrag !== undefined
                    ? liste.value?.wikiEintraege?.find((row) => row.id === eintrag)?.name
                    : liste.value?.rows.find((row) => row.id === id)?.name);
        return gefunden === undefined ? t("landschaftseditor.titel") : `${t("landschaftseditor.titel")} · ${gefunden}`;
    };

    function fehlerText(error: unknown): string {
        if (error instanceof ApiFailure && error.status === 403) return t("editorListe.fehler.recht");
        return t("editorListe.fehler");
    }

    function ladeListe(): void {
        laden?.abort();
        const steuer = new AbortController();
        laden = steuer;
        ladeFehler.value = undefined;
        ladeLandschaften(steuer.signal, fetcher).then(
            (geladen) => {
                if (laden === steuer) liste.value = geladen;
            },
            (error: unknown) => {
                if (laden === steuer && !steuer.signal.aborted) ladeFehler.value = fehlerText(error);
            },
        );
    }

    // --- Je Landschaft eine Bearbeitung, solange ein Fenster sie trägt ---
    function neueBearbeitung(id: string, titel: string): LandschaftBearbeitung {
        const art = createLandschaftArt((eingabe, init) => fetcher(String(eingabe), init));
        const bearbeitung = createBearbeitung(art, {
            id,
            titel,
            sperre: entwurf?.sperre ?? OHNE_SPERRE,
            // Geschrieben: Kacheln und Liste neu (sonst stünden Name, Ebene und Art dort alt; die Liste fragt mit ETag nach).
            karte: {
                geaendert: (revision) => {
                    entwurf?.geaendert(revision);
                    ladeListe();
                },
            },
            speicher: entwurf?.speicher,
        });
        return Object.assign(bearbeitung, { art });
    }
    /** Je Bearbeitung ihr Verlauf (D3); entsteht und geht mit ihr. */
    const verlaeufe = new Map<string, Verlauf<unknown>>();
    const stopBearbeitungen = watch(
        () =>
            fenster.value
                .map((eintrag) => eintrag.gegenstand)
                // Ein Gipfel hat seine eigene Bearbeitung, ein Kandidat des WikiSync (WI-0271 L7) keine: Er ist nur eine Zeile mit „Auf der Karte setzen“.
                .filter(
                    (id): id is string =>
                        id !== undefined &&
                        gipfelVon(id) === undefined &&
                        kandidatVon(id) === undefined &&
                        wikiEintragVon(id) === undefined,
                ),
        (ids) => {
            const jetzt = bearbeitungen.value;
            const neu = new Map<string, LandschaftBearbeitung>();
            for (const id of ids) {
                const da = jetzt.get(id);
                if (da !== undefined) {
                    neu.set(id, da);
                    continue;
                }
                const bearbeitung = neueBearbeitung(id, titelVon(id));
                neu.set(id, bearbeitung);
                verlaeufe.set(
                    id,
                    createVerlauf(createLandschaftVerlaufsArt(), {
                        id,
                        bearbeitung,
                        zurueckgenommen(revision) {
                            (entwurf?.gipfelGeaendert ?? entwurf?.geaendert)?.(revision);
                            ladeListe();
                        },
                        fetcher: (eingabe, init) => fetcher(String(eingabe), init),
                    }) as Verlauf<unknown>,
                );
            }
            for (const [id, alt] of jetzt)
                if (!neu.has(id)) {
                    alt.destroy();
                    verlaeufe.get(id)?.destroy();
                    verlaeufe.delete(id);
                }
            bearbeitungen.value = neu;
        },
        // Sofort: Wer ein Fenster öffnet, findet seine Bearbeitung gleich danach (Handgriffe, „Ecken bearbeiten“).
        { immediate: true, flush: "sync" },
    );
    // Was ungespeichert ist, sagt das Fenster der Ablage (Schließen legt es dann ab, statt es zu verwerfen).
    const stopUngespeichert = watch(
        () =>
            fenster.value.map((eintrag) => {
                const lage =
                    eintrag.gegenstand === undefined
                        ? undefined
                        : (
                              bearbeitungen.value.get(eintrag.gegenstand) ??
                              gipfelBearbeitungen.value.get(eintrag.gegenstand)
                          )?.lage.value;
                return [eintrag.id, lage !== undefined && lage.aktiv && lage.ungespeichert > 0] as const;
            }),
        (paare) => {
            for (const [id, ja] of paare) {
                const eintrag = fenster.value.find((x) => x.id === id);
                if (eintrag !== undefined && eintrag.ungespeichert !== ja)
                    werkzeugfenster.markiere(id, { ungespeichert: ja });
            }
        },
    );
    // Der Ebenenwechsel im Entwurf stellt die Karte auf die neue Ebene (T50). Bis „Fertig“ steht die Fläche aber in ihrer alten: Geht
    // das Fenster vorher aus dem Bild (✕ legt es samt Entwurf ab, F1), kehrt die Karte in die gespeicherte Ebene zurück, wie beim
    // Verwerfen; holt man es wieder hervor, folgt sie wieder dem Entwurf (Fund des Betreibers 2026-10-18, „Tal am Donnerkessel“: „plötzlich
    // ist es weg und nicht wieder auffindbar“). Nur, wenn die Karte noch die Ebene zeigt, von der sie kommt.
    const ebenenVon = (
        gegenstand: string,
    ): { entwurf: EditorLandscapeLayer; gespeichert: EditorLandscapeLayer } | undefined => {
        const bearbeitung = bearbeitungen.value.get(gegenstand);
        const entwurfEbene = bearbeitung?.stand.value?.felder.ebene;
        const gespeichert = bearbeitung?.detail.value?.layer;
        return entwurfEbene === undefined || gespeichert === undefined || entwurfEbene === gespeichert
            ? undefined
            : { entwurf: entwurfEbene, gespeichert };
    };
    const stopEbene = watch(
        () =>
            fenster.value
                .filter((eintrag) => eintrag.lage !== "versenkt" && eintrag.gegenstand !== undefined)
                .map((eintrag) => eintrag.gegenstand!),
        (jetzt, vorher) => {
            const karte = entwurf?.ebene;
            if (karte === undefined) return;
            const neu = jetzt.filter((id) => !vorher.includes(id));
            // Tritt ein anderes Fenster an seine Stelle (D19), bestimmt dessen Fläche die Karte.
            if (neu.length === 0)
                for (const gegenstand of vorher.filter((id) => !jetzt.includes(id))) {
                    const ebenen = ebenenVon(gegenstand);
                    if (ebenen !== undefined && karte.zeigt(ebenen.entwurf)) karte.stelle(ebenen.gespeichert);
                }
            for (const gegenstand of neu) {
                const ebenen = ebenenVon(gegenstand);
                if (ebenen !== undefined && karte.zeigt(ebenen.gespeichert)) karte.stelle(ebenen.entwurf);
            }
        },
    );
    // Ein sichtbares Fenster braucht die Liste, auch eines, das „Offene Bearbeitungen“ nach dem Neuladen hervorholt (an der Steuerung
    // vorbei; Befund der Kraftlinien-Sitzung 2026-10-17). Es holt sie jedes Mal frisch, wenn es sichtbar wird: Die Ebenenleiste (T41 (2))
    // liest dieselbe Liste schon beim Laden der Seite, und ohne Neuladen zeigte ein später geöffnetes Fenster deren alten Stand.
    const stopListe = watch(
        () => fenster.value.some((eintrag) => eintrag.lage !== "versenkt"),
        (sichtbar) => {
            if (sichtbar) ladeListe();
        },
    );
    // Fenster, die vor der Liste aufgingen, bekommen ihren Titel, sobald die Liste da ist (für „Offene Bearbeitungen“).
    const stopTitel = watch(liste, () => {
        for (const eintrag of fenster.value)
            if (eintrag.gegenstand !== undefined)
                werkzeugfenster.markiere(eintrag.id, { titel: titelVon(eintrag.gegenstand) });
    });

    /** Öffnet eine Landschaft an der Stelle eines Fensters (D19), sonst in einem neuen. Gibt das Fenster zurück. */
    function oeffneAn(an: string | undefined, id: string | undefined): string {
        if (liste.value === undefined && laden === undefined) ladeListe();
        const wunsch = { werkzeug: LANDSCHAFTSEDITOR, gegenstand: id, titel: titelVon(id), nurLesen: nurLesen() };
        return an === undefined ? werkzeugfenster.oeffne(wunsch) : werkzeugfenster.oeffneAnStelle(an, wunsch);
    }

    /** Das Verb und die Karte: im vordersten Fenster, sonst in einem neuen; `vonKarte` öffnet ein neues nur mit den Eigenschaften. */
    function oeffneVorn(id: string | undefined, vonKarte: boolean): string {
        const vorn = vorderstes.value;
        if (vorn !== undefined && (id === undefined || vorn.gegenstand === id)) {
            werkzeugfenster.hervorholen(vorn.id);
            if (liste.value === undefined && laden === undefined) ladeListe();
            return vorn.id;
        }
        const fensterId = oeffneAn(vorn?.id, id);
        if (vonKarte && vorn === undefined) listenSchalter?.vorlaeufig(fensterId, true, LANDSCHAFTSEDITOR);
        return fensterId;
    }

    // Nach dem Neuladen: gesicherte Entwürfe als abgelegte Fenster (R1, D19).
    for (const eintrag of gesicherte(entwurf?.speicher).filter((x) => x.art === "landscape")) {
        if (fenster.value.some((x) => x.gegenstand === eintrag.id)) continue;
        const fensterId = werkzeugfenster.oeffne({
            werkzeug: LANDSCHAFTSEDITOR,
            gegenstand: eintrag.id,
            titel: eintrag.titel,
            nurLesen: nurLesen(),
        });
        werkzeugfenster.setzeLage(fensterId, "versenkt");
        werkzeugfenster.markiere(fensterId, { ungespeichert: true });
    }

    // Je Gipfel eine Bearbeitung, solange ein Fenster ihn trägt (P2); geschrieben wird `peak.update`, die Karte bekommt die Revision.
    // Dazu sein Verlauf (↺ an einem Entfernen, `gipfel-verlauf.ts`).
    const gipfelVerlaeufe = new Map<string, Verlauf<unknown>>();
    const stopGipfel = watch(
        () => fenster.value.map((eintrag) => eintrag.gegenstand).filter((id) => gipfelVon(id) !== undefined),
        (gegenstaende) => {
            const jetzt = gipfelBearbeitungen.value;
            const neu = new Map<string, GipfelBearbeitung>();
            for (const gegenstand of gegenstaende as string[]) {
                const da = jetzt.get(gegenstand);
                neu.set(
                    gegenstand,
                    da ??
                        createBearbeitung(createGipfelArt(gipfelDaten), {
                            id: gipfelVon(gegenstand)!,
                            titel: titelVon(gegenstand),
                            sperre: entwurf?.sperre ?? OHNE_SPERRE,
                            karte: {
                                geaendert: (revision) => {
                                    (entwurf?.gipfelGeaendert ?? entwurf?.geaendert)?.(revision);
                                    ladeListe();
                                },
                            },
                            speicher: entwurf?.speicher,
                        }),
                );
            }
            for (const [gegenstand, bearbeitung] of neu) {
                if (gipfelVerlaeufe.has(gegenstand)) continue;
                gipfelVerlaeufe.set(
                    gegenstand,
                    createVerlauf(createGipfelVerlaufsArt(), {
                        id: gipfelVon(gegenstand)!,
                        bearbeitung,
                        zurueckgenommen(revision) {
                            entwurf?.geaendert(revision);
                            ladeListe();
                        },
                        fetcher: (eingabe, init) => fetcher(String(eingabe), init),
                    }) as Verlauf<unknown>,
                );
            }
            for (const [gegenstand, alt] of jetzt)
                if (!neu.has(gegenstand)) {
                    alt.destroy();
                    gipfelVerlaeufe.get(gegenstand)?.destroy();
                    gipfelVerlaeufe.delete(gegenstand);
                }
            gipfelBearbeitungen.value = neu;
        },
        { immediate: true, flush: "sync" },
    );

    // Der Reiter „Änderungen“ hat Flächen oder Gipfel zurückgenommen (WI-0265 B6c2, wie `wegeditor-steuerung.ts` bei den Wegen): die Kacheln nachziehen, die Liste neu lesen, und jedes Fenster, das
    // eine berührte Fläche oder einen berührten Gipfel trägt, liest ihn samt Verlauf neu. Eine laufende Bearbeitung behält ihr Ungeschriebenes (`neuLesen` tut dort nichts).
    const stopLandschaftMeldung = watch(landschaftMeldung, (meldung) => {
        if (meldung === undefined) return;
        entwurf?.geaendert(meldung.mapRevision);
        if (liste.value !== undefined) ladeListe();
        const flaechen = new Set(meldung.flaechen);
        const gipfel = new Set(meldung.gipfel);
        for (const [id, bearbeitung] of bearbeitungen.value) {
            const d = bearbeitung.detail.value;
            // Die Quittung nennt je nach Rücknahme die Landschaft, ihre Teilflächen, Beschriftungen und Gebirgswerte oder die Gipfel im Gebirge: Jedes davon trifft das Fenster.
            const beruehrt =
                flaechen.has(id) ||
                (d?.areas.some((area) => flaechen.has(area.id)) ?? false) ||
                (d?.labels.some((label) => flaechen.has(label.id)) ?? false) ||
                (d?.peaks?.some((peak) => gipfel.has(peak.id)) ?? false);
            if (!beruehrt) continue;
            void bearbeitung.neuLesen();
            void verlaeufe.get(id)?.lade();
        }
        for (const [gegenstand, bearbeitung] of gipfelBearbeitungen.value) {
            const id = gipfelVon(gegenstand);
            if (id === undefined || !gipfel.has(id)) continue;
            void bearbeitung.neuLesen();
            void gipfelVerlaeufe.get(gegenstand)?.lade();
        }
    });

    /** „Gipfel entfernen …“ (Editor-Orchestrierung 2026-10-19), auch über `entferne` am Gegenstand `gipfel:<Kennung>`. */
    const entferneGipfelVon = async (gegenstand: string): Promise<{ ok: true } | { ok: false; satz: string }> => {
        const bearbeitung = gipfelBearbeitungen.value.get(gegenstand);
        const id = gipfelVon(gegenstand);
        const revision = bearbeitung?.detail.value?.revision;
        if (bearbeitung === undefined || id === undefined || revision === undefined)
            return { ok: false, satz: t("landschaftseditor.detailLaedt") };
        const antwort = await gipfelDaten.entferne(id, {
            operationId: globalThis.crypto.randomUUID(),
            baseRevision: revision,
        });
        if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
        entwurf?.geaendert(antwort.quittung.mapRevision);
        await bearbeitung.neuLesen();
        void gipfelVerlaeufe.get(gegenstand)?.lade();
        ladeListe();
        return { ok: true };
    };

    const aktiv = computed((): LandschaftBearbeitung | GipfelBearbeitung | undefined => {
        const id = vorderstes.value?.gegenstand;
        const bearbeitung =
            id === undefined ? undefined : (bearbeitungen.value.get(id) ?? gipfelBearbeitungen.value.get(id));
        return bearbeitung?.lage.value.aktiv === true ? bearbeitung : undefined;
    });

    return {
        liste,
        ladeFehler,
        listenEinstellung,
        auswahl,
        aktiv,
        esc: () => aktiv.value?.esc() ?? false,
        taste(event) {
            const bearbeitung = aktiv.value;
            const welche = bearbeitung === undefined ? undefined : entwurfsTaste(event);
            if (bearbeitung === undefined || welche === undefined) return false;
            if (welche === "wieder") bearbeitung.wieder();
            else bearbeitung.zurueck();
            return true;
        },
        fenster,
        reiterWunsch,
        bearbeitungVon: (id) => (id === undefined ? undefined : bearbeitungen.value.get(id)),
        waehle(id, fensterId) {
            const an = fensterId ?? vorderstes.value?.id;
            const eintrag = fenster.value.find((x) => x.id === an);
            if (eintrag !== undefined && eintrag.gegenstand === id) return;
            oeffneAn(an, id);
        },
        oeffneWerkzeug: () => void oeffneVorn(undefined, false),
        oeffneFuer(id, reiter) {
            const fensterId = oeffneVorn(id, true);
            if (reiter !== undefined) reiterWunsch.value = { reiter, mal: (reiterWunsch.value?.mal ?? 0) + 1 };
            return fensterId;
        },
        geoeffnet(subjekt, options, editorModus) {
            if (!editorModus || options.source !== "map" || options.still === true) return false;
            // Ein Gipfel öffnet sich im selben Fenster wie eine Fläche (P2, T55).
            if (subjekt.kind === "peak") {
                oeffneVorn(gipfelGegenstand(subjekt.id), true);
                return true;
            }
            if (subjekt.kind !== "area") return false;
            oeffneVorn(subjekt.id, true);
            return true;
        },
        ladeListe,
        entfernenWunsch,
        kopierenWunsch,
        nameWunsch,
        gipfelBearbeitungVon: (gegenstand) =>
            gegenstand === undefined ? undefined : gipfelBearbeitungen.value.get(gegenstand),
        oeffneGipfel(id, name) {
            const fensterId = oeffneVorn(gipfelGegenstand(id), true);
            if (name !== undefined)
                werkzeugfenster.markiere(fensterId, { titel: titelVon(gipfelGegenstand(id), name) });
            reiterWunsch.value = { reiter: "eigenschaften", mal: (reiterWunsch.value?.mal ?? 0) + 1 };
            return fensterId;
        },
        angelegt(neu) {
            ladeListe();
            oeffneVorn(neu.publicId, true);
            reiterWunsch.value = { reiter: "eigenschaften", mal: (reiterWunsch.value?.mal ?? 0) + 1 };
            nameWunsch.value = { id: neu.publicId, mal: (nameWunsch.value?.mal ?? 0) + 1 };
        },
        gipfelGesetzt(neu) {
            ladeListe();
            const gegenstand = gipfelGegenstand(neu.publicId);
            const fensterId = oeffneVorn(gegenstand, true);
            werkzeugfenster.markiere(fensterId, { titel: titelVon(gegenstand, neu.name) });
            nameWunsch.value = { id: gegenstand, mal: (nameWunsch.value?.mal ?? 0) + 1 };
        },
        oeffneEntfernen(id) {
            oeffneVorn(id, true);
            reiterWunsch.value = { reiter: "eigenschaften", mal: (reiterWunsch.value?.mal ?? 0) + 1 };
            entfernenWunsch.value = { id, mal: (entfernenWunsch.value?.mal ?? 0) + 1 };
        },
        kopierenGesehen() {
            kopierenWunsch.value = undefined;
        },
        oeffneKopieren(id, areaId) {
            oeffneVorn(id, true);
            reiterWunsch.value = { reiter: "eigenschaften", mal: (reiterWunsch.value?.mal ?? 0) + 1 };
            kopierenWunsch.value = { id, areaId, mal: (kopierenWunsch.value?.mal ?? 0) + 1 };
        },
        async kopiere(id, areaId, ziel) {
            const bearbeitung = bearbeitungen.value.get(id);
            const quelle = bearbeitung?.detail.value;
            const revision = quelle?.areas.find((area) => area.id === areaId)?.revision;
            if (bearbeitung === undefined || quelle === undefined || revision === undefined)
                return { ok: false, satz: t("landschaftseditor.detailLaedt") };
            const antwort = await sende<LandscapeCopyReceipt>(
                editorLandscapeCopyUrl(id),
                {
                    operationId: globalThis.crypto.randomUUID(),
                    areaId,
                    baseRevision: revision,
                    ...ziel,
                } satisfies LandscapeCopyBody,
                "POST",
                (eingabe, init) => fetcher(String(eingabe), init),
            );
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            entwurf?.geaendert(antwort.quittung.mapRevision);
            await bearbeitung.neuLesen();
            const zielId = antwort.quittung.publicId;
            if (zielId !== undefined && zielId !== id) await bearbeitungen.value.get(zielId)?.neuLesen();
            ladeListe();
            const karte = entwurf?.ebene;
            if (karte !== undefined && ziel.layer !== quelle.layer && karte.zeigt(quelle.layer))
                karte.stelle(ziel.layer);
            if (zielId !== undefined) oeffneVorn(zielId, true);
            return { ok: true, quittung: antwort.quittung };
        },
        async entferneAlle(ids, stage) {
            const gipfel = ids.flatMap((id) => gipfelVon(id) ?? []);
            const antwort = await sende(
                editorLandscapesBatchRetireUrl,
                {
                    operationId: globalThis.crypto.randomUUID(),
                    ids: ids.filter((id) => gipfelVon(id) === undefined),
                    ...(gipfel.length > 0 ? { peaks: gipfel } : {}),
                    stage,
                } satisfies LandscapeBatchRetireBody,
                "POST",
                (eingabe, init) => fetcher(String(eingabe), init),
            );
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            entwurf?.geaendert(antwort.quittung.mapRevision);
            await Promise.all(
                ids.map((id) => (bearbeitungen.value.get(id) ?? gipfelBearbeitungen.value.get(id))?.neuLesen()),
            );
            ladeListe();
            return { ok: true };
        },
        async entferne(id, stage) {
            if (gipfelVon(id) !== undefined) return entferneGipfelVon(id);
            const bearbeitung = bearbeitungen.value.get(id);
            const revision = bearbeitung?.detail.value?.revision;
            if (bearbeitung === undefined || revision === undefined)
                return { ok: false, satz: t("landschaftseditor.detailLaedt") };
            const antwort = await sende(
                editorLandscapeRetireUrl(id),
                {
                    operationId: globalThis.crypto.randomUUID(),
                    baseRevision: revision,
                    stage,
                } satisfies LandscapeRetireBody,
                "POST",
                (eingabe, init) => fetcher(String(eingabe), init),
            );
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            entwurf?.geaendert(antwort.quittung.mapRevision);
            await bearbeitung.neuLesen();
            ladeListe();
            return { ok: true };
        },
        async verberge(id, ja) {
            const art = createLandschaftArt((eingabe, init) => fetcher(String(eingabe), init));
            const detail = await art.lade(id, new AbortController().signal).catch(() => null);
            if (detail === null) return { ok: false, satz: t("entwurf.lesefehler") };
            const antwort = await sende(
                editorLandscapeUrl(id),
                {
                    operationId: globalThis.crypto.randomUUID(),
                    baseRevision: detail.revision,
                    changes: { hidden: ja },
                } satisfies LandscapeUpdateBody,
                "PATCH",
                (eingabe, init) => fetcher(String(eingabe), init),
            );
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            entwurf?.geaendert(antwort.quittung.mapRevision);
            await bearbeitungen.value.get(id)?.neuLesen();
            ladeListe();
            const neu = antwort.quittung.affected.find((objekt) => objekt.kind === "region" && objekt.id === id);
            return { ok: true, name: detail.name, revision: neu?.revision ?? detail.revision + 1 };
        },
        aendere(id, neu) {
            oeffneVorn(id, true);
            reiterWunsch.value = { reiter: "eigenschaften", mal: (reiterWunsch.value?.mal ?? 0) + 1 };
            const bearbeitung = bearbeitungen.value.get(id);
            if (bearbeitung === undefined) return;
            if (bearbeitung.stand.value !== undefined) return bearbeitung.feld(neu);
            const stop = watch(
                () => bearbeitung.stand.value,
                (stand) => {
                    if (stand === undefined) return;
                    stop();
                    bearbeitung.feld(neu);
                },
            );
        },
        verlaufVon: (id) =>
            id === undefined
                ? undefined
                : bearbeitungen.value.has(id)
                  ? verlaeufe.get(id)
                  : gipfelBearbeitungen.value.has(id)
                    ? gipfelVerlaeufe.get(id)
                    : undefined,
        entferneGipfel: entferneGipfelVon,
        destroy() {
            laden?.abort();
            stopBearbeitungen();
            stopGipfel();
            stopUngespeichert();
            stopEbene();
            stopLandschaftMeldung();
            for (const verlauf of verlaeufe.values()) verlauf.destroy();
            for (const verlauf of gipfelVerlaeufe.values()) verlauf.destroy();
            stopListe();
            stopTitel();
            for (const bearbeitung of bearbeitungen.value.values()) bearbeitung.destroy();
            for (const bearbeitung of gipfelBearbeitungen.value.values()) bearbeitung.destroy();
        },
        gipfelHoeheImGipfel(id) {
            const bearbeitung = gipfelBearbeitungen.value.get(gipfelGegenstand(id));
            const d = bearbeitung?.detail.value;
            const felder = bearbeitung?.stand.value?.felder;
            if (d === undefined || felder === undefined || felder.hoehe === d.height) return undefined;
            return t("landschaftseditor.gebirge.gipfel.imGipfel", { name: felder.name });
        },
        gipfelHoeheImGebirge(id) {
            for (const bearbeitung of bearbeitungen.value.values()) {
                const d = bearbeitung.detail.value;
                const hoehe = bearbeitung.stand.value?.felder.gipfelHoehen?.[id];
                const gipfel = d?.peaks?.find((p) => p.id === id);
                if (d !== undefined && gipfel !== undefined && hoehe !== undefined && hoehe !== gipfel.height)
                    return t("landschaftseditor.gebirge.gipfel.imGebirge", { name: d.name });
            }
            return undefined;
        },
    };
}
