import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import {
    editorPathRowHasChain,
    editorPathStreetUrl,
    PATH_VERBINDEN_MAX,
    type EditorPathList,
    type EditorPathStreet,
    type PathVerbindenPruefung,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, type Fetcher } from "../auth/api";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import { alsMehrfachauswahl, umschalteAufKarte } from "../editor-liste/mehrfachauswahl";
import { WEG_NAME_MARKE } from "../map/mehrfach-markierung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import type { EditorSperre } from "../editor-sperre/sperre";
import { createBearbeitung, type Bearbeitung } from "../fenster/bearbeitung";
import { createVerlauf, type Verlauf } from "../fenster/entwurf-verlauf";
import { entwurfsTaste } from "../fenster/entwurf-kern";
import { gesicherte } from "../fenster/entwurf-sicherung";
import type { ListenSchalter } from "../fenster/listen-schalter";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import { t } from "../i18n/i18n";
import { createWegArt, type WegArt, type WegFelder, type WegForm } from "./weg-art";
import type { WegEntfernenAuswahl } from "./weg-entfernen";
import { createWegSammel, wegMarke, type WegSammel } from "./weg-sammel";
import { auswahlAus, schreibeNeuenWeg, type WegAuswahl } from "./weg-neuer-weg";
import {
    ladePruefung,
    pruefSchluessel,
    schreibeVerbinden,
    VERBINDEN_GRUND,
    verbindenAuswahlAus,
    verbindenWahlen,
    type VerbindenTeil,
} from "./weg-verbinden";
import type { HandgriffWahl } from "../editor-menu/action";
import type { MessageKey } from "../i18n/i18n";
import { wegMeldung } from "./weg-melde";
import { createWegVerlaufsArt } from "./weg-verlauf";
import { WEGE_OPTIONEN, ladeWege, zeileVon } from "./wege-liste";

/**
 * Was die Seite für die Wege-Fenster hält (WI-0177 W5a, W5b; EDIT-0003 T44; Muster `landschaftseditor/landschaftseditor-steuerung.ts`):
 * die Liste der Straßen (einmal geladen, von allen Fenstern geteilt) samt Suche und Filter, und je Fenster EINE Straße mit ihrer
 * Bearbeitung (`fenster/bearbeitung.ts`). `app.vue` hängt nur ein.
 *
 * - 🔴 **Je Straße ein Fenster** (T44, wie je Ort, je Landschaft, EDIT-0001 D19): Ein Klick in der Liste öffnet die Straße an der Stelle
 *   dieses Fensters, das bisherige wandert mit seinem Entwurf nach „Offene Bearbeitungen“. Verb, Handgriffe und ein Klick auf die Karte
 *   öffnen an der Stelle des vordersten Wege-Fensters, sonst in einem neuen. Gegenstand ist der Anker der Straße (`EditorPathStreet.id`);
 *   ein Abschnitt der Karte wird erst zu seinem Anker, dann geöffnet, damit eine Straße nie in zwei Bearbeitungen steht.
 * - **Eine Bearbeitung je Straße** (O3, W5b): gelesene Straße, EIN Entwurf für ihre Felder und die Kurve eines Abschnitts (die Form,
 *   `wegkurve.ts`), „Fertig“ als `path.update`. Sie entsteht mit dem Fenster und geht mit ihm; ein Entwurf wird beim Schließen
 *   abgelegt, nie verworfen (`fenster-verwaltung.ts`).
 * - **Nach dem Neuladen** stehen im Browser gesicherte Entwürfe als abgelegte Fenster unter „Offene Bearbeitungen“ (R1, D19).
 * - Ist ein Fenster offen, folgt es einem Klick auf einen Weg der Karte (seine Straße). Kennt der Klick nur die Kette (`name:<Name>`,
 *   der erste Klick wählt die Straße), wartet die Wahl auf die Liste.
 * - 🪤 Geöffnet wird es NICHT vom Klick, anders als bei Ort und Fläche (T34 (1), F23 beim Betreiber): Das aufgehende Fenster verschiebt
 *   die freie Karte, und der zweite Klick (der Abschnitt, T24 (1)) und der Doppelklick (R3) träfen daneben.
 * - **Mehrfachauswahl** (WI-0252, Betreiber 2026-10-24: „die mehrfach auswahl von wegen wär super“; wie die Kraftlinien, WI-0238): je
 *   Fenster an oder aus und was angehakt ist (die Anker der Straßen), flüchtig wie die Liste. Ab zwei angehakten eine Sammelansicht
 *   (`weg-sammel.ts`). Ein Umschalt-Klick auf der Karte hakt im vordersten sichtbaren Fenster die Straße des Abschnitts an oder ab
 *   (`umschalteAufKarte`); was angehakt ist, leuchtet auf der Karte (`markierung`). `aufheben` gehört der zentralen Regel (Esc, Klick in
 *   die Karte; `map/mehrfach-markierung.ts`).
 */
export const WEGEDITOR = "wegeditor";

export type WegBearbeitung = Bearbeitung<EditorPathStreet, WegFelder, WegForm> & { readonly art: WegArt };

/** Was das Schreiben braucht; ohne bleibt der Editor lesend (Tests, Besucher). */
export interface WegEntwurfOptionen {
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust">;
    /** Geschrieben: die Kachelrevision an die Karte. */
    geaendert(revision: number | undefined): void;
    readonly speicher?: Storage | undefined;
    /** Darf diese Sitzung Wege schreiben (Recht und `MAP_EDITING`)? */
    darfSchreiben(): boolean;
}

export interface WegeditorSteuerung {
    readonly liste: Readonly<ShallowRef<EditorPathList | undefined>>;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    readonly listenEinstellung: ListenEinstellung;
    /** Die Straße des vordersten Wege-Fensters (ihr Anker). */
    readonly auswahl: ComputedRef<string | undefined>;
    /** Die offenen Fenster dieses Werkzeugs, das vorderste zuletzt. */
    readonly fenster: ComputedRef<WerkzeugFenster[]>;
    /** Die Bearbeitung einer Straße, solange ein Fenster sie trägt. */
    bearbeitungVon(id: string | undefined): WegBearbeitung | undefined;
    /** Der Verlauf einer Straße (T54, `weg-verlauf.ts`), solange ein Fenster sie trägt; entsteht und geht mit ihrer Bearbeitung. */
    verlaufVon(id: string | undefined): Verlauf<unknown> | undefined;
    /** Die Bearbeitung des vordersten sichtbaren Wege-Fensters, wenn dort gerade bearbeitet wird (Leiste, Tasten, Esc). */
    readonly aktiv: ComputedRef<WegBearbeitung | undefined>;
    /** Esc für die laufende Bearbeitung (R2): fragt bei Ungeschriebenem, sonst endet sie. `true`, wenn sie die Taste nahm. */
    esc(): boolean;
    /** Strg+Z und Strg+Y (Mac ⌘) für die laufende Bearbeitung, nie im Textfeld. `true`, wenn sie die Taste nahm. */
    taste(event: KeyboardEvent): boolean;
    /** Ein Klick in der Liste eines Fensters (ohne Fenster: im vordersten): die Straße an dessen Stelle (D19). */
    waehle(id: string | undefined, fensterId?: string): void;
    /** Das Verb „Wege bearbeiten“: holt das vorderste Fenster hervor oder öffnet eins. */
    oeffneWerkzeug(): void;
    /**
     * Die gewählten Abschnitte einer Straße (Leiste (W) (1) (2) … im Kasten „Abschnitte“, P6 Variante C; Betreiber 2026-10-19 am echten
     * Fenster): `null` ist (W), der ganze Weg. Eine Straße ohne Wahl steht auf (W).
     */
    abschnittsWahl(id: string | undefined): ReadonlySet<string> | null;
    /** Eine Nummer der Leiste schaltet ihren Abschnitt in der Auswahl; keiner oder alle heißt (W). */
    schalteAbschnitt(id: string, abschnitt: string): void;
    /** (W): Die Auswahl gilt wieder dem ganzen Weg. */
    ganzerWeg(id: string): void;
    /** Ein Handgriff am Weg: das Fenster an seiner Straße, aus dem Abschnitt (`anchor`) oder nur aus der Kette (`name:<Name>`). */
    oeffneFuer(weg: { readonly anchor: string } | { readonly chain: string }): void;
    /** Ein Modus der Form an einem Abschnitt (die Wegkurve): das Fenster seiner Straße wie `oeffneFuer`, dazu deren Bearbeitung. */
    bearbeitungFuer(abschnitt: string): Promise<WegBearbeitung | undefined>;
    /** Ein Objekt der Karte wurde geöffnet: Ein offenes Fenster folgt einem Weg. `true`, wenn es ihn nahm. */
    geoeffnet(ref: SubjectRef, options: OpenSubjectOptions, editorModus: boolean): boolean;
    /** Nach einer Änderung an Wegen: die Liste und die Straßen ohne Ungeschriebenes neu lesen. */
    neuLaden(): void;
    ladeListe(): void;
    /** Die Mehrfachauswahl eines Fensters (WI-0252): an oder aus, und welche Straßen angehakt sind (ihre Anker). */
    mehrfachVon(fensterId: string): { readonly mehrfach: boolean; readonly angehakt: readonly string[] };
    /** Die Liste meldet beides einzeln (`v-model:mehrfach`, `v-model:angehakt`). */
    setzeMehrfach(fensterId: string, mehrfach: boolean): void;
    setzeAngehakt(fensterId: string, angehakt: readonly string[]): void;
    /** Die Sammelansicht eines Fensters, ab zwei angehakten Straßen (`weg-sammel.ts`). */
    sammelVon(fensterId: string): WegSammel | undefined;
    /** Die Marken der angehakten Straßen aller Fenster mit eingeschalteter Mehrfachauswahl: leuchten auf der Karte (`wegMarke`). */
    readonly markierung: ComputedRef<readonly string[]>;
    /** Nimmt ein Fenster gerade einen Umschalt-Klick auf der Karte (ein sichtbares ist offen)? */
    umschaltBereit(): boolean;
    /**
     * Ein Umschalt-Klick auf einen Abschnitt der Karte, als Marke (`name:<Name>` für eine Straße mit echtem Namen, sonst die Kennung des
     * Abschnitts): seine Straße im vordersten sichtbaren Fenster an- oder abhaken; aus schaltet ein, die Straße des Fensters zählt mit.
     */
    umschalteAufKarte(marke: string): void;
    /** Jede Mehrfachauswahl aus, die Haken gelöst; `true`, wenn eine an war (Esc, Klick in die Karte). */
    aufheben(): boolean;
    /**
     * Die Auswahl eines Fensters als Abschnitte (WI-0252, `weg-neuer-weg.ts`): mit Mehrfachauswahl die Abschnitte aller angehakten Wege,
     * sonst die Abschnitte der Leiste, wenn es nicht alle sind; ohne Fenster das vorderste. `undefined`, solange nichts davon gelesen ist.
     */
    auswahlVon(fensterId?: string): WegAuswahl | undefined;
    /** Gehört dieser Abschnitt zur Auswahl des vordersten Fensters (für das Kartenmenü)? */
    inAuswahl(abschnitt: string): boolean;
    /**
     * Gehört dieser Abschnitt zu einem der angehakten Wege der Mehrfachauswahl des vordersten Fensters (ab zwei, gelesen)? Dann gilt
     * „Weg entfernen …“ im Kartenmenü allen angehakten Wegen (WI-0252).
     */
    inMehrfach(abschnitt: string): boolean;
    /**
     * Die Abschnitte ALLER angehakten Wege des vordersten Fensters, frisch gelesen (Revisionen), für „Weg entfernen …“ an der
     * Mehrfachauswahl; `undefined`, wenn keine Mehrfachauswahl steht oder sie sich nicht lesen ließ.
     */
    entfernenAuswahl(): Promise<WegEntfernenAuswahl | undefined>;
    /** Das Fenster, dessen Rückfrage „Auswahl zu neuem Weg“ gerade offen ist. */
    readonly neuerWegFrage: Readonly<Ref<string | undefined>>;
    /** Die Rückfrage öffnen (Knopf „Form“, Kartenmenü); ohne Fenster im vordersten. */
    frageNeuerWeg(fensterId?: string): void;
    abbrechenNeuerWeg(): void;
    /** „Zu neuem Weg“: EINE Operation; danach steht der neue Weg im Fenster. Ohne Erfolg der Satz, warum nicht. */
    neuerWeg(name: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly satz: string }>;
    /**
     * „Wege verbinden ›“ an diesem Abschnitt (WI-0252, `weg-verbinden.ts`): ohne Auswahl von mindestens zwei Abschnitten, zu der er gehört,
     * `undefined`; sonst die Wahlen des Untermenüs und, solange es nicht geht oder noch geprüft wird, der Grund.
     */
    verbindenAn(
        abschnitt: string,
        texte: { readonly abzweig: string; readonly art: (art: string) => string },
    ): { readonly wahlen: readonly HandgriffWahl[]; readonly grund: MessageKey | undefined } | undefined;
    /** Erfüllt, sobald die Prüfung der Auswahl des vordersten Fensters da ist (das Kartenmenü baut seine Einträge dann neu). */
    verbindenBereit(): Promise<void>;
    /** Die Abschnitte, die „Wege verbinden“ gerade nähme (für das Leuchten beim Zeigen im Untermenü); ohne Auswahl keine. */
    verbindenAbschnitte(): readonly string[];
    /** „Wege verbinden“ mit dieser Vorlage: EINE Operation; danach steht der verbundene Weg im Fenster. */
    verbinde(vorlage: string): Promise<{ readonly ok: true } | { readonly ok: false; readonly satz: string }>;
    destroy(): void;
}

/** Eine Bearbeitung, die nur liest (ohne Entwurfsoptionen): Sperre und Karte tun nichts. */
const OHNE_SPERRE: WegEntwurfOptionen["sperre"] = {
    nimm: async () => ({ art: "fehler", fehler: new ApiFailure(423, "map_editing_off", "") }),
    gib: () => undefined,
    beiVerlust: () => () => undefined,
};

export function createWegeditorSteuerung(
    werkzeugfenster: Werkzeugfenster,
    fetcher: Fetcher = (url, init) => fetch(url, init),
    /** Der gemeinsame Schalter der Listen: Von der Karte geöffnet, steht das Fenster mit eingeklappter Liste (EDIT-0003, Variante A). */
    listenSchalter?: Pick<ListenSchalter, "vorlaeufig">,
    entwurf?: WegEntwurfOptionen,
): WegeditorSteuerung {
    const liste = shallowRef<EditorPathList | undefined>(undefined);
    const ladeFehler = ref<string | undefined>(undefined);
    const listenEinstellung = createListenEinstellung({
        vorbelegt: WEGE_OPTIONEN.vorbelegt,
        sortierung: "name",
        maske: "",
    });
    let laden: AbortController | undefined;
    /** Eine Kette von der Karte, deren Anker erst die Liste kennt, und der Abschnitt, den der Klick dabei gewählt hat. */
    let wartend: string | undefined;
    let wartenderAbschnitt: string | undefined;
    /** Zählt die Wünsche, eine Straße zu zeigen: Ein später aufgelöster Abschnitt öffnet nicht über einen neueren Wunsch hinweg. */
    let wunsch = 0;
    const bearbeitungen = shallowRef(new Map<string, WegBearbeitung>());
    /** Je Straße die gewählten Abschnitte; fehlt eine, steht sie auf (W). Sie lebt mit der Seite, nicht mit dem Fenster. */
    const abschnittsWahlen = shallowRef(new Map<string, ReadonlySet<string> | null>());
    function setzeWahl(id: string, wahl: ReadonlySet<string> | null): void {
        const neu = new Map(abschnittsWahlen.value);
        if (wahl === null) neu.delete(id);
        else neu.set(id, wahl);
        abschnittsWahlen.value = neu;
    }
    /** Die Abschnitte der Straße, wie ihre Bearbeitung sie gelesen hat; ohne gelesene Straße keine. */
    const abschnitteVon = (id: string): readonly string[] =>
        bearbeitungen.value.get(id)?.detail.value?.segments.map((abschnitt) => abschnitt.id) ?? [];
    /** Je Bearbeitung ihr Verlauf; entsteht und geht mit ihr. */
    const verlaeufe = new Map<string, Verlauf<unknown>>();
    const nurLesen = (): boolean => entwurf?.darfSchreiben() !== true;

    const fenster = computed(() =>
        werkzeugfenster.stand.value.fenster
            .filter((eintrag) => eintrag.werkzeug === WEGEDITOR)
            .sort((a, b) => a.vorn - b.vorn),
    );
    /** Das vorderste sichtbare Wege-Fenster: Dort öffnen Verb, Handgriffe und Karte (D19). */
    const vorderstes = computed(() => fenster.value.filter((eintrag) => eintrag.lage !== "versenkt").at(-1));
    const auswahl = computed(() => vorderstes.value?.gegenstand);

    const titelVon = (id: string | undefined): string => {
        const zeile = liste.value?.rows.find((row) => row.id === id);
        return zeile === undefined
            ? t("wegeditor.fenster.titel")
            : `${t("wegeditor.fenster.titel")} · ${zeileVon(zeile).name}`;
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
        ladeWege(steuer.signal, fetcher).then(
            (geladen) => {
                if (laden !== steuer) return;
                liste.value = geladen;
                const kette = wartend;
                const abschnitt = wartenderAbschnitt;
                wartend = undefined;
                wartenderAbschnitt = undefined;
                if (kette !== undefined) {
                    const anker = ankerDer(kette);
                    if (anker !== undefined) {
                        folgeKlick(anker, abschnitt);
                        oeffneVorn(anker, true);
                    }
                }
            },
            (error: unknown) => {
                if (laden === steuer && !steuer.signal.aborted) ladeFehler.value = fehlerText(error);
            },
        );
    }

    // --- Je Straße eine Bearbeitung, solange ein Fenster sie trägt ---
    function neueBearbeitung(id: string, titel: string): WegBearbeitung {
        const art = createWegArt((eingabe, init) => fetcher(String(eingabe), init));
        const bearbeitung = createBearbeitung(art, {
            id,
            titel,
            sperre: entwurf?.sperre ?? OHNE_SPERRE,
            karte: { geaendert: (revision) => entwurf?.geaendert(revision) },
            speicher: entwurf?.speicher,
        });
        verlaeufe.get(id)?.destroy();
        verlaeufe.set(
            id,
            createVerlauf(createWegVerlaufsArt(), {
                id,
                bearbeitung,
                // ↺ ist geschrieben: die Kacheln neu; Liste und Straßen lesen über `neuLaden` neu (Anschluss in `app.vue`).
                zurueckgenommen: (revision) => entwurf?.geaendert(revision),
                fetcher: (eingabe, init) => fetcher(String(eingabe), init),
            }) as Verlauf<unknown>,
        );
        return Object.assign(bearbeitung, { art });
    }
    const stopBearbeitungen = watch(
        () => fenster.value.map((eintrag) => eintrag.gegenstand).filter((id): id is string => id !== undefined),
        (ids) => {
            const jetzt = bearbeitungen.value;
            const neu = new Map<string, WegBearbeitung>();
            for (const id of ids) neu.set(id, jetzt.get(id) ?? neueBearbeitung(id, titelVon(id)));
            for (const [id, alt] of jetzt)
                if (!neu.has(id)) {
                    alt.destroy();
                    verlaeufe.get(id)?.destroy();
                    verlaeufe.delete(id);
                }
            bearbeitungen.value = neu;
        },
        // Sofort: Wer ein Fenster öffnet, findet seine Bearbeitung gleich danach.
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

    /** Öffnet eine Straße an der Stelle eines Fensters (D19), sonst in einem neuen. Gibt das Fenster zurück. */
    function oeffneAn(an: string | undefined, id: string | undefined): string {
        if (liste.value === undefined && laden === undefined) ladeListe();
        const wunschFenster = { werkzeug: WEGEDITOR, gegenstand: id, titel: titelVon(id), nurLesen: nurLesen() };
        return an === undefined
            ? werkzeugfenster.oeffne(wunschFenster)
            : werkzeugfenster.oeffneAnStelle(an, wunschFenster);
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
        if (vonKarte && vorn === undefined) listenSchalter?.vorlaeufig(fensterId, true, WEGEDITOR);
        return fensterId;
    }

    /**
     * Der Anker einer Straße aus der Kette `name:<Name>` (die Auswahl auf der Karte kennt nur sie; `editorPathRowHasChain`): Ein Weg ist
     * sein Name.
     */
    function ankerDer(kette: string): string | undefined {
        return liste.value?.rows.find(
            (row) =>
                row.offMap !== true && row.deleted !== true && row.name !== "" && editorPathRowHasChain(row, kette),
        )?.id;
    }

    /** Das Fenster an einem Weg: aus dem Abschnitt über seinen Anker, aus der Kette, sobald die Liste da ist. */
    /**
     * Ein Klick auf der Karte nennt mit dem Abschnitt, was er gewählt hat (T24 (1)): der zweite Klick auf die gewählte Straße einen
     * Abschnitt, derselbe noch einmal und der erste Klick die ganze Straße. Die Leiste des Fensters folgt (P6 Variante C).
     */
    function folgeKlick(id: string, abschnitt: string | undefined): void {
        setzeWahl(id, abschnitt === undefined ? null : new Set([abschnitt]));
    }

    function zeigeWeg(weg: { readonly anchor: string } | { readonly chain: string }, abschnitt?: string): void {
        wunsch += 1;
        const meiner = wunsch;
        if ("chain" in weg) {
            const anker = liste.value === undefined ? undefined : ankerDer(weg.chain);
            if (anker !== undefined) {
                folgeKlick(anker, abschnitt);
                oeffneVorn(anker, true);
            } else {
                wartend = weg.chain;
                wartenderAbschnitt = abschnitt;
                if (liste.value === undefined && laden === undefined) ladeListe();
            }
            return;
        }
        // Der Anker ist selbst eine Zeile der Liste: gleich. Sonst fragt die Straße des Abschnitts nach ihrem Anker.
        if (liste.value?.rows.some((row) => row.id === weg.anchor) === true) {
            oeffneVorn(weg.anchor, true);
            return;
        }
        getJson<EditorPathStreet>(editorPathStreetUrl(weg.anchor), fetcher).then(
            (strasse) => {
                if (meiner === wunsch) oeffneVorn(strasse.id, true);
            },
            () => {
                if (meiner === wunsch) oeffneVorn(weg.anchor, true);
            },
        );
    }

    /** Die Bearbeitung der Straße eines Abschnitts: Anker erfragen, ihr Fenster vorn öffnen; ein neuerer Wunsch gewinnt. */
    async function bearbeitungFuer(abschnitt: string): Promise<WegBearbeitung | undefined> {
        wunsch += 1;
        const meiner = wunsch;
        let anker: string | undefined = abschnitt;
        if (liste.value?.rows.some((row) => row.id === abschnitt) !== true) {
            try {
                anker = (await getJson<EditorPathStreet>(editorPathStreetUrl(abschnitt), fetcher)).id;
            } catch {
                anker = undefined;
            }
        }
        if (meiner !== wunsch || anker === undefined) return undefined;
        oeffneVorn(anker, true);
        return bearbeitungen.value.get(anker);
    }

    // Nach dem Neuladen: gesicherte Entwürfe als abgelegte Fenster (R1, D19).
    for (const eintrag of gesicherte(entwurf?.speicher).filter((x) => x.art === "path")) {
        if (fenster.value.some((x) => x.gegenstand === eintrag.id)) continue;
        const fensterId = werkzeugfenster.oeffne({
            werkzeug: WEGEDITOR,
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

    // --- Die Mehrfachauswahl je Fenster (WI-0252, wie die Kraftlinien WI-0238) ---
    const AUS = { mehrfach: false, angehakt: [] as readonly string[] } as const;
    const mehrfach = shallowRef<ReadonlyMap<string, { mehrfach: boolean; angehakt: readonly string[] }>>(new Map());
    const sammlungen = shallowRef<ReadonlyMap<string, WegSammel>>(new Map());
    function setzeStand(fensterId: string, an: boolean, angehakt: readonly string[]): void {
        const neu = new Map(mehrfach.value);
        if (!an && angehakt.length === 0) neu.delete(fensterId);
        else neu.set(fensterId, { mehrfach: an, angehakt });
        mehrfach.value = neu;
        // Ab zwei angehakten Straßen eine Sammelansicht; ein anderer Satz Häkchen beginnt eine neue (die Auswahl ist flüchtig).
        const alt = sammlungen.value.get(fensterId);
        const ids = an && angehakt.length >= 2 ? angehakt : [];
        if (alt !== undefined && alt.ids.length === ids.length && alt.ids.every((id) => ids.includes(id))) return;
        alt?.destroy();
        const naechste = new Map(sammlungen.value);
        if (ids.length === 0) naechste.delete(fensterId);
        else naechste.set(fensterId, createWegSammel(ids, { fetcher, zeilen: () => liste.value?.rows ?? [] }));
        sammlungen.value = naechste;
    }
    /** Nach einer Änderung an Wegen: die Liste und die Straßen ohne Ungeschriebenes neu lesen. */
    function neuLaden(): void {
        if (liste.value !== undefined) ladeListe();
        for (const sammel of sammlungen.value.values()) void sammel.neuLesen();
        // Was das Verbinden über das Netz wusste, gilt nach einer Änderung an Wegen nicht mehr.
        pruefungen.value = new Map();
        // Eine Straße ohne laufende Bearbeitung liest neu, sobald ihr Fenster sie wieder braucht: Ihr Fenster geht neu auf.
        for (const eintrag of fenster.value) {
            const id = eintrag.gegenstand;
            const bearbeitung = id === undefined ? undefined : bearbeitungen.value.get(id);
            if (id === undefined || bearbeitung === undefined || bearbeitung.lage.value.aktiv) continue;
            bearbeitung.destroy();
            const neu = new Map(bearbeitungen.value);
            neu.set(id, neueBearbeitung(id, titelVon(id)));
            bearbeitungen.value = neu;
        }
    }
    // Der Reiter „Änderungen“ hat Wege zurückgenommen (WI-0265 B6a2): die Kacheln nachziehen, Liste und Straßen lesen neu (was ungeschrieben ist, bleibt).
    const stopWegMeldung = watch(wegMeldung, (meldung) => {
        if (meldung === undefined) return;
        entwurf?.geaendert(meldung.mapRevision);
        neuLaden();
    });
    // Ein geschlossenes Fenster nimmt seine Auswahl mit.
    const stopMehrfach = watch(fenster, (offen) => {
        const ids = new Set(offen.map((eintrag) => eintrag.id));
        for (const fensterId of [...mehrfach.value.keys()]) if (!ids.has(fensterId)) setzeStand(fensterId, false, []);
    });
    const markierung = computed((): readonly string[] => {
        const zeilen = new Map((liste.value?.rows ?? []).map((row) => [row.id, row] as const));
        const angehakt = [...mehrfach.value.values()].flatMap((stand) => (stand.mehrfach ? stand.angehakt : []));
        return [...new Set(angehakt.flatMap((id) => (zeilen.has(id) ? [wegMarke(zeilen.get(id)!)] : [])))];
    });
    const sichtbare = (): WerkzeugFenster[] => fenster.value.filter((eintrag) => eintrag.lage !== "versenkt");
    // --- „Auswahl zu neuem Weg“ (WI-0252) ---
    function auswahlVon(fensterId?: string): WegAuswahl | undefined {
        const eintrag = fensterId === undefined ? vorderstes.value : fenster.value.find((x) => x.id === fensterId);
        if (eintrag === undefined) return undefined;
        const sammel = sammlungen.value.get(eintrag.id);
        if (sammel !== undefined) {
            const strassen = sammel.ids.map((id) => sammel.strassen.value.get(id));
            return strassen.every((s) => s !== undefined) ? auswahlAus(strassen as EditorPathStreet[]) : undefined;
        }
        const id = eintrag.gegenstand;
        const strasse = id === undefined ? undefined : bearbeitungen.value.get(id)?.detail.value;
        const wahl = id === undefined ? null : (abschnittsWahlen.value.get(id) ?? null);
        // Der ganze Weg ist kein neuer Weg: Die Leiste muss einen Teil wählen.
        if (strasse === undefined || wahl === null || wahl.size >= strasse.segments.length) return undefined;
        return auswahlAus([strasse], wahl);
    }
    const neuerWegFrage = ref<string | undefined>(undefined);
    // Geht das Fenster zu oder wechselt die Auswahl ganz, gilt die Frage nicht mehr.
    const stopNeuerWeg = watch(fenster, (offen) => {
        if (neuerWegFrage.value !== undefined && !offen.some((x) => x.id === neuerWegFrage.value))
            neuerWegFrage.value = undefined;
    });
    async function neuerWeg(name: string): Promise<{ ok: true } | { ok: false; satz: string }> {
        const fensterId = neuerWegFrage.value;
        const auswahl = fensterId === undefined ? undefined : auswahlVon(fensterId);
        if (fensterId === undefined || auswahl === undefined) return { ok: false, satz: t("wegeditor.mehrfach.laedt") };
        const antwort = await schreibeNeuenWeg(fetcher, auswahl, name);
        if (!antwort.ok) {
            // Eine Revision hat sich bewegt: Liste und Auswahl neu lesen, die Frage bleibt.
            if (antwort.status === 409) {
                ladeListe();
                for (const sammel of sammlungen.value.values()) void sammel.neuLesen();
            }
            return {
                ok: false,
                satz:
                    antwort.status === 409 && antwort.fehler.code === "edit_conflict"
                        ? t("wegeditor.neuerWeg.konflikt")
                        : antwort.fehler.message,
            };
        }
        neuerWegFrage.value = undefined;
        const vorher = fenster.value.find((x) => x.id === fensterId)?.gegenstand;
        if (vorher !== undefined) setzeWahl(vorher, null);
        // Der neue Weg im selben Fenster, die Mehrfachauswahl ist erledigt (wie „Unter neues Obergebiet …“ der Gebiete).
        alsMehrfachauswahl(() => {
            setzeStand(fensterId, false, []);
            oeffneAn(fensterId, antwort.quittung.anker);
        });
        entwurf?.geaendert(antwort.quittung.mapRevision);
        ladeListe();
        return { ok: true };
    }

    // --- „Wege verbinden ›“ (WI-0252) ---
    /** Die Auswahl des vordersten Fensters als Abschnitte zum Verbinden: mehrere Wege, sonst die Leiste, (W) heißt alle. */
    function verbindenAuswahl(): VerbindenTeil[] | undefined {
        const eintrag = vorderstes.value;
        if (eintrag === undefined) return undefined;
        const sammel = sammlungen.value.get(eintrag.id);
        if (sammel !== undefined) {
            const strassen = sammel.ids.map((id) => sammel.strassen.value.get(id));
            return strassen.every((s) => s !== undefined)
                ? verbindenAuswahlAus(strassen as EditorPathStreet[])
                : undefined;
        }
        const id = eintrag.gegenstand;
        const strasse = id === undefined ? undefined : bearbeitungen.value.get(id)?.detail.value;
        if (strasse === undefined || id === undefined) return undefined;
        return verbindenAuswahlAus([strasse], abschnittsWahlen.value.get(id) ?? undefined);
    }
    /** Je Auswahl (ihr Schlüssel) die Prüfung des Servers, solange sie gilt; ein Fehler steht als `fehler`. */
    const pruefungen = shallowRef(new Map<string, PathVerbindenPruefung | "fehler">());
    const pruefend = new Map<string, Promise<void>>();
    function pruefe(teile: readonly VerbindenTeil[]): Promise<void> {
        const schluessel = pruefSchluessel(teile);
        if (pruefungen.value.has(schluessel)) return Promise.resolve();
        const laufend = pruefend.get(schluessel);
        if (laufend !== undefined) return laufend;
        const neu = ladePruefung(fetcher, teile)
            .then(
                (antwort): PathVerbindenPruefung | "fehler" => antwort,
                (): "fehler" => "fehler",
            )
            .then((stand) => {
                pruefend.delete(schluessel);
                pruefungen.value = new Map(pruefungen.value).set(schluessel, stand);
            });
        pruefend.set(schluessel, neu);
        return neu;
    }
    async function verbinde(vorlage: string): Promise<{ ok: true } | { ok: false; satz: string }> {
        const fensterId = vorderstes.value?.id;
        const teile = verbindenAuswahl();
        if (fensterId === undefined || teile === undefined) return { ok: false, satz: t("wegeditor.mehrfach.laedt") };
        const antwort = await schreibeVerbinden(fetcher, teile, vorlage);
        // Was der Server weiß, ist jetzt alt: Die nächste Auswahl prüft neu.
        pruefungen.value = new Map();
        if (!antwort.ok) {
            if (antwort.status === 409) {
                ladeListe();
                for (const sammel of sammlungen.value.values()) void sammel.neuLesen();
            }
            return {
                ok: false,
                satz:
                    antwort.status === 409 && antwort.fehler.code === "edit_conflict"
                        ? t("wegeditor.neuerWeg.konflikt")
                        : antwort.fehler.message,
            };
        }
        const vorher = fenster.value.find((x) => x.id === fensterId)?.gegenstand;
        if (vorher !== undefined) setzeWahl(vorher, null);
        alsMehrfachauswahl(() => setzeStand(fensterId, false, []));
        entwurf?.geaendert(antwort.quittung.mapRevision);
        ladeListe();
        // Der verbundene Abschnitt steht im Fenster an seiner Straße (der Anker kann ein anderer sein).
        zeigeWeg({ anchor: antwort.quittung.publicId });
        return { ok: true };
    }

    /** Die Zeile zu einer Marke der Karte: eine Straße über ihren Namen, ein namenloser Abschnitt über seine Kennung. */
    function zeileZurMarke(marke: string): string | undefined {
        if (marke.startsWith(WEG_NAME_MARKE)) return ankerDer(marke);
        return liste.value?.rows.find((row) => row.id === marke && row.offMap !== true && row.deleted !== true)?.id;
    }

    return {
        mehrfachVon: (fensterId) => mehrfach.value.get(fensterId) ?? AUS,
        setzeMehrfach: (fensterId, an) => setzeStand(fensterId, an, mehrfach.value.get(fensterId)?.angehakt ?? []),
        setzeAngehakt: (fensterId, angehakt) =>
            setzeStand(fensterId, mehrfach.value.get(fensterId)?.mehrfach ?? false, angehakt),
        sammelVon: (fensterId) => sammlungen.value.get(fensterId),
        markierung,
        umschaltBereit: () => sichtbare().length > 0,
        umschalteAufKarte(marke) {
            const vorn = sichtbare().at(-1);
            const zeile = zeileZurMarke(marke);
            if (vorn === undefined || zeile === undefined) return;
            const stand = mehrfach.value.get(vorn.id) ?? AUS;
            setzeStand(
                vorn.id,
                true,
                umschalteAufKarte({ an: stand.mehrfach, angehakt: stand.angehakt }, vorn.gegenstand, zeile),
            );
        },
        aufheben() {
            const an = [...mehrfach.value].filter(([, stand]) => stand.mehrfach || stand.angehakt.length > 0);
            for (const [fensterId] of an) setzeStand(fensterId, false, []);
            return an.length > 0;
        },
        auswahlVon,
        inAuswahl: (abschnitt) => auswahlVon()?.abschnitte.some((a) => a.publicId === abschnitt) === true,
        inMehrfach(abschnitt) {
            const sammel = vorderstes.value === undefined ? undefined : sammlungen.value.get(vorderstes.value.id);
            if (sammel === undefined) return false;
            return [...sammel.strassen.value.values()].some((s) => s.segments.some((a) => a.id === abschnitt));
        },
        async entfernenAuswahl() {
            const sammel = vorderstes.value === undefined ? undefined : sammlungen.value.get(vorderstes.value.id);
            if (sammel === undefined) return undefined;
            // Die Revisionen von jetzt, nicht die vom Anhaken: Das Blatt schreibt gegen sie.
            await sammel.neuLesen();
            const strassen = sammel.ids.map((id) => sammel.strassen.value.get(id));
            if (sammel.ladeFehler.value || strassen.some((s) => s === undefined)) return undefined;
            return {
                wege: strassen.length,
                abschnitte: (strassen as EditorPathStreet[]).flatMap((s) =>
                    s.segments.map((a) => ({ publicId: a.id, revision: a.revision })),
                ),
            };
        },
        neuerWegFrage,
        frageNeuerWeg(fensterId) {
            const ziel = fensterId ?? vorderstes.value?.id;
            if (ziel === undefined) return;
            werkzeugfenster.hervorholen(ziel);
            neuerWegFrage.value = ziel;
        },
        abbrechenNeuerWeg() {
            neuerWegFrage.value = undefined;
        },
        neuerWeg,
        verbindenAn(abschnitt, texte) {
            const teile = verbindenAuswahl();
            if (teile === undefined || !teile.some((t) => t.publicId === abschnitt)) return undefined;
            if (teile.length > PATH_VERBINDEN_MAX)
                return { wahlen: verbindenWahlen(teile, undefined, texte), grund: VERBINDEN_GRUND.zuViele };
            const stand = pruefungen.value.get(pruefSchluessel(teile));
            if (stand === undefined) void pruefe(teile);
            const pruefung = stand === undefined || stand === "fehler" ? undefined : stand;
            const grund: MessageKey | undefined =
                stand === undefined
                    ? "wegeditor.griff.grund.laedt"
                    : stand === "fehler"
                      ? VERBINDEN_GRUND.fehler
                      : stand.geht
                        ? undefined
                        : VERBINDEN_GRUND[stand.grund ?? "kette"];
            return { wahlen: verbindenWahlen(teile, pruefung, texte), grund };
        },
        verbindenBereit() {
            const teile = verbindenAuswahl();
            return teile === undefined || teile.length > PATH_VERBINDEN_MAX ? Promise.resolve() : pruefe(teile);
        },
        verbindenAbschnitte: () => verbindenAuswahl()?.map((t) => t.publicId) ?? [],
        verbinde,
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
        bearbeitungVon: (id) => (id === undefined ? undefined : bearbeitungen.value.get(id)),
        verlaufVon: (id) => {
            // Die Bearbeitung zuerst lesen: So rechnet Vue den Verlauf neu, wenn `neuLaden` sie samt Verlauf ersetzt.
            const bearbeitung = id === undefined ? undefined : bearbeitungen.value.get(id);
            return bearbeitung === undefined ? undefined : verlaeufe.get(bearbeitung.id);
        },
        waehle(id, fensterId) {
            const an = fensterId ?? vorderstes.value?.id;
            const eintrag = fenster.value.find((x) => x.id === an);
            if (eintrag !== undefined && eintrag.gegenstand === id) return;
            oeffneAn(an, id);
        },
        oeffneWerkzeug: () => void oeffneVorn(undefined, false),
        oeffneFuer: zeigeWeg,
        bearbeitungFuer,
        geoeffnet(subjekt, options, editorModus) {
            if (!editorModus || options.source !== "map" || options.still === true || subjekt.kind !== "path")
                return false;
            if (fenster.value.length === 0) return false;
            const area = options.known?.presentation?.area;
            zeigeWeg(subjekt, area?.kind === "path" ? area.segment : undefined);
            return true;
        },
        abschnittsWahl(id) {
            return id === undefined ? null : (abschnittsWahlen.value.get(id) ?? null);
        },
        schalteAbschnitt(id, abschnitt) {
            const alle = abschnitteVon(id);
            const jetzt = abschnittsWahlen.value.get(id) ?? null;
            const neu = new Set(jetzt ?? []);
            if (neu.has(abschnitt)) neu.delete(abschnitt);
            else neu.add(abschnitt);
            setzeWahl(id, neu.size === 0 || (alle.length > 0 && alle.every((a) => neu.has(a))) ? null : neu);
        },
        ganzerWeg(id) {
            setzeWahl(id, null);
        },
        neuLaden,
        ladeListe,
        destroy() {
            laden?.abort();
            stopMehrfach();
            stopWegMeldung();
            stopNeuerWeg();
            for (const sammel of sammlungen.value.values()) sammel.destroy();
            stopBearbeitungen();
            stopUngespeichert();
            stopTitel();
            for (const bearbeitung of bearbeitungen.value.values()) bearbeitung.destroy();
            for (const verlauf of verlaeufe.values()) verlauf.destroy();
        },
    };
}
