import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    EDITOR_POWERLINES_URL,
    editorPowerlinePutOnMapUrl,
    editorPowerlineRestoreUrl,
    editorPowerlineRetireUrl,
    editorPowerlineTakeOffMapUrl,
    type EditorPowerlineDetail,
    type EditorPowerlineList,
    type PowerlineStateChange,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, type Fetcher } from "../auth/api";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { EditorSperre } from "../editor-sperre/sperre";
import { createBearbeitung } from "../fenster/bearbeitung";
import { entwurfsTaste } from "../fenster/entwurf-kern";
import { createVerlauf, type Verlauf } from "../fenster/entwurf-verlauf";
import { sende } from "../fenster/entwurf-senden";
import { gesicherte } from "../fenster/entwurf-sicherung";
import type { ListenSchalter } from "../fenster/listen-schalter";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import { t } from "../i18n/i18n";
import { createKraftlinieArt, type Ankerfolge } from "./kraftlinie-art";
import { kraftlinieMeldung } from "./kraftlinie-melde";
import type { KraftlinieBearbeitung } from "./kraftlinie-kurve";
import { createKraftlinieSammel, type KraftlinieSammel } from "./kraftlinie-sammel";
import { createKraftlinieVerlaufsArt } from "./kraftlinie-verlauf";
import { KRAFTLINIEN_OPTIONEN, ladeKraftlinien } from "./kraftlinien-liste";

/**
 * Was die Seite für den Kraftlinien-Editor hält (WI-0205 K2, K6, K8 auf O3; EDIT-0003 T44; Muster
 * `landschaftseditor/landschaftseditor-steuerung.ts`): die Liste der Linien (einmal geladen, von allen Fenstern geteilt) samt Suche und
 * Filter, und je Fenster EINE Linie mit ihrer Bearbeitung (`fenster/bearbeitung.ts`, Art `kraftlinie-art.ts`). `app.vue` hängt nur ein.
 *
 * - 🔴 **Je Linie ein Fenster** (T44, D19, wie je Ort und je Landschaft): Ein Klick in der Liste öffnet die Linie an der Stelle dieses
 *   Fensters, das bisherige wandert mit seinem Entwurf nach „Offene Bearbeitungen“. Handgriffe und ein Klick auf die Karte öffnen an
 *   der Stelle des vordersten Kraftlinienfensters, sonst in einem neuen.
 * - 🔴 **Die Linie heißt nach ihrem Anker** (dem kleinsten Abschnitt): Die Karte nennt den getroffenen Abschnitt; er wird erst zum Anker
 *   aufgelöst, dann öffnet das Fenster (Fund des Betreibers 2026-10-17: „Kraftlinie entfernen“ an der Linie hatte keinen Effekt).
 * - **Eine Bearbeitung je Linie** (O3): Felder implizit mit der ersten Änderung, die Kurve als Anschluss (`kraftlinie-kurve.ts`), „Fertig“
 *   als EINE Operation `powerline.update_line`. Sie entsteht mit dem Fenster und geht mit ihm; Schließen legt einen Entwurf ab.
 * - **Nach dem Neuladen** stehen im Browser gesicherte Entwürfe als abgelegte Fenster unter „Offene Bearbeitungen“ (R1, D19).
 * - **Verlauf** je Linie (gemeinsamer Verlauf `fenster/entwurf-verlauf.ts`, Anschluss `kraftlinie-verlauf.ts`): entsteht und geht mit der
 *   Bearbeitung; ↺ zeichnet die Karte neu und liest die Liste.
 * - **Entfernen in zwei Stufen** (T39, K10, EDIT-0003 T43): Die Nachfrage steht im Fenster der Linie; „Von der Karte nehmen“
 *   (`powerline.take_off_map`) oder „Ganz löschen“ (`powerline.retire`, weich), je für alle Abschnitte. Das Fenster bleibt und zeigt
 *   den Stand; „Zurück auf die Karte“ (`powerline.put_on_map`) und „Zurückholen“ (`powerline.restore`) gehen von dort und über den
 *   Verlauf.
 */
export const KRAFTLINIENEDITOR = "kraftlinieneditor";

/** Was das Schreiben braucht; ohne bleibt der Editor lesend (Tests, Besucher). */
export interface KraftlinieEntwurfOptionen {
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust">;
    /** Geschrieben: die Kachelrevision an die Karte. */
    geaendert(revision: number | undefined): void;
    readonly speicher?: Storage | undefined;
    /** Darf diese Sitzung Kraftlinien schreiben (Recht und `MAP_EDITING`)? */
    darfSchreiben(): boolean;
}

export interface KraftlinieneditorSteuerung {
    readonly liste: Readonly<ShallowRef<EditorPowerlineList | undefined>>;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    readonly listenEinstellung: ListenEinstellung;
    /** Die Linie des vordersten Kraftlinienfensters. */
    readonly auswahl: ComputedRef<string | undefined>;
    /** Die offenen Fenster dieses Werkzeugs, das vorderste zuletzt. */
    readonly fenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Bearbeitung einer Linie (unter ihrem Anker), solange ein Fenster sie trägt. */
    bearbeitungVon(id: string | undefined): KraftlinieBearbeitung | undefined;
    /** Der Verlauf einer Linie (unter ihrem Anker), solange ein Fenster sie trägt. */
    verlaufVon(id: string | undefined): Verlauf<unknown> | undefined;
    /** Das Fenster, das eine Linie trägt. */
    fensterVon(id: string | undefined): WerkzeugFenster | undefined;
    /** Die Bearbeitung des vordersten sichtbaren Kraftlinienfensters, wenn dort gerade bearbeitet wird (Leiste, Tasten, Esc). */
    readonly aktiv: ComputedRef<KraftlinieBearbeitung | undefined>;
    /** Esc für die laufende Bearbeitung (R2): fragt bei Ungeschriebenem, sonst endet sie. `true`, wenn sie die Taste nahm. */
    esc(): boolean;
    /** Strg+Z und Strg+Y (Mac ⌘) für die laufende Bearbeitung, nie im Textfeld. `true`, wenn sie die Taste nahm. */
    taste(event: KeyboardEvent): boolean;
    /** Ein Klick in der Liste eines Fensters (ohne Fenster: im vordersten): die Linie an dessen Stelle (D19). */
    waehle(id: string | undefined, fensterId?: string): void;
    /** Das Verb „Kraftlinien bearbeiten“: holt das vorderste Fenster hervor oder öffnet eins. */
    oeffneWerkzeug(): void;
    /**
     * Ein Handgriff an der Karte (K3), eine neue Linie (K9): das Fenster an dieser Linie, auch wenn `id` ein Abschnitt ist. Gibt die
     * Bearbeitung zurück, sobald das Fenster steht; `undefined`, wenn es die Linie nicht gibt.
     */
    oeffneFuer(id: string): Promise<KraftlinieBearbeitung | undefined>;
    /** Die Linie (Anker), deren Entfernen gerade nachgefragt wird (EDIT-0003 T39); ihr Fenster zeigt die Nachfrage. */
    readonly entfernenFrage: Readonly<Ref<string | undefined>>;
    /** „Kraftlinie entfernen“ aus dem Kartenmenü: das Fenster an der Linie, mit der Nachfrage. */
    frageEntfernen(id: string): Promise<void>;
    abbrechenEntfernen(): void;
    /**
     * Die Nachfrage bestätigt, in der gewählten Stufe: von der Karte nehmen oder ganz löschen, gegen die Revisionen aller Abschnitte.
     * Gibt die Kartenrevision der Quittung zurück, oder den Satz, warum es nicht ging.
     */
    entferne(wahl: "abnehmen" | "loeschen"): Promise<Wechselergebnis>;
    /** „Zurück auf die Karte“ (abgenommen) oder „Zurückholen“ (gelöscht) für die Linie dieses Ankers. */
    zurueck(anker: string): Promise<Wechselergebnis>;
    /**
     * Ein Objekt der Karte wurde geöffnet: Im Editor-Modus öffnet ein Klick auf eine Kraftlinie das Fenster an ihr, wie bei Landschaften
     * (EDIT-0003 T34 (1)). `true`, wenn es sie nahm.
     */
    geoeffnet(ref: SubjectRef, options: OpenSubjectOptions, editorModus: boolean): boolean;
    ladeListe(): void;
    /** Die Mehrfachauswahl eines Fensters (WI-0238, EDIT-0003 T57): an oder aus, und was angehakt ist; flüchtig wie die Liste. */
    mehrfachVon(fensterId: string): { readonly mehrfach: boolean; readonly angehakt: readonly string[] };
    /** Die Liste meldet beides einzeln (`v-model:mehrfach`, `v-model:angehakt`), beim Einschalten erst die Häkchen. */
    setzeMehrfach(fensterId: string, mehrfach: boolean): void;
    setzeAngehakt(fensterId: string, angehakt: readonly string[]): void;
    /** Was in allen Fenstern mit eingeschalteter Mehrfachauswahl angehakt ist (die Anker): leuchtet auf der Karte. */
    readonly mehrfachAngehakt: ComputedRef<readonly string[]>;
    /** Die Sammelansicht eines Fensters, ab zwei angehakten Linien (`kraftlinie-sammel.ts`). */
    sammelVon(fensterId: string): KraftlinieSammel | undefined;
    /** Die Sammelansicht des vordersten Fensters, solange ihr Entwurf etwas zu schreiben hat (Leiste, Tasten, Esc). */
    readonly sammelAktiv: ComputedRef<KraftlinieSammel | undefined>;
    destroy(): void;
}

export type Wechselergebnis =
    | {
          readonly ok: true;
          readonly name: string;
          readonly wechsel: PowerlineStateChange;
          readonly mapRevision: number | undefined;
      }
    | { readonly ok: false; readonly satz: string };

/** Die Adresse je Wechsel des Stands (K10). */
const WECHSEL_URL: Record<PowerlineStateChange, (anker: string) => string> = {
    "powerline.take_off_map": editorPowerlineTakeOffMapUrl,
    "powerline.put_on_map": editorPowerlinePutOnMapUrl,
    "powerline.retire": editorPowerlineRetireUrl,
    "powerline.restore": editorPowerlineRestoreUrl,
};

/** Eine Bearbeitung, die nur liest (ohne Entwurfsoptionen): Sperre und Karte tun nichts. */
const OHNE_SPERRE: KraftlinieEntwurfOptionen["sperre"] = {
    nimm: async () => ({ art: "fehler", fehler: new ApiFailure(423, "map_editing_off", "") }),
    gib: () => undefined,
    beiVerlust: () => () => undefined,
};

export function createKraftlinieneditorSteuerung(
    werkzeugfenster: Werkzeugfenster,
    fetcher: Fetcher = (url, init) => fetch(url, init),
    /** Der gemeinsame Schalter der Listen: Von der Karte geöffnet, steht das Fenster mit eingeklappter Liste (EDIT-0003, Variante A). */
    listenSchalter?: Pick<ListenSchalter, "vorlaeufig">,
    entwurf?: KraftlinieEntwurfOptionen,
): KraftlinieneditorSteuerung {
    const liste = shallowRef<EditorPowerlineList | undefined>(undefined);
    const ladeFehler = ref<string | undefined>(undefined);
    const entfernenFrage = ref<string | undefined>(undefined);
    const listenEinstellung = createListenEinstellung({
        vorbelegt: KRAFTLINIEN_OPTIONEN.vorbelegt,
        sortierung: "name",
        maske: "",
    });
    let laden: AbortController | undefined;
    const bearbeitungen = shallowRef(new Map<string, KraftlinieBearbeitung>());
    /** Je Bearbeitung ihr Verlauf; entsteht und geht mit ihr. */
    const verlaeufe = new Map<string, Verlauf<unknown>>();
    /** Welcher Abschnitt zu welchem Anker gehört, aus jeder gelesenen Linie. */
    const ankerVonAbschnitt = new Map<string, string>();
    const nurLesen = (): boolean => entwurf?.darfSchreiben() !== true;

    const fenster = computed(() =>
        werkzeugfenster.stand.value.fenster
            .filter((eintrag) => eintrag.werkzeug === KRAFTLINIENEDITOR)
            .sort((a, b) => a.vorn - b.vorn),
    );
    /** Das vorderste sichtbare Kraftlinienfenster: Dort öffnen Verb, Handgriffe und Karte (D19). */
    const vorderstes = computed(() => fenster.value.filter((eintrag) => eintrag.lage !== "versenkt").at(-1));
    const auswahl = computed(() => vorderstes.value?.gegenstand);

    const titelVon = (id: string | undefined, name?: string): string => {
        const gefunden = name ?? liste.value?.rows.find((row) => row.id === id)?.name;
        return gefunden === undefined ? t("kraftlinieneditor.titel") : `${t("kraftlinieneditor.titel")} · ${gefunden}`;
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
        ladeKraftlinien(steuer.signal, fetcher).then(
            (geladen) => {
                if (laden === steuer) liste.value = geladen;
            },
            (error: unknown) => {
                if (laden === steuer && !steuer.signal.aborted) ladeFehler.value = fehlerText(error);
            },
        );
    }

    // --- Je Linie eine Bearbeitung, solange ein Fenster sie trägt; ihr Verlauf folgt demselben Anker ---
    function neueBearbeitung(id: string, titel: string, folge: Ankerfolge): KraftlinieBearbeitung {
        return createBearbeitung(
            createKraftlinieArt((eingabe, init) => fetcher(String(eingabe), init), folge),
            {
                id,
                titel,
                sperre: entwurf?.sperre ?? OHNE_SPERRE,
                karte: {
                    geaendert(revision) {
                        entwurf?.geaendert(revision);
                        // Der Name steht auch in der Liste.
                        ladeListe();
                    },
                },
                speicher: entwurf?.speicher,
            },
        );
    }
    const stopBearbeitungen = watch(
        () => fenster.value.map((eintrag) => eintrag.gegenstand).filter((id): id is string => id !== undefined),
        (ids) => {
            const jetzt = bearbeitungen.value;
            const neu = new Map<string, KraftlinieBearbeitung>();
            for (const id of ids) {
                const da = jetzt.get(id);
                if (da !== undefined) {
                    neu.set(id, da);
                    continue;
                }
                const folge: Ankerfolge = { anker: undefined };
                const bearbeitung = neueBearbeitung(id, titelVon(id), folge);
                neu.set(id, bearbeitung);
                verlaeufe.set(
                    id,
                    createVerlauf(
                        createKraftlinieVerlaufsArt((eingabe, init) => fetcher(String(eingabe), init), folge),
                        {
                            id,
                            bearbeitung,
                            zurueckgenommen(revision) {
                                entwurf?.geaendert(revision);
                                ladeListe();
                            },
                            fetcher: (eingabe, init) => fetcher(String(eingabe), init),
                        },
                    ) as Verlauf<unknown>,
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
        // Sofort: Wer ein Fenster öffnet, findet seine Bearbeitung gleich danach (Handgriffe, „Kurve bearbeiten“).
        { immediate: true, flush: "sync" },
    );
    // Jede gelesene Linie nennt ihre Abschnitte: Ein späterer Klick auf einen von ihnen findet ihr Fenster ohne Umweg. Heißt die Linie
    // inzwischen nach einem anderen Anker (verschmolzen beim Umbenennen), folgt das Fenster ihm, sobald nicht bearbeitet wird.
    const stopAbschnitte = watch(
        () =>
            [...bearbeitungen.value.values()].map(
                (bearbeitung) => [bearbeitung.id, bearbeitung.detail.value, bearbeitung.lage.value.aktiv] as const,
            ),
        (stand) => {
            for (const [id, d, aktiv] of stand) {
                if (d === undefined) continue;
                for (const a of d.segments) ankerVonAbschnitt.set(a.id, d.id);
                const traeger = fenster.value.find((eintrag) => eintrag.gegenstand === id);
                if (d.id !== id && !aktiv && traeger !== undefined && !bearbeitungen.value.has(d.id))
                    werkzeugfenster.markiere(traeger.id, { gegenstand: d.id, titel: titelVon(d.id, d.name) });
            }
        },
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
    // Ein Fenster, das „Offene Bearbeitungen“ hervorholt (nach dem Neuladen), braucht die Liste ebenso wie eines, das hier aufgeht.
    const stopListe = watch(
        () => vorderstes.value !== undefined,
        (sichtbar) => {
            if (sichtbar && liste.value === undefined && laden === undefined) ladeListe();
        },
    );
    // Fenster, die vor der Liste aufgingen, bekommen ihren Titel, sobald die Liste da ist (für „Offene Bearbeitungen“).
    const stopTitel = watch(liste, () => {
        for (const eintrag of fenster.value)
            if (eintrag.gegenstand !== undefined)
                werkzeugfenster.markiere(eintrag.id, { titel: titelVon(eintrag.gegenstand) });
    });

    /** Öffnet eine Linie an der Stelle eines Fensters (D19), sonst in einem neuen. Gibt das Fenster zurück. */
    function oeffneAn(an: string | undefined, id: string | undefined): string {
        if (liste.value === undefined && laden === undefined) ladeListe();
        const wunsch = { werkzeug: KRAFTLINIENEDITOR, gegenstand: id, titel: titelVon(id), nurLesen: nurLesen() };
        return an === undefined ? werkzeugfenster.oeffne(wunsch) : werkzeugfenster.oeffneAnStelle(an, wunsch);
    }

    /**
     * Das Verb und die Karte: im vordersten Fenster, sonst in einem neuen. `vonKarte`: Öffnet die Karte das Fenster erst, steht es nur
     * mit den Eigenschaften, die Liste eingezogen; ein offenes behält seine Liste (EDIT-0003, Variante A).
     */
    function oeffneVorn(id: string | undefined, vonKarte: boolean): string {
        const vorn = vorderstes.value;
        if (vorn !== undefined && (id === undefined || vorn.gegenstand === id)) {
            werkzeugfenster.hervorholen(vorn.id);
            if (liste.value === undefined && laden === undefined) ladeListe();
            return vorn.id;
        }
        // Trägt schon ein Fenster die Linie (abgelegt oder hinten), kommt es hervor, statt dass ein zweites aufgeht.
        const da = id === undefined ? undefined : fenster.value.find((eintrag) => eintrag.gegenstand === id);
        if (da !== undefined) {
            werkzeugfenster.hervorholen(da.id);
            return da.id;
        }
        const fensterId = oeffneAn(vorn?.id, id);
        if (vonKarte && vorn === undefined) listenSchalter?.vorlaeufig(fensterId, true, KRAFTLINIENEDITOR);
        return fensterId;
    }

    /** Der Anker, soweit er ohne den Server bekannt ist: eine Bearbeitung, eine Zeile der Liste oder ein gelesener Abschnitt. */
    function bekannterAnker(id: string): string | undefined {
        if (bearbeitungen.value.has(id) || liste.value?.rows.some((row) => row.id === id) === true) return id;
        return ankerVonAbschnitt.get(id);
    }

    /** Der Anker der Linie zu einer Kennung (Anker oder Abschnitt); `undefined`, wenn es sie nicht gibt. */
    async function ankerVon(id: string): Promise<string | undefined> {
        const bekannt = bekannterAnker(id);
        if (bekannt !== undefined) return bekannt;
        try {
            const linie = await getJson<EditorPowerlineDetail>(`${EDITOR_POWERLINES_URL}/${id}`, (url, init) =>
                fetcher(url, { ...init, cache: "no-store" }),
            );
            for (const a of linie.segments) ankerVonAbschnitt.set(a.id, linie.id);
            return linie.id;
        } catch {
            return undefined;
        }
    }

    async function oeffneFuer(id: string, vonKarte: boolean): Promise<KraftlinieBearbeitung | undefined> {
        const anker = await ankerVon(id);
        if (anker === undefined) return undefined;
        oeffneVorn(anker, vonKarte);
        return bearbeitungen.value.get(anker);
    }

    // Nach dem Neuladen: gesicherte Entwürfe als abgelegte Fenster (R1, D19).
    for (const eintrag of gesicherte(entwurf?.speicher).filter((x) => x.art === "powerline")) {
        if (fenster.value.some((x) => x.gegenstand === eintrag.id)) continue;
        const fensterId = werkzeugfenster.oeffne({
            werkzeug: KRAFTLINIENEDITOR,
            gegenstand: eintrag.id,
            titel: eintrag.titel,
            nurLesen: nurLesen(),
        });
        werkzeugfenster.setzeLage(fensterId, "versenkt");
        werkzeugfenster.markiere(fensterId, { ungespeichert: true });
    }

    const aktiv = computed(() => {
        const id = vorderstes.value?.gegenstand;
        const bearbeitung = id === undefined ? undefined : bearbeitungen.value.get(id);
        return bearbeitung?.lage.value.aktiv === true ? bearbeitung : undefined;
    });

    // --- Die Mehrfachauswahl je Fenster (WI-0238, EDIT-0003 T57) ---
    const AUS = { mehrfach: false, angehakt: [] as readonly string[] } as const;
    const mehrfach = shallowRef<ReadonlyMap<string, { mehrfach: boolean; angehakt: readonly string[] }>>(new Map());
    const sammlungen = shallowRef<ReadonlyMap<string, KraftlinieSammel>>(new Map());
    /** Geschrieben: Karte, Liste und die offenen Linien der Auswahl neu lesen. */
    function sammelGeschrieben(ids: readonly string[], revision: number | undefined): void {
        entwurf?.geaendert(revision);
        ladeListe();
        for (const id of ids) void bearbeitungen.value.get(id)?.neuLesen();
    }
    function setze(fensterId: string, an: boolean, angehakt: readonly string[]): void {
        const neu = new Map(mehrfach.value);
        if (!an && angehakt.length === 0) neu.delete(fensterId);
        else neu.set(fensterId, { mehrfach: an, angehakt });
        mehrfach.value = neu;
        // Ab zwei angehakten Linien eine Sammelansicht; ein anderer Satz Häkchen beginnt eine neue (die Auswahl ist flüchtig).
        const alt = sammlungen.value.get(fensterId);
        const ids = an && angehakt.length >= 2 ? angehakt : [];
        if (alt !== undefined && alt.ids.length === ids.length && alt.ids.every((id) => ids.includes(id))) return;
        alt?.destroy();
        const naechste = new Map(sammlungen.value);
        if (ids.length === 0) naechste.delete(fensterId);
        else
            naechste.set(
                fensterId,
                createKraftlinieSammel(ids, {
                    fetcher,
                    zeilen: () => liste.value?.rows ?? [],
                    geschrieben: (quittung) => sammelGeschrieben(ids, quittung.mapRevision),
                }),
            );
        sammlungen.value = naechste;
    }
    // Ein geschlossenes Fenster nimmt seine Auswahl mit.
    const stopMehrfach = watch(fenster, (offen) => {
        const ids = new Set(offen.map((eintrag) => eintrag.id));
        for (const fensterId of [...mehrfach.value.keys()]) if (!ids.has(fensterId)) setze(fensterId, false, []);
    });
    const mehrfachAngehakt = computed((): readonly string[] => [
        ...new Set([...mehrfach.value.values()].flatMap((stand) => (stand.mehrfach ? stand.angehakt : []))),
    ]);
    const sammelAktiv = computed(() => {
        const vorn = vorderstes.value;
        const sammel = vorn === undefined ? undefined : sammlungen.value.get(vorn.id);
        return sammel?.entwurf.lage.value.aktiv === true || sammel?.entwurf.zustand.value.art === "speichert"
            ? sammel
            : undefined;
    });

    // Eine Rücknahme über den Server hat Abschnitte von Kraftlinien berührt (WI-0265 B6h, wie `landschaftseditor-steuerung.ts` bei den Landschaften): die Kacheln nachziehen, die Liste neu
    // lesen, und jedes Fenster, dessen Linie einen berührten Abschnitt hat (die Quittung nennt die Abschnitte, die die Linie danach hat), liest sie samt Verlauf neu. Eine laufende Bearbeitung
    // behält ihr Ungeschriebenes (`neuLesen` tut dort nichts); ein Fenster, das die Rücknahme nicht berührt, liest nicht. Ebenso die Sammelansicht der Mehrfachauswahl (B6h2): Sie liest die
    // Abschnitte und Revisionen ihrer Linien neu, ihr Entwurf bleibt.
    const stopKraftlinieMeldung = watch(kraftlinieMeldung, (meldung) => {
        if (meldung === undefined) return;
        entwurf?.geaendert(meldung.mapRevision);
        ladeListe();
        const abschnitte = new Set(meldung.abschnitte);
        const knoten = new Set(meldung.knoten);
        /**
         * Ob die Linie unter diesem Anker einen berührten Abschnitt oder Kraftlinienpunkt hat (WI-0265 B8b): nach ihrem Anker, nach dem gelesenen Detail oder nach dem Anker, den ein Abschnitt zuletzt
         * nannte.
         */
        const beruehrt = (anker: string, d: EditorPowerlineDetail | undefined): boolean =>
            abschnitte.has(anker) ||
            (d?.segments.some((a) => abschnitte.has(a.id)) ?? false) ||
            (knoten.size > 0 && (d?.nodes.some((n) => knoten.has(n.id)) ?? false)) ||
            meldung.abschnitte.some((a) => ankerVonAbschnitt.get(a) === anker);
        for (const [id, bearbeitung] of bearbeitungen.value) {
            if (!beruehrt(id, bearbeitung.detail.value)) continue;
            void bearbeitung.neuLesen();
            void verlaeufe.get(id)?.lade();
        }
        for (const sammel of sammlungen.value.values())
            if (sammel.ids.some((id) => beruehrt(id, sammel.details.value.get(id)))) void sammel.neuLesen();
    });

    return {
        liste,
        ladeFehler,
        listenEinstellung,
        auswahl,
        fenster,
        aktiv,
        esc() {
            const sammel = sammelAktiv.value;
            if (sammel !== undefined) {
                sammel.entwurf.esc();
                return true;
            }
            return aktiv.value?.esc() ?? false;
        },
        taste(event) {
            const bearbeitung = aktiv.value ?? sammelAktiv.value?.entwurf;
            const welche = bearbeitung === undefined ? undefined : entwurfsTaste(event);
            if (bearbeitung === undefined || welche === undefined) return false;
            if (welche === "wieder") bearbeitung.wieder();
            else bearbeitung.zurueck();
            return true;
        },
        bearbeitungVon,
        verlaufVon: (id) => (id === undefined || !bearbeitungen.value.has(id) ? undefined : verlaeufe.get(id)),
        fensterVon: (id) => (id === undefined ? undefined : fenster.value.find((eintrag) => eintrag.gegenstand === id)),
        waehle(id, fensterId) {
            const an = fensterId ?? vorderstes.value?.id;
            const eintrag = fenster.value.find((x) => x.id === an);
            if (eintrag !== undefined && eintrag.gegenstand === id) return;
            oeffneAn(an, id);
        },
        oeffneWerkzeug: () => void oeffneVorn(undefined, false),
        oeffneFuer: (id) => oeffneFuer(id, true),
        geoeffnet(subjekt, options, editorModus) {
            if (!editorModus || options.source !== "map" || options.still === true || subjekt.kind !== "powerline")
                return false;
            // Der Anker des Klicks ist der getroffene Abschnitt; das Fenster heißt nach dem Anker der Linie. 🔴 Es öffnet sofort, nicht
            // erst nach dem Lesen der Linie: Gleich danach misst die Kamera das Fenster und holt die Stelle des Klicks unter ihm hervor
            // (`holeGeklicktesHervor`, WI-0218 c1; bei 1920 px lag die Kraftlinie danach unter dem Fenster). Ein noch ungelesener
            // Abschnitt öffnet unter seiner Kennung, das Fenster folgt dem Anker, sobald die Linie gelesen ist (`stopAbschnitte`).
            oeffneVorn(bekannterAnker(subjekt.anchor) ?? subjekt.anchor, true);
            return true;
        },
        ladeListe,
        entfernenFrage,
        async frageEntfernen(id) {
            const bearbeitung = await oeffneFuer(id, true);
            if (bearbeitung !== undefined) entfernenFrage.value = bearbeitung.id;
        },
        abbrechenEntfernen() {
            entfernenFrage.value = undefined;
        },
        entferne(wahl) {
            const anker = entfernenFrage.value;
            if (anker === undefined)
                return Promise.resolve({ ok: false, satz: t("kraftlinieneditor.bearbeiten.ladefehler") });
            return wechsle(anker, wahl === "abnehmen" ? "powerline.take_off_map" : "powerline.retire");
        },
        zurueck(anker) {
            const stand = bearbeitungVon(anker)?.detail.value?.state;
            if (stand === undefined)
                return Promise.resolve({ ok: false, satz: t("kraftlinieneditor.bearbeiten.ladefehler") });
            return wechsle(anker, stand === "abgenommen" ? "powerline.put_on_map" : "powerline.restore");
        },
        mehrfachVon: (fensterId) => mehrfach.value.get(fensterId) ?? AUS,
        setzeMehrfach: (fensterId, an) => setze(fensterId, an, mehrfach.value.get(fensterId)?.angehakt ?? []),
        setzeAngehakt: (fensterId, angehakt) =>
            setze(fensterId, mehrfach.value.get(fensterId)?.mehrfach ?? false, angehakt),
        sammelVon: (fensterId) => sammlungen.value.get(fensterId),
        sammelAktiv,
        mehrfachAngehakt,
        destroy() {
            laden?.abort();
            stopMehrfach();
            for (const sammel of sammlungen.value.values()) sammel.destroy();
            stopBearbeitungen();
            stopAbschnitte();
            stopUngespeichert();
            stopListe();
            stopTitel();
            stopKraftlinieMeldung();
            for (const bearbeitung of bearbeitungen.value.values()) bearbeitung.destroy();
            for (const verlauf of verlaeufe.values()) verlauf.destroy();
        },
    };

    /** Ein Wechsel des Stands für alle Abschnitte der Linie; danach liest ihr Fenster den neuen Stand, die Liste lädt neu. */
    async function wechsle(anker: string, wechsel: PowerlineStateChange): Promise<Wechselergebnis> {
        const bearbeitung = bearbeitungVon(anker);
        const linie = bearbeitung?.detail.value;
        if (bearbeitung === undefined || linie === undefined)
            return { ok: false, satz: t("kraftlinieneditor.bearbeiten.ladefehler") };
        const antwort = await sende(
            WECHSEL_URL[wechsel](linie.id),
            {
                operationId: crypto.randomUUID(),
                segments: linie.segments.map((a) => ({ id: a.id, baseRevision: a.revision })),
            },
            "POST",
            (eingabe, init) => fetcher(String(eingabe), init),
        );
        if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
        entfernenFrage.value = undefined;
        await bearbeitung.neuLesen();
        ladeListe();
        return { ok: true, name: linie.name, wechsel, mapRevision: antwort.quittung.mapRevision };
    }

    function bearbeitungVon(id: string | undefined): KraftlinieBearbeitung | undefined {
        return id === undefined ? undefined : bearbeitungen.value.get(id);
    }
}
