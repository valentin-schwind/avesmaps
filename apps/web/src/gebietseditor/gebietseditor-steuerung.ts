import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    editorTerritoryHierarchyUrl,
    type EditorTerritoryDetail,
    type EditorTerritoryFindings,
    type EditorTerritoryHierarchy,
    type EditorTerritoryList,
    type GEBIETSEDITOR as GEBIETSEDITOR_REITER,
    type SubjectRef,
    editorTerritoryRestoreUrl,
    editorTerritoryRetireUrl,
    type TerritoryRetireBody,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, type Fetcher } from "../auth/api";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import { umschalteAufKarte } from "../editor-liste/mehrfachauswahl";
import type { AnStelle, WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { EditorSperre } from "../editor-sperre/sperre";
import { createBearbeitung, type Bearbeitung } from "../fenster/bearbeitung";
import { entwurfsTaste } from "../fenster/entwurf-kern";
import { gesicherte } from "../fenster/entwurf-sicherung";
import { createVerlauf, type Verlauf } from "../fenster/entwurf-verlauf";
import { sende } from "../fenster/entwurf-senden";
import type { ListenSchalter } from "../fenster/listen-schalter";
import { t } from "../i18n/i18n";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import type { FormStand } from "../map/geometrie/formentwurf";
import { ladeBefunde } from "./befunde";
import { createGebietArt, type GebietArt, type GebietFelder } from "./gebiet-art";
import { createGebietSammel, type GebietSammel } from "./gebiet-sammel";
import { gebietMeldung } from "./gebiet-melde";
import { createGebietVerlaufsArt } from "./gebiet-verlauf";
import { GEBIETE_OPTIONEN, ladeGebiete } from "./gebiete-liste";
import { traegtWurzel } from "./hierarchie";

/**
 * Was die Seite für den Gebietseditor hält (WI-0209 A3, B2; EDIT-0005 §3; EDIT-0003 T44; Muster
 * `landschaftseditor/landschaftseditor-steuerung.ts`): die Liste der Herrschaftsgebiete (einmal geladen, von allen Fenstern geteilt)
 * samt Suche, Filter und Befunden, die Daten des Reiters „Hierarchie“ und je Fenster EIN Gebiet mit seiner Bearbeitung
 * (`fenster/bearbeitung.ts`). `app.vue` hängt nur ein.
 *
 * - 🔴 **Je Gebiet ein Fenster** (T44, wie je Ort und Landschaft, EDIT-0001 D19): Ein Klick in der Liste öffnet das Gebiet an der
 *   Stelle dieses Fensters, das bisherige wandert mit seinem Entwurf nach „Offene Bearbeitungen“. Verb, Handgriffe und ein Klick auf die
 *   Karte öffnen an der Stelle des vordersten Gebietsfensters, sonst in einem neuen.
 * - **Eine Bearbeitung je Gebiet** (O3, B2): gelesener Stand, EIN Entwurf für Felder (und mit dem Andocken die Form), „Fertig“ als
 *   `territory.update`. Sie entsteht mit dem Fenster und geht mit ihm; ein Entwurf wird beim Schließen abgelegt, nie verworfen.
 * - **Nach dem Neuladen** stehen im Browser gesicherte Entwürfe als abgelegte Fenster unter „Offene Bearbeitungen“ (R1, D19).
 * - **Die Hierarchie** lädt erst, wenn der Reiter sie braucht; die Daten eines Gebiets tragen jeden Nachfahren als Wurzel mit
 *   (`traegtWurzel`). **Befunde** („Prüfen“, D6) laden mit der Liste.
 * - **Mehrfachauswahl** (EDIT-0003 T57, Fassung 5): Umschalter und Häkchen der Liste gelten für alle Gebietsfenster, wie Suche und
 *   Filter. Ab zwei angehakten (ohne gelöschte) steht EIN Entwurf für alle (`gebiet-sammel.ts`); ein Wechsel der Häkchen beginnt einen
 *   neuen. Bleibt genau eins angehakt, steht es im vordersten Fenster wie nach einem Klick; das bisherige geht dabei ohne Entwurf zu,
 *   statt abgelegt zu werden (`alsMehrfachauswahl`, ebenso nach „Unter neues Obergebiet …“, dem Zurückholen und dem Löschen).
 * - **Von der Karte** (A4, T34 (1)): Ein Handgriff an einem Gebiet oder ein Klick im Editor-Modus öffnet das Fenster an ihm. Öffnet die
 *   Karte das Fenster erst, steht es nur mit den Eigenschaften (Variante A, `listen-schalter.ts`). Liegen mehrere übereinander, kommt
 *   zuerst die Liste „Hier liegen N …“ (T25), und erst die Wahl öffnet.
 */
export const GEBIETSEDITOR = "gebietseditor";

/** Was die Mehrfachauswahl nach einer Antwort des Servers öffnet: außerhalb des Handgriffs (`alsMehrfachauswahl`), also ausdrücklich. */
const AUS_DER_MEHRFACHAUSWAHL: AnStelle = { ohneEntwurfSchliessen: true };

/** Ein Reiter des Fensters (`GEBIETSEDITOR` in `packages/shared`). */
export type GebietReiter = (typeof GEBIETSEDITOR_REITER)["eintraege"][number]["id"];

export type GebietBearbeitung = Bearbeitung<EditorTerritoryDetail, GebietFelder, FormStand> & {
    readonly art: GebietArt;
    /** Der Verlauf des Gebiets (D5, gemeinsamer Verlauf); entsteht und geht mit der Bearbeitung. */
    readonly verlauf: Verlauf<unknown>;
};

/** Was das Schreiben braucht; ohne bleibt der Editor lesend (Tests, Besucher). */
export interface GebietEntwurfOptionen {
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust">;
    /** Geschrieben: die Kachelrevision an die Karte; `gebiet`, wenn es um EIN Gebiet ging (das Infopanel liest es neu). */
    geaendert(revision: number | undefined, gebiet?: string): void;
    readonly speicher?: Storage | undefined;
    /** Darf diese Sitzung Gebiete schreiben (Recht und `MAP_EDITING`)? */
    darfSchreiben(): boolean;
}

/** Die Mehrfachauswahl der Liste (T57): für alle Gebietsfenster dieselbe. */
export interface GebietMehrfachauswahl {
    readonly an: Readonly<Ref<boolean>>;
    readonly angehakt: Readonly<Ref<readonly string[]>>;
    /** Die zuletzt angeklickte Zeile (Anker für Umschalt-Klick), solange die Mehrfachauswahl an ist. */
    readonly anker: Readonly<Ref<string | undefined>>;
    /** Der Entwurf für die angehakten Gebiete, ab zwei (ohne gelöschte). */
    readonly entwurf: Readonly<ShallowRef<GebietSammel | undefined>>;
    setzeAn(an: boolean): void;
    setzeAngehakt(ids: readonly string[]): void;
    /** Umschalt-Klick auf der Karte: aufnehmen oder herausnehmen, aus eingeschaltet mit dem gewählten Gebiet als erstem. */
    umschalten(id: string): void;
    setzeAnker(id: string | undefined): void;
    /**
     * Nach „Unter neues Obergebiet …“ (Blatt „Mehrfachauswahl“, Bild 8): „… angelegt; n Gebiete hängen darunter. Auf der Karte nach der
     * Ableitung.“ am neuen Gebiet, bis ein anderes gewählt wird; `zurueckholen` nimmt die Operation zurück (`territory.restore`).
     */
    readonly meldung: Readonly<ShallowRef<ObergebietMeldung | undefined>>;
    zurueckholen(): Promise<{ ok: true } | { ok: false; satz: string }>;
}

/** Die Meldung nach „Unter neues Obergebiet …“: das neue Gebiet, wie viele darunter hängen, und die Operation für ↺. */
export interface ObergebietMeldung {
    readonly id: string;
    readonly name: string;
    readonly anzahl: number;
    readonly operationId: string;
    /** Das erste der gewählten: Nach ↺ steht es im Fenster. */
    readonly erstes: string;
}

export interface GebietseditorSteuerung {
    readonly liste: Readonly<ShallowRef<EditorTerritoryList | undefined>>;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    readonly listenEinstellung: ListenEinstellung;
    /** Das Gebiet des vordersten Gebietsfensters. */
    readonly auswahl: ComputedRef<string | undefined>;
    /** Die Daten des Reiters „Hierarchie“; sie tragen das verlangte Gebiet als Wurzel, sobald sie geladen sind. */
    readonly hierarchie: Readonly<ShallowRef<EditorTerritoryHierarchy | undefined>>;
    readonly hierarchieFehler: Readonly<Ref<string | undefined>>;
    /** „Prüfen“ (D6): die Befunde aller Gebiete, mit der Liste geladen; ohne Verbindung keine (nie eine Sperre). */
    readonly befunde: Readonly<ShallowRef<EditorTerritoryFindings | undefined>>;
    /** Die offenen Fenster dieses Werkzeugs, das vorderste zuletzt. */
    readonly fenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Bearbeitung eines Gebiets, solange ein Fenster es trägt. */
    bearbeitungVon(id: string | undefined): GebietBearbeitung | undefined;
    /** Die Bearbeitung des vordersten sichtbaren Gebietsfensters, wenn dort gerade bearbeitet wird (Leiste, Tasten, Esc). */
    readonly aktiv: ComputedRef<GebietBearbeitung | undefined>;
    readonly mehrfachauswahl: GebietMehrfachauswahl;
    /** Der Entwurf der Mehrfachauswahl, wenn in ihm etwas geändert ist (Leiste, Tasten, Esc); er geht der Bearbeitung vor. */
    readonly sammelAktiv: ComputedRef<GebietSammel | undefined>;
    /** Esc für die laufende Bearbeitung (R2): fragt bei Ungeschriebenem, sonst endet sie. `true`, wenn sie die Taste nahm. */
    esc(): boolean;
    /** Strg+Z und Strg+Y (Mac ⌘) für die laufende Bearbeitung, nie im Textfeld. `true`, wenn sie die Taste nahm. */
    taste(event: KeyboardEvent): boolean;
    /**
     * Ein Klick in der Liste, in „Untergebiete“ oder „Hierarchie“ eines Fensters (ohne Fenster: im vordersten): das Gebiet an dessen
     * Stelle (D19). `reiter`: das neue Fenster steht am selben Reiter wie das alte (`reiterWunsch`).
     */
    waehle(id: string | undefined, fensterId?: string, reiter?: GebietReiter): void;
    /** Mit welchem Reiter ein Gebiet zuletzt verlangt wurde (`waehle`); das Fenster an ihm übernimmt ihn beim Aufgehen. */
    readonly reiterWunsch: Readonly<
        ShallowRef<{ readonly gegenstand: string; readonly reiter: GebietReiter } | undefined>
    >;
    /** Das Verb „Herrschaftsgebiete bearbeiten“: holt das vorderste Fenster hervor oder öffnet eins. */
    oeffneWerkzeug(): void;
    /** Ein Handgriff an der Karte (A4): das Fenster an diesem Gebiet. Gibt das Fenster zurück. */
    oeffneFuer(id: string): string;
    /**
     * Ein Objekt der Karte wurde geöffnet: Im Editor-Modus und ohne laufenden Modus öffnet ein Gebiet das Fenster an sich, auch wenn es zu
     * war. `true`, wenn es das Gebiet nahm.
     */
    geoeffnet(ref: SubjectRef, options: OpenSubjectOptions, editorModus: boolean): boolean;
    /** Der Reiter „Hierarchie“ eines Fensters ist zu sehen: lädt, was dieses Gebiet als Wurzel braucht. */
    hierarchieGebraucht(id: string | undefined): void;
    /** Nach einer eigenen Änderung (D2 „Fertig“): Liste, Befunde, Hierarchie und die ruhenden Bearbeitungen neu lesen. */
    neuLaden(): void;
    /**
     * Das Wappen eines Gebiets hat sich geändert (der Wappen-Kasten der Medienverwaltung schreibt selbst, ohne Entwurf): Liste, Detail
     * und Infopanel lesen neu, damit das neue Wappen sofort überall steht. Eine laufende Bearbeitung behält ihren gelesenen Stand.
     */
    wappenGeaendert(id: string): void;
    /**
     * „Entfernen“ (D3, `territory.retire`): sofort geschrieben, ohne Entwurf; danach liest der Editor neu und die Karte folgt. Gibt den
     * Satz des Servers zurück, wenn er ablehnte.
     */
    entferne(
        id: string,
        stage: TerritoryRetireBody["stage"],
        children: TerritoryRetireBody["children"],
    ): Promise<{ ok: true } | { ok: false; satz: string }>;
    ladeListe(): void;
    destroy(): void;
}

/** Eine Bearbeitung, die nur liest (ohne Entwurfsoptionen): Sperre und Karte tun nichts. */
const OHNE_SPERRE: GebietEntwurfOptionen["sperre"] = {
    nimm: async () => ({ art: "fehler", fehler: new ApiFailure(423, "map_editing_off", "") }),
    gib: () => undefined,
    beiVerlust: () => () => undefined,
};

export function createGebietseditorSteuerung(
    werkzeugfenster: Werkzeugfenster,
    fetcher: Fetcher = (url, init) => fetch(url, init),
    /** Der gemeinsame Schalter der Listen: Von der Karte geöffnet, steht das Fenster mit eingeklappter Liste (EDIT-0003, Variante A). */
    listenSchalter?: Pick<ListenSchalter, "vorlaeufig">,
    entwurf?: GebietEntwurfOptionen,
): GebietseditorSteuerung {
    const liste = shallowRef<EditorTerritoryList | undefined>(undefined);
    const ladeFehler = ref<string | undefined>(undefined);
    const hierarchie = shallowRef<EditorTerritoryHierarchy | undefined>(undefined);
    const hierarchieFehler = ref<string | undefined>(undefined);
    let hierarchieFehlerVon: string | undefined;
    const befunde = shallowRef<EditorTerritoryFindings | undefined>(undefined);
    const listenEinstellung = createListenEinstellung({
        vorbelegt: GEBIETE_OPTIONEN.vorbelegt,
        sortierung: "reihenfolge",
        maske: "",
    });
    let laden: AbortController | undefined;
    let befundeLaden: AbortController | undefined;
    let hierarchieLaden: { steuer: AbortController; id: string } | undefined;
    const bearbeitungen = shallowRef(new Map<string, GebietBearbeitung>());
    const reiterWunsch = shallowRef<{ gegenstand: string; reiter: GebietReiter } | undefined>(undefined);
    const nurLesen = (): boolean => entwurf?.darfSchreiben() !== true;

    const fenster = computed(() =>
        werkzeugfenster.stand.value.fenster
            .filter((eintrag) => eintrag.werkzeug === GEBIETSEDITOR)
            .sort((a, b) => a.vorn - b.vorn),
    );
    /** Das vorderste sichtbare Gebietsfenster: Dort öffnen Verb, Handgriffe und Karte (D19). */
    const vorderstes = computed(() => fenster.value.filter((eintrag) => eintrag.lage !== "versenkt").at(-1));
    const auswahl = computed(() => vorderstes.value?.gegenstand);

    const titelVon = (id: string | undefined): string => {
        const gefunden = liste.value?.rows.find((row) => row.id === id)?.name;
        return gefunden === undefined ? t("gebietseditor.titel") : `${t("gebietseditor.titel")} · ${gefunden}`;
    };

    function fehlerText(error: unknown): string {
        if (error instanceof ApiFailure && error.status === 403) return t("editorListe.fehler.recht");
        return t("editorListe.fehler");
    }

    /** Die Befunde neben der Liste; ein Fehler lässt den alten Stand stehen (Prüfen meldet nur). */
    function ladeAlleBefunde(): void {
        befundeLaden?.abort();
        const steuer = new AbortController();
        befundeLaden = steuer;
        ladeBefunde(steuer.signal, fetcher).then(
            (geladen) => {
                if (befundeLaden === steuer) befunde.value = geladen;
            },
            () => undefined,
        );
    }

    function ladeListe(): void {
        ladeAlleBefunde();
        laden?.abort();
        const steuer = new AbortController();
        laden = steuer;
        ladeFehler.value = undefined;
        ladeGebiete(steuer.signal, fetcher).then(
            (geladen) => {
                if (laden === steuer) liste.value = geladen;
            },
            (error: unknown) => {
                if (laden === steuer && !steuer.signal.aborted) ladeFehler.value = fehlerText(error);
            },
        );
    }

    /** `erzwinge`: auch wenn die Daten das Gebiet schon tragen (nach einer Änderung); die alten bleiben bis dahin stehen. */
    function hierarchieGebraucht(id: string | undefined, erzwinge = false): void {
        if (id === undefined) return;
        // Ein Fehler gehört zu dem Gebiet, für das er kam (Fund 2026-10-19: nach einem gelöschten Gebiet blieb „Die Liste konnte nicht
        // geladen werden.“ auch am nächsten stehen): Ein anderes Gebiet liest neu.
        if (hierarchieFehler.value !== undefined && hierarchieFehlerVon !== id) {
            hierarchieFehler.value = undefined;
            erzwinge = true;
        }
        if (!erzwinge && hierarchie.value !== undefined && traegtWurzel(hierarchie.value, id)) return;
        if (!erzwinge && hierarchieLaden?.id === id) return;
        hierarchieLaden?.steuer.abort();
        const steuer = new AbortController();
        hierarchieLaden = { steuer, id };
        hierarchieFehler.value = undefined;
        // `no-cache` wie die Liste: Ein unveränderter Teilbaum kommt als 304 aus dem Cache des Browsers.
        getJson<EditorTerritoryHierarchy>(editorTerritoryHierarchyUrl(id), (url, init) =>
            fetcher(url, { ...init, cache: "no-cache", signal: steuer.signal }),
        ).then(
            (geladen) => {
                if (hierarchieLaden?.steuer !== steuer) return;
                hierarchieLaden = undefined;
                hierarchie.value = geladen;
            },
            (error: unknown) => {
                if (hierarchieLaden?.steuer !== steuer || steuer.signal.aborted) return;
                hierarchieLaden = undefined;
                hierarchieFehlerVon = id;
                hierarchieFehler.value = fehlerText(error);
            },
        );
    }

    // --- Je Gebiet eine Bearbeitung, solange ein Fenster es trägt ---
    function neueBearbeitung(id: string): GebietBearbeitung {
        const art = createGebietArt((eingabe, init) => fetcher(String(eingabe), init));
        const bearbeitung = createBearbeitung(art, {
            id,
            titel: titelVon(id),
            sperre: entwurf?.sperre ?? OHNE_SPERRE,
            karte: {
                geaendert: (revision) => {
                    entwurf?.geaendert(revision, id);
                    // Name, Hauptstadt und Befunde stehen auch in Liste und Prüfen; ein Umhängen ändert auch das Obergebiet und seine
                    // Untergebiete (Fund 2026-10-19: „Untergebiete (0)“ am Obergebiet bis zum nächsten Speichern).
                    ladeListe();
                    ruhendeNeuLesen(id);
                },
            },
            speicher: entwurf?.speicher,
        });
        const verlauf = createVerlauf(createGebietVerlaufsArt(), {
            id,
            bearbeitung,
            zurueckgenommen(revision) {
                entwurf?.geaendert(revision, id);
                ladeListe();
                ruhendeNeuLesen(id);
            },
            fetcher: (eingabe, init) => fetcher(String(eingabe), init),
        }) as Verlauf<unknown>;
        const ende = bearbeitung.destroy;
        return Object.assign(bearbeitung, {
            art,
            verlauf,
            destroy(): void {
                verlauf.destroy();
                ende();
            },
        });
    }
    const stopBearbeitungen = watch(
        () => fenster.value.map((eintrag) => eintrag.gegenstand).filter((id): id is string => id !== undefined),
        (ids) => {
            const jetzt = bearbeitungen.value;
            const neu = new Map<string, GebietBearbeitung>();
            for (const id of ids) neu.set(id, jetzt.get(id) ?? neueBearbeitung(id));
            for (const [id, alt] of jetzt) if (!neu.has(id)) alt.destroy();
            bearbeitungen.value = neu;
        },
        // Sofort: Wer ein Fenster öffnet, findet seine Bearbeitung gleich danach (Handgriffe, „Grenzen bearbeiten“).
        { immediate: true, flush: "sync" },
    );
    // Was ungespeichert ist, sagt das Fenster der Ablage (Schließen legt es dann ab, statt es zu verwerfen).
    const stopUngespeichert = watch(
        () =>
            fenster.value.map((eintrag) => {
                const lage =
                    eintrag.gegenstand === undefined
                        ? undefined
                        : bearbeitungen.value.get(eintrag.gegenstand)?.lage.value;
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
    // Fenster, die vor der Liste aufgingen, bekommen ihren Titel, sobald die Liste da ist (für „Offene Bearbeitungen“).
    const stopTitel = watch(liste, () => {
        for (const eintrag of fenster.value)
            if (eintrag.gegenstand !== undefined)
                werkzeugfenster.markiere(eintrag.id, { titel: titelVon(eintrag.gegenstand) });
    });

    /** Öffnet ein Gebiet an der Stelle eines Fensters (D19), sonst in einem neuen. Gibt das Fenster zurück. */
    function oeffneAn(an: string | undefined, id: string | undefined, optionen?: AnStelle): string {
        if (liste.value === undefined && laden === undefined) ladeListe();
        const wunsch = { werkzeug: GEBIETSEDITOR, gegenstand: id, titel: titelVon(id), nurLesen: nurLesen() };
        return an === undefined ? werkzeugfenster.oeffne(wunsch) : werkzeugfenster.oeffneAnStelle(an, wunsch, optionen);
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
        if (vonKarte && vorn === undefined) listenSchalter?.vorlaeufig(fensterId, true, GEBIETSEDITOR);
        return fensterId;
    }

    // Nach dem Neuladen: gesicherte Entwürfe als abgelegte Fenster (R1, D19).
    for (const eintrag of gesicherte(entwurf?.speicher).filter((x) => x.art === "territory")) {
        if (fenster.value.some((x) => x.gegenstand === eintrag.id)) continue;
        const fensterId = werkzeugfenster.oeffne({
            werkzeug: GEBIETSEDITOR,
            gegenstand: eintrag.id,
            titel: eintrag.titel,
            nurLesen: nurLesen(),
        });
        werkzeugfenster.setzeLage(fensterId, "versenkt");
        werkzeugfenster.markiere(fensterId, { ungespeichert: true });
    }

    /** Nach einer eigenen Änderung: Liste, Befunde, Hierarchie und die ruhenden Bearbeitungen neu lesen. */
    function neuLaden(): void {
        ladeListe();
        hierarchieGebraucht(auswahl.value, true);
        ruhendeNeuLesen();
    }

    /**
     * Ruhende Bearbeitungen lesen neu (eine Zoomspanne steht auch in den Eigenschaften, ein umgehängtes Kind in denen seines Obergebiets);
     * eine laufende behält ihren Entwurf und erfährt eine fremde Änderung beim Schreiben als Konflikt. `ausser`: die Bearbeitung, die
     * gerade selbst schrieb oder zurücknahm; sie liest ohnehin neu und trägt ihren Verlauf.
     */
    function ruhendeNeuLesen(ausser?: string): void {
        const neu = new Map(bearbeitungen.value);
        let geaendert = false;
        for (const [id, alt] of neu)
            if (id !== ausser && !alt.lage.value.aktiv) {
                alt.destroy();
                neu.set(id, neueBearbeitung(id));
                geaendert = true;
            }
        if (geaendert) bearbeitungen.value = neu;
    }

    // --- Die Mehrfachauswahl (T57) ---
    const mehrfachAn = ref(false);
    const angehakt = ref<readonly string[]>([]);
    const anker = ref<string | undefined>(undefined);
    const sammel = shallowRef<GebietSammel | undefined>(undefined);
    const sammelIds = computed(() => {
        if (!mehrfachAn.value) return [];
        const zeilen = new Map((liste.value?.rows ?? []).map((row) => [row.id, row]));
        return angehakt.value.filter((id) => zeilen.has(id) && zeilen.get(id)!.deleted !== true);
    });
    const stopSammel = watch(
        () => sammelIds.value.join(","),
        () => {
            const ids = sammelIds.value;
            sammel.value?.destroy();
            sammel.value =
                ids.length < 2
                    ? undefined
                    : createGebietSammel(ids, fetcher, {
                          geschrieben(quittung) {
                              entwurf?.geaendert(quittung.mapRevision);
                              neuLaden();
                          },
                          obergebiet(quittung) {
                              entwurf?.geaendert(quittung.mapRevision);
                              // Das neue Gebiet steht danach im vordersten Fenster, die Mehrfachauswahl ist aus: sein Name ist der nächste Handgriff.
                              mehrfachauswahl.setzeAn(false);
                              meldung.value = {
                                  id: quittung.publicId,
                                  name: quittung.name,
                                  anzahl: ids.length,
                                  operationId: quittung.operationId,
                                  erstes: ids[0]!,
                              };
                              const vorn = vorderstes.value;
                              if (vorn !== undefined) oeffneAn(vorn.id, quittung.publicId, AUS_DER_MEHRFACHAUSWAHL);
                              neuLaden();
                          },
                          entfernt(quittung, stage) {
                              entwurf?.geaendert(quittung.mapRevision);
                              // Ganz gelöscht: Sie gehen aus der Auswahl; ein Fenster an einem von ihnen bleibt mit der Liste offen,
                              // ohne Gebiet (sonst ginge nach dem Löschen vieler der ganze Editor zu).
                              if (stage === "retire") {
                                  for (const eintrag of fenster.value)
                                      if (eintrag.gegenstand !== undefined && ids.includes(eintrag.gegenstand))
                                          oeffneAn(eintrag.id, undefined, AUS_DER_MEHRFACHAUSWAHL);
                                  angehakt.value = [];
                              }
                              neuLaden();
                          },
                      });
            void sammel.value?.neuLesen();
        },
    );
    // Genau eins angehakt: Es steht im vordersten Fenster wie nach einem Klick (Fassung 5).
    const stopEinzeln = watch(
        () => (mehrfachAn.value && angehakt.value.length === 1 ? angehakt.value[0] : undefined),
        (id) => {
            const vorn = vorderstes.value;
            if (id !== undefined && vorn !== undefined && vorn.gegenstand !== id) oeffneAn(vorn.id, id);
        },
    );
    const meldung = shallowRef<ObergebietMeldung | undefined>(undefined);
    // Die Meldung gilt dem neuen Gebiet; wählt man ein anderes, geht sie.
    const stopMeldung = watch(
        () => vorderstes.value?.gegenstand,
        (id) => {
            if (meldung.value !== undefined && id !== meldung.value.id) meldung.value = undefined;
        },
    );
    const mehrfachauswahl: GebietMehrfachauswahl = {
        an: mehrfachAn,
        angehakt,
        anker,
        entwurf: sammel,
        setzeAn(an) {
            mehrfachAn.value = an;
            if (!an) {
                angehakt.value = [];
                anker.value = undefined;
            }
        },
        setzeAngehakt(ids) {
            angehakt.value = ids;
        },
        umschalten(id) {
            const neu = umschalteAufKarte(
                { an: mehrfachAn.value, angehakt: angehakt.value },
                vorderstes.value?.gegenstand,
                id,
            );
            angehakt.value = neu;
            anker.value = id;
            mehrfachAn.value = true;
        },
        setzeAnker(id) {
            anker.value = id;
        },
        meldung,
        async zurueckholen() {
            const m = meldung.value;
            if (m === undefined) return { ok: false, satz: "" };
            const antwort = await sende(
                editorTerritoryRestoreUrl(m.id),
                { operationId: globalThis.crypto.randomUUID(), reverts: m.operationId },
                "POST",
                (eingabe, init) => fetcher(String(eingabe), init),
            );
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            entwurf?.geaendert(antwort.quittung.mapRevision, m.id);
            meldung.value = undefined;
            const vorn = vorderstes.value;
            if (vorn !== undefined) oeffneAn(vorn.id, m.erstes, AUS_DER_MEHRFACHAUSWAHL);
            neuLaden();
            return { ok: true };
        },
    };
    const sammelAktiv = computed(() => (sammel.value?.lage.value.aktiv === true ? sammel.value : undefined));

    // Eine Rücknahme über den Server hat Gebiete berührt (WI-0265 B6h, wie `landschaftseditor-steuerung.ts` bei den Landschaften): die Kacheln und das Infopanel nachziehen, Liste und Hierarchie neu
    // lesen, und jedes Fenster, das ein berührtes Gebiet trägt (oder eine seiner Flächen, sein Obergebiet oder Untergebiet), liest es samt Verlauf neu. Eine laufende Bearbeitung behält ihr
    // Ungeschriebenes (`neuLesen` tut dort nichts); ein Fenster, das die Rücknahme nicht berührt, liest nicht.
    const stopGebietMeldung = watch(gebietMeldung, (jetzt) => {
        if (jetzt === undefined) return;
        const gebiete = new Set(jetzt.gebiete);
        const flaechen = new Set(jetzt.flaechen);
        if (gebiete.size === 0) entwurf?.geaendert(jetzt.mapRevision);
        for (const id of gebiete) entwurf?.geaendert(jetzt.mapRevision, id);
        ladeListe();
        hierarchieGebraucht(auswahl.value, true);
        for (const [id, bearbeitung] of bearbeitungen.value) {
            const d = bearbeitung.detail.value;
            const beruehrt =
                gebiete.has(id) ||
                (d?.areas.some((flaeche) => flaechen.has(flaeche.id)) ?? false) ||
                (d?.children.some((kind) => gebiete.has(kind.id)) ?? false) ||
                (d?.parents.some((eltern) => gebiete.has(eltern.id)) ?? false);
            if (!beruehrt) continue;
            void bearbeitung.neuLesen();
            void bearbeitung.verlauf.lade();
        }
        // Die Revisionen der Mehrfachauswahl stehen im gelesenen Stand der Sammelansicht; ihr Entwurf bleibt.
        if (sammel.value !== undefined && sammelIds.value.some((id) => gebiete.has(id))) void sammel.value.neuLesen();
    });

    const aktiv = computed(() => {
        const id = vorderstes.value?.gegenstand;
        const bearbeitung = id === undefined ? undefined : bearbeitungen.value.get(id);
        return bearbeitung?.lage.value.aktiv === true ? bearbeitung : undefined;
    });

    return {
        liste,
        ladeFehler,
        listenEinstellung,
        auswahl,
        hierarchie,
        hierarchieFehler,
        befunde,
        fenster,
        aktiv,
        mehrfachauswahl,
        sammelAktiv,
        esc() {
            if (sammelAktiv.value !== undefined) {
                sammelAktiv.value.esc();
                return true;
            }
            return aktiv.value?.esc() ?? false;
        },
        taste(event) {
            const bearbeitung = sammelAktiv.value ?? aktiv.value;
            const welche = bearbeitung === undefined ? undefined : entwurfsTaste(event);
            if (bearbeitung === undefined || welche === undefined) return false;
            if (welche === "wieder") bearbeitung.wieder();
            else bearbeitung.zurueck();
            return true;
        },
        bearbeitungVon: (id) => (id === undefined ? undefined : bearbeitungen.value.get(id)),
        reiterWunsch,
        waehle(id, fensterId, reiter) {
            const an = fensterId ?? vorderstes.value?.id;
            const eintrag = fenster.value.find((x) => x.id === an);
            if (eintrag !== undefined && eintrag.gegenstand === id) return;
            reiterWunsch.value = id === undefined || reiter === undefined ? undefined : { gegenstand: id, reiter };
            oeffneAn(an, id);
        },
        oeffneWerkzeug: () => void oeffneVorn(undefined, false),
        oeffneFuer: (id) => oeffneVorn(id, true),
        geoeffnet(subjekt, options, editorModus) {
            if (!editorModus || options.source !== "map" || options.still === true || subjekt.kind !== "territory")
                return false;
            oeffneVorn(subjekt.id, true);
            return true;
        },
        hierarchieGebraucht: (id) => hierarchieGebraucht(id),
        neuLaden,
        wappenGeaendert(id) {
            ladeListe();
            void bearbeitungen.value.get(id)?.neuLesen();
            // Keine Kachelrevision: Das Wappen steht nicht auf der Karte; das Infopanel liest das Gebiet neu.
            entwurf?.geaendert(undefined, id);
        },
        ladeListe,
        async entferne(id, stage, children) {
            const bearbeitung = bearbeitungen.value.get(id);
            const revision = bearbeitung?.detail.value?.revision;
            if (revision === undefined) return { ok: false, satz: t("gebietseditor.entfernen.laedt") };
            const antwort = await sende(
                editorTerritoryRetireUrl(id),
                {
                    operationId: globalThis.crypto.randomUUID(),
                    baseRevision: revision,
                    stage,
                    ...(children === undefined ? {} : { children }),
                } satisfies TerritoryRetireBody,
                "POST",
                (eingabe, init) => fetcher(String(eingabe), init),
            );
            if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
            entwurf?.geaendert(antwort.quittung.mapRevision, id);
            // Ganz gelöscht: Das Fenster geht zu (Fund 2026-10-19: das gelöschte und das neue Gebiet standen mit gleichem Titel unter
            // „Offene Bearbeitungen“). Zurück holt es die Facette „Gelöscht“ oder ↺ im Verlauf.
            if (stage === "retire")
                for (const eintrag of fenster.value.filter((f) => f.gegenstand === id))
                    werkzeugfenster.schliesse(eintrag.id);
            neuLaden();
            return { ok: true };
        },
        destroy() {
            laden?.abort();
            befundeLaden?.abort();
            hierarchieLaden?.steuer.abort();
            stopBearbeitungen();
            stopUngespeichert();
            stopTitel();
            stopSammel();
            stopEinzeln();
            stopMeldung();
            stopGebietMeldung();
            sammel.value?.destroy();
            for (const bearbeitung of bearbeitungen.value.values()) bearbeitung.destroy();
        },
    };
}
