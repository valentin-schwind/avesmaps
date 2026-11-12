import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type {
    OperationReceipt,
    SpracheEditorDetail,
    SpracheEditorListe,
    SpracheEditorTeilflaeche,
    SpracheFlaecheNeuQuittung,
    SubjectRef,
} from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import { createListenEinstellung, type ListenEinstellung } from "../editor-liste/listen-einstellung";
import type { WerkzeugFenster } from "../editor-panel/fenster-verwaltung";
import type { Werkzeugfenster } from "../editor-panel/werkzeugfenster";
import { createBearbeitung, type Bearbeitung } from "../fenster/bearbeitung";
import { entwurfsTaste } from "../fenster/entwurf-kern";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { gesicherte } from "../fenster/entwurf-sicherung";
import { createVerlauf, type Verlauf } from "../fenster/entwurf-verlauf";
import type { ListenSchalter } from "../fenster/listen-schalter";
import type { OpenSubjectOptions } from "../info-panel/subject-selection";
import { t } from "../i18n/i18n";
import { createSpracheArt } from "./sprache-art";
import { NEUE_FARBE, pilleDazu, type SpracheFelder } from "./sprache-felder";
import { sprachMeldung } from "./sprache-melde";
import { createSpracheVerlaufsArt } from "./sprache-verlauf";
import { createSprachenDaten, type SprachenDaten } from "./sprachen-daten";
import type { SprachKopierZiel, SprachZiel } from "./sprachflaeche-kopieren";
import { SPRACHEN_OPTIONEN } from "./sprachen-liste";
import type { SprachSperre } from "./sprach-sperre";

/**
 * Was die Seite für den Spracheditor hält (WI-0261 S5d2; Muster `kraftlinieneditor/kraftlinieneditor-steuerung.ts`): die Liste der Sprachen
 * und freien Wiki-Artikel (einmal geladen, von allen Fenstern geteilt) samt Suche und Filter, und je Fenster EINE Sprache mit ihrer
 * Bearbeitung (`fenster/bearbeitung.ts`, Art `sprache-art.ts`) und ihrem Verlauf. `app.vue` hängt nur ein (`spracheditor-anbindung.ts`).
 *
 * - 🔴 **Je Sprache ein Fenster** (EDIT-0003 T44, D19, wie je Ort, Landschaft und Linie): Ein Klick in der Liste öffnet die Sprache an der
 *   Stelle dieses Fensters, das bisherige wandert mit seinem Entwurf nach „Offene Bearbeitungen“.
 * - **Eine Bearbeitung je Sprache** für Name, Legende, Farbe und Wiki-Artikel; „Fertig“ schreibt. Die Teilflächen schreibt jede für sich
 *   (Modus „Fläche bearbeiten“, „Teilfläche zeichnen“, Stilllegen); danach liest das Fenster die Sprache nach (`nachlesen`). Läuft gerade ein
 *   Entwurf der Felder, kommt der neue Stand der Teilflächen als Nebenstand (`detailVon`), damit der Entwurf nicht auf einem fremden Stand
 *   steht (die Teilflächen zählen die Revision der Sprache nicht hoch).
 * - **Stilllegen und Zurückholen** der Sprache gehen nur ohne offenen Entwurf (ein Entwurf bliebe sonst auf einem Stand stehen, den es nicht
 *   mehr gibt) und nehmen die Sperre für den einen Schreibweg.
 * - **Nach dem Neuladen** stehen im Browser gesicherte Entwürfe als abgelegte Fenster unter „Offene Bearbeitungen“ (R1, D19).
 * - **Zurückgenommen aus „Änderungen“** (WI-0265 B6e, `sprache-melde.ts`): Die Kacheln ziehen nach, die Liste liest neu, und jedes Fenster, das eine berührte Sprache trägt, liest sie samt
 *   Verlauf neu (mit laufendem Entwurf als Nebenstand). Der Verlauf selbst spielt nichts mehr zurück: Der Server nimmt es zurück (`sprache-verlauf.ts`).
 * - **Teilflächen von der Karte** (WI-0261 Stufe 1; Betreiber 2026-10-31: „ich kann auch teilfächen auf der karte nicht anklicken, sodass sie in der liste
 *   selektiert werden“): Ein Klick auf eine Teilfläche, ein Handgriff des Kartenmenüs und eine eben gezeichnete Teilfläche stellen das Fenster ihrer
 *   Sprache auf den Reiter „Flächen“, die Teilfläche gewählt (`zeigeFlaeche`; das Fenster liest `flaecheWunsch` wie der Landschaftseditor seine Wünsche).
 */
export const SPRACHEDITOR_WERKZEUG = "spracheditor";

export type SprachBearbeitung = Bearbeitung<SpracheEditorDetail, SpracheFelder, never>;

/** Was das Schreiben braucht; ohne bleibt der Editor lesend (Tests, Besucher). */
export interface SpracheEntwurfOptionen {
    /** Die geteilte Sperre der Sprachen (`sprach-sperre.ts`). */
    readonly sperre: SprachSperre;
    /** Der Lauf der Sperre der Seite: das Detail sagt damit, ob die Sperre die eigene ist. */
    readonly lauf?: string | undefined;
    /** Geschrieben: die Kachelrevision an die Karte. */
    geaendert(revision: number | undefined): void;
    readonly speicher?: Storage | undefined;
    /** Darf diese Sitzung Sprachen schreiben (Recht `edit_languages` und `MAP_EDITING`)? */
    darfSchreiben(): boolean;
}

/** Das Ergebnis eines Knopfs, der sofort schreibt: geschrieben, oder der Satz, warum nicht. */
export type SprachErgebnis =
    | { readonly ok: true; readonly mapRevision?: number | undefined; readonly id?: string }
    | { readonly ok: false; readonly satz: string };

/** Eine Teilfläche, die in dieser Sitzung stillgelegt wurde: Sie lässt sich mit ↺ zurückholen (das Detail nennt nur aktive). */
export interface StillgelegteTeilflaeche {
    readonly id: string;
    readonly flaeche: number;
    /** Die Revision nach dem Stilllegen: gegen sie holt ↺ zurück. */
    readonly revision: number;
}

/**
 * Was ein Klick auf eine Teilfläche (Karte, Kartenmenü, eben gezeichnet) vom Fenster ihrer Sprache will (WI-0261 Stufe 1): den Reiter „Flächen“ mit dieser
 * Teilfläche gewählt, mit `frage` die Bestätigung „Teilfläche entfernen“ offen. `mal` zählt, damit derselbe Wunsch zweimal wirkt.
 */
export interface FlaecheWunsch {
    readonly sprache: string;
    readonly flaeche: string;
    readonly frage: boolean;
    /** Das Blatt „Fläche kopieren“ steht offen (WI-0261 Stufe 3, „Kopieren …“ im Kartenmenü). */
    readonly kopieren?: true;
    readonly mal: number;
}

/**
 * „Unterfläche löschen …“ an einer Sprache (WI-0261 Stufe 3; Betreiber 2026-10-31: „Ja, nachfragen“): die offene Frage im Fenster der Sprache, an der
 * Teilfläche `flaeche` die Unterfläche `teil` (ab 0).
 */
export interface UnterflaechenFrage {
    readonly sprache: string;
    readonly flaeche: string;
    readonly teil: number;
}

export interface SpracheditorSteuerung {
    readonly daten: SprachenDaten;
    readonly liste: Readonly<ShallowRef<SpracheEditorListe | undefined>>;
    readonly ladeFehler: Readonly<Ref<string | undefined>>;
    readonly listenEinstellung: ListenEinstellung;
    /** Die Sprache des vordersten Sprachfensters. */
    readonly auswahl: ComputedRef<string | undefined>;
    /** Die offenen Fenster dieses Werkzeugs, das vorderste zuletzt. */
    readonly fenster: ComputedRef<WerkzeugFenster[]>;
    /** Das vorderste sichtbare Sprachfenster. */
    readonly vorderstes: ComputedRef<WerkzeugFenster | undefined>;
    bearbeitungVon(id: string | undefined): SprachBearbeitung | undefined;
    verlaufVon(id: string | undefined): Verlauf<unknown> | undefined;
    /** Der jüngste gelesene Stand der Sprache: nach einer Änderung an den Teilflächen der Nebenstand, sonst der der Bearbeitung. */
    detailVon(id: string | undefined): SpracheEditorDetail | undefined;
    /** Die in dieser Sitzung stillgelegten Teilflächen einer Sprache. */
    stillgelegteVon(id: string | undefined): readonly StillgelegteTeilflaeche[];
    /** Die Bearbeitung des vordersten Fensters, wenn dort gerade bearbeitet wird (Leiste, Tasten, Esc). */
    readonly aktiv: ComputedRef<SprachBearbeitung | undefined>;
    esc(): boolean;
    taste(event: KeyboardEvent): boolean;
    /** Ein Klick in der Liste eines Fensters (ohne Fenster: im vordersten): die Sprache an dessen Stelle (D19). */
    waehle(id: string | undefined, fensterId?: string): void;
    /** Das Verb „Sprachen bearbeiten“: holt das vorderste Fenster hervor oder öffnet eins. */
    oeffneWerkzeug(): void;
    /** Das Fenster an dieser Sprache (vorn oder neu); die Bearbeitung, sobald es steht. */
    oeffneFuer(id: string): SprachBearbeitung | undefined;
    /**
     * Ein Klick auf eine Sprache der Karte: Ein offenes Sprachfenster folgt ihr (wie das Wege-Fenster), öffnen tut der Klick nicht. Trifft er eine Teilfläche
     * (`options.teilflaeche`), steht sie gewählt im Reiter „Flächen“ (`zeigeFlaeche`).
     */
    geoeffnet(ref: SubjectRef, options: OpenSubjectOptions, editorModus: boolean): boolean;
    /** Der jüngste Wunsch an das Fenster einer Sprache, eine Teilfläche zu zeigen (`FlaecheWunsch`). */
    readonly flaecheWunsch: Readonly<ShallowRef<FlaecheWunsch | undefined>>;
    /** Das Fenster hat den Wunsch erfüllt: Er geht weg, damit er beim nächsten Öffnen nicht wiederkommt. */
    flaecheGesehen(): void;
    /** Die offene Frage „Unterfläche löschen …“; das Fenster dieser Sprache zeigt sie im Reiter „Flächen“. */
    readonly unterFrage: Readonly<ShallowRef<UnterflaechenFrage | undefined>>;
    /**
     * Fragt im Fenster der Sprache (vorn oder neu, Reiter „Flächen“, die Teilfläche gewählt, G3), ob die Unterfläche gelöscht wird; `true`: ja. Eine neue Frage,
     * Esc und das Ende der Steuerung beantworten eine offene mit nein.
     */
    frageUnterflaeche(frage: UnterflaechenFrage): Promise<boolean>;
    /** Die Antwort des Fensters (oder nein, wenn es die Frage nicht mehr zeigen kann). */
    antworteUnterflaeche(ja: boolean): void;
    /**
     * Das Fenster an dieser Sprache (vorn oder neu; von der Karte geöffnet mit eingeklappter Liste), Reiter „Flächen“, diese Teilfläche gewählt und in Sicht;
     * mit `frage` steht die Bestätigung „Teilfläche entfernen“ offen, mit `"kopieren"` das Blatt „Fläche kopieren“ (WI-0261 Stufe 3).
     */
    zeigeFlaeche(sprache: string, flaeche: string, frage?: boolean | "kopieren"): void;
    ladeListe(): void;
    /** Nach einer Änderung an Teilflächen oder Treffern: die Sprache neu lesen (als Nebenstand, solange ein Entwurf läuft). */
    nachlesen(id: string): Promise<void>;
    /** „✚ Neue Sprache“ und „Als neue Sprache anlegen“: anlegen, Liste neu, Fenster an der neuen Sprache. */
    legeAn(name: string, farbe?: string, wiki?: readonly string[]): Promise<SprachErgebnis>;
    /** „Einer Sprache zuordnen“: das Fenster an der Sprache, der Artikel als neue Pille im Entwurf. */
    ordneZu(spracheId: string, artikelId: string): void;
    /** Die Sprache stilllegen oder zurückholen (ohne offenen Entwurf). */
    stand(id: string, wechsel: "stilllegen" | "zurueckholen"): Promise<SprachErgebnis>;
    /** Eine Teilfläche stilllegen oder (aus dieser Sitzung) zurückholen. */
    teilflaeche(
        id: string,
        teil: Pick<SpracheEditorTeilflaeche, "id" | "revision" | "flaeche">,
        wechsel: "stilllegen" | "zurueckholen",
    ): Promise<SprachErgebnis>;
    /** „↻ Jetzt neu berechnen“: den Auftrag der Treffer für die Sprache einreihen. */
    neuRechnen(id: string): Promise<SprachErgebnis>;
    /**
     * „Kopieren“ im Blatt (WI-0261 Stufe 3, wie Werkzeug 8 der Derographie): die Teilfläche als Kopie in eine andere Sprache, bestehend oder neu (`neueSprache`,
     * Betreiber 2026-10-31: „Ja, auch neue“), mit `deleteSource` als Umziehen; EINE Operation unter der Sperre der Quelle und einer bestehenden Zielsprache (eine
     * neue braucht keine). Danach steht das Fenster an der Zielsprache mit der Kopie gewählt (wie die Ziellandschaft), die Liste ist neu geladen, die Quelle
     * nachgelesen. `id` im Ergebnis ist die Kopie.
     */
    kopiere(
        id: string,
        teil: Pick<SpracheEditorTeilflaeche, "id" | "revision">,
        ziel: SprachKopierZiel,
    ): Promise<SprachErgebnis>;
    /**
     * „Kopieren …“ einer Fläche der Derographie in eine Sprache (WI-0261; Betreiber 2026-10-31: „Ja, bauen“): EINE Operation `sprache.flaeche_aus_landschaft`
     * (`POST /api/editor/sprachen/aus-landschaft`). Die Sperre einer bestehenden Zielsprache wird für diesen einen Schreibweg genommen (eine neue braucht keine);
     * danach Kacheln und Liste neu, das Fenster an der Zielsprache (vorn oder neu) mit der neuen Teilfläche gewählt, die Sprache nachgelesen. `id` im Ergebnis
     * ist die neue Teilfläche. Die Landschaft bleibt unberührt.
     */
    kopiereAusLandschaft(
        quelle: { readonly regionId: string; readonly areaId: string },
        ziel: SprachZiel,
    ): Promise<SprachErgebnis>;
    destroy(): void;
}

/** Eine Bearbeitung, die nur liest (ohne Entwurfsoptionen): Die Sperre nimmt nie. */
const OHNE_SPERRE = {
    nimm: async () => ({ art: "fehler" as const, fehler: new ApiFailure(423, "map_editing_off", "") }),
    gib: () => undefined,
    beiVerlust: () => () => undefined,
    liste: async () => [],
};

/** Der Satz einer Antwort, die nicht geschrieben hat. */
function satzVon<Q>(antwort: Exclude<SchreibAntwort<Q>, { ok: true }>): string {
    return antwort.fehler.message === "" ? t("entwurf.sperrfehler") : antwort.fehler.message;
}

export function createSpracheditorSteuerung(
    werkzeugfenster: Werkzeugfenster,
    daten: SprachenDaten = createSprachenDaten(),
    /** Der gemeinsame Schalter der Listen: Von der Karte geöffnet, steht das Fenster mit eingeklappter Liste (EDIT-0003, Variante A). */
    listenSchalter?: Pick<ListenSchalter, "vorlaeufig">,
    entwurf?: SpracheEntwurfOptionen,
): SpracheditorSteuerung {
    const liste = shallowRef<SpracheEditorListe | undefined>(undefined);
    const ladeFehler = ref<string | undefined>(undefined);
    const listenEinstellung = createListenEinstellung({
        vorbelegt: SPRACHEN_OPTIONEN.vorbelegt,
        sortierung: "name",
        maske: "",
    });
    let laden: AbortController | undefined;
    const bearbeitungen = shallowRef(new Map<string, SprachBearbeitung>());
    const verlaeufe = new Map<string, Verlauf<unknown>>();
    /** Der Nebenstand je Sprache: nach einer Änderung an den Teilflächen gelesen, solange ein Entwurf der Felder läuft. */
    const nebenstand = shallowRef<ReadonlyMap<string, SpracheEditorDetail>>(new Map());
    const stillgelegt = shallowRef<ReadonlyMap<string, readonly StillgelegteTeilflaeche[]>>(new Map());
    const flaecheWunsch = shallowRef<FlaecheWunsch | undefined>(undefined);
    const unterFrage = shallowRef<UnterflaechenFrage | undefined>(undefined);
    let unterAntwort: ((ja: boolean) => void) | undefined;
    function antworteUnterflaeche(ja: boolean): void {
        const antwort = unterAntwort;
        unterAntwort = undefined;
        unterFrage.value = undefined;
        antwort?.(ja);
    }
    const nurLesen = (): boolean => entwurf?.darfSchreiben() !== true;

    const fenster = computed(() =>
        werkzeugfenster.stand.value.fenster
            .filter((eintrag) => eintrag.werkzeug === SPRACHEDITOR_WERKZEUG)
            .sort((a, b) => a.vorn - b.vorn),
    );
    const vorderstes = computed(() => fenster.value.filter((eintrag) => eintrag.lage !== "versenkt").at(-1));
    const auswahl = computed(() => vorderstes.value?.gegenstand);

    const nameVon = (id: string | undefined): string | undefined => {
        const zeile = liste.value?.zeilen.find((x) => x.art === "sprache" && x.id === id);
        return zeile?.art === "sprache" ? zeile.name : undefined;
    };
    const titelVon = (id: string | undefined, name?: string): string => {
        const gefunden = name ?? nameVon(id);
        return gefunden === undefined ? t("spracheditor.titel") : `${t("spracheditor.titel")} · ${gefunden}`;
    };

    function ladeListe(): void {
        laden?.abort();
        const steuer = new AbortController();
        laden = steuer;
        ladeFehler.value = undefined;
        daten.liste(steuer.signal).then(
            (geladen) => {
                if (laden === steuer) liste.value = geladen;
            },
            (error: unknown) => {
                if (laden !== steuer || steuer.signal.aborted) return;
                ladeFehler.value =
                    error instanceof ApiFailure && error.status === 403
                        ? t("editorListe.fehler.recht")
                        : t("editorListe.fehler");
            },
        );
    }

    function geschrieben(revision: number | undefined): void {
        entwurf?.geaendert(revision);
        ladeListe();
    }

    /** Teilflächen, die ein Zurücknehmen zurückgebracht hat, stehen nicht mehr als „in dieser Sitzung stillgelegt“ da (↺ holte sonst mit einer veralteten Revision zurück). */
    function vergissStillgelegte(flaechen: ReadonlySet<string>): void {
        if (flaechen.size === 0 || stillgelegt.value.size === 0) return;
        const neu = new Map<string, readonly StillgelegteTeilflaeche[]>();
        for (const [id, teile] of stillgelegt.value)
            neu.set(
                id,
                teile.filter((teil) => !flaechen.has(teil.id)),
            );
        stillgelegt.value = neu;
    }

    // --- Je Sprache eine Bearbeitung und ein Verlauf, solange ein Fenster sie trägt ---
    function neueBearbeitung(id: string, titel: string): SprachBearbeitung {
        return createBearbeitung(createSpracheArt(daten, entwurf?.lauf), {
            id,
            titel,
            sperre: entwurf?.sperre.halter() ?? OHNE_SPERRE,
            karte: { geaendert: geschrieben },
            speicher: entwurf?.speicher,
        });
    }
    const stopBearbeitungen = watch(
        () => fenster.value.map((eintrag) => eintrag.gegenstand).filter((id): id is string => id !== undefined),
        (ids) => {
            const jetzt = bearbeitungen.value;
            const neu = new Map<string, SprachBearbeitung>();
            for (const id of ids) {
                const da = jetzt.get(id);
                if (da !== undefined) {
                    neu.set(id, da);
                    continue;
                }
                const bearbeitung = neueBearbeitung(id, titelVon(id));
                neu.set(id, bearbeitung);
                if (entwurf !== undefined)
                    verlaeufe.set(
                        id,
                        createVerlauf(
                            createSpracheVerlaufsArt({
                                nachRuecknahme: (quittung) =>
                                    vergissStillgelegte(
                                        new Set(
                                            (quittung.affected ?? [])
                                                .filter((x) => x.kind === "sprache_flaeche")
                                                .map((x) => x.id),
                                        ),
                                    ),
                            }),
                            {
                                id,
                                bearbeitung,
                                zurueckgenommen: geschrieben,
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
        { immediate: true, flush: "sync" },
    );
    // Ein neu gelesener Stand der Bearbeitung ersetzt den Nebenstand.
    const stopNeben = watch(
        () => [...bearbeitungen.value.entries()].map(([id, b]) => [id, b.detail.value] as const),
        (paare) => {
            if (nebenstand.value.size === 0) return;
            const neu = new Map(nebenstand.value);
            for (const [id, d] of paare) {
                const neben = neu.get(id);
                if (neben !== undefined && d !== undefined && d.revision >= neben.revision && !aktivBei(id))
                    neu.delete(id);
            }
            if (neu.size !== nebenstand.value.size) nebenstand.value = neu;
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
    const stopListe = watch(
        () => vorderstes.value !== undefined,
        (sichtbar) => {
            if (sichtbar && liste.value === undefined && laden === undefined) ladeListe();
        },
        { immediate: true },
    );
    // Der Reiter „Änderungen“ hat Sprachen zurückgenommen (WI-0265 B6e, wie `landschaftseditor-steuerung.ts` bei den Flächen): die Kacheln nachziehen, die Liste neu lesen, in dieser Sitzung stillgelegte
    // Teilflächen, die nun wieder da sind, nicht mehr als „zurückholbar“ führen, und jedes Fenster, das eine berührte Sprache trägt, liest sie samt Verlauf neu. Ungeschriebenes bleibt (`nachlesen`).
    const stopSprachMeldung = watch(sprachMeldung, (meldung) => {
        if (meldung === undefined) return;
        entwurf?.geaendert(meldung.mapRevision);
        if (liste.value !== undefined) ladeListe();
        vergissStillgelegte(new Set(meldung.flaechen));
        for (const id of meldung.sprachen) {
            if (!bearbeitungen.value.has(id)) continue;
            void nachlesen(id);
            void verlaeufe.get(id)?.lade();
        }
    });
    const stopTitel = watch(liste, () => {
        for (const eintrag of fenster.value)
            if (eintrag.gegenstand !== undefined)
                werkzeugfenster.markiere(eintrag.id, { titel: titelVon(eintrag.gegenstand) });
    });

    const aktivBei = (id: string): boolean => bearbeitungen.value.get(id)?.lage.value.aktiv === true;

    function oeffneAn(an: string | undefined, id: string | undefined): string {
        if (liste.value === undefined && laden === undefined) ladeListe();
        const wunsch = { werkzeug: SPRACHEDITOR_WERKZEUG, gegenstand: id, titel: titelVon(id), nurLesen: nurLesen() };
        return an === undefined ? werkzeugfenster.oeffne(wunsch) : werkzeugfenster.oeffneAnStelle(an, wunsch);
    }

    /** Im vordersten Fenster, sonst in einem neuen; trägt schon ein Fenster die Sprache, kommt es hervor. */
    function oeffneVorn(id: string | undefined, vonKarte: boolean): string {
        const vorn = vorderstes.value;
        if (vorn !== undefined && (id === undefined || vorn.gegenstand === id)) {
            werkzeugfenster.hervorholen(vorn.id);
            if (liste.value === undefined && laden === undefined) ladeListe();
            return vorn.id;
        }
        const da = id === undefined ? undefined : fenster.value.find((eintrag) => eintrag.gegenstand === id);
        if (da !== undefined) {
            werkzeugfenster.hervorholen(da.id);
            return da.id;
        }
        const fensterId = oeffneAn(vorn?.id, id);
        if (vonKarte && vorn === undefined) listenSchalter?.vorlaeufig(fensterId, true, SPRACHEDITOR_WERKZEUG);
        return fensterId;
    }

    function zeigeFlaeche(sprache: string, flaeche: string, frage: boolean | "kopieren" = false): void {
        oeffneVorn(sprache, true);
        flaecheWunsch.value = {
            sprache,
            flaeche,
            frage: frage === true,
            ...(frage === "kopieren" ? { kopieren: true as const } : {}),
            mal: (flaecheWunsch.value?.mal ?? 0) + 1,
        };
    }

    // Nach dem Neuladen: gesicherte Entwürfe als abgelegte Fenster (R1, D19).
    for (const eintrag of gesicherte(entwurf?.speicher).filter((x) => x.art === "sprache")) {
        if (fenster.value.some((x) => x.gegenstand === eintrag.id)) continue;
        const fensterId = werkzeugfenster.oeffne({
            werkzeug: SPRACHEDITOR_WERKZEUG,
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

    const bearbeitungVon = (id: string | undefined): SprachBearbeitung | undefined =>
        id === undefined ? undefined : bearbeitungen.value.get(id);

    async function nachlesen(id: string): Promise<void> {
        const bearbeitung = bearbeitungen.value.get(id);
        if (bearbeitung !== undefined && !aktivBei(id)) {
            await bearbeitung.neuLesen();
            if (!aktivBei(id)) {
                if (nebenstand.value.has(id)) {
                    const neu = new Map(nebenstand.value);
                    neu.delete(id);
                    nebenstand.value = neu;
                }
                return;
            }
        }
        try {
            const gelesen = await daten.sprache(id, new AbortController().signal, entwurf?.lauf);
            if (gelesen === null) return;
            nebenstand.value = new Map(nebenstand.value).set(id, gelesen);
        } catch {
            // Ohne Verbindung bleibt der alte Stand; das nächste Lesen holt den neuen.
        }
    }

    /** Ein Schreibweg unter der Sperre der Sprache, mit dem Satz bei „gesperrt“. */
    async function unterSperre<Q extends OperationReceipt = OperationReceipt>(
        id: string,
        schreibe: () => Promise<SchreibAntwort<Q>>,
    ): Promise<SchreibAntwort<Q> | { readonly gesperrt: string }> {
        if (entwurf === undefined) return { gesperrt: t("entwurf.sperrfehler") };
        const ergebnis = await entwurf.sperre.unter(id, schreibe);
        if ("ok" in ergebnis) return ergebnis;
        return {
            gesperrt:
                ergebnis.art === "gesperrt"
                    ? t("entwurf.gesperrt", { wer: ergebnis.sperre.person.name })
                    : t("entwurf.sperrfehler"),
        };
    }

    /** Bekommt die Bearbeitung ihren Stand später (das Fenster ging eben erst auf), wartet die Änderung auf ihn. */
    function wennGeladen(bearbeitung: SprachBearbeitung, tu: () => void): void {
        if (bearbeitung.stand.value !== undefined) {
            tu();
            return;
        }
        const stop = watch(bearbeitung.stand, (stand) => {
            if (stand === undefined) return;
            stop();
            tu();
        });
    }

    return {
        daten,
        liste,
        ladeFehler,
        listenEinstellung,
        auswahl,
        fenster,
        vorderstes,
        aktiv,
        esc() {
            // Esc beantwortet eine offene Frage „Unterfläche löschen …“ mit nein, auch wenn der Fokus nicht im Fenster steht (der Modus wartet auf sie).
            if (unterFrage.value !== undefined) {
                antworteUnterflaeche(false);
                return true;
            }
            return aktiv.value?.esc() ?? false;
        },
        taste(event) {
            const bearbeitung = aktiv.value;
            const welche = bearbeitung === undefined ? undefined : entwurfsTaste(event);
            if (bearbeitung === undefined || welche === undefined) return false;
            if (welche === "wieder") bearbeitung.wieder();
            else bearbeitung.zurueck();
            return true;
        },
        bearbeitungVon,
        verlaufVon: (id) => (id === undefined || !bearbeitungen.value.has(id) ? undefined : verlaeufe.get(id)),
        detailVon: (id) =>
            id === undefined ? undefined : (nebenstand.value.get(id) ?? bearbeitungVon(id)?.detail.value),
        stillgelegteVon: (id) => (id === undefined ? [] : (stillgelegt.value.get(id) ?? [])),
        waehle(id, fensterId) {
            const an = fensterId ?? vorderstes.value?.id;
            const eintrag = fenster.value.find((x) => x.id === an);
            if (eintrag !== undefined && eintrag.gegenstand === id) return;
            oeffneAn(an, id);
        },
        oeffneWerkzeug: () => void oeffneVorn(undefined, false),
        oeffneFuer(id) {
            oeffneVorn(id, false);
            return bearbeitungen.value.get(id);
        },
        geoeffnet(subjekt, options, editorModus) {
            if (!editorModus || options.source !== "map" || options.still === true || subjekt.kind !== "sprache")
                return false;
            if (vorderstes.value === undefined) return false;
            if (options.teilflaeche === undefined) oeffneVorn(subjekt.id, true);
            else zeigeFlaeche(subjekt.id, options.teilflaeche);
            return true;
        },
        flaecheWunsch,
        flaecheGesehen() {
            flaecheWunsch.value = undefined;
        },
        unterFrage,
        frageUnterflaeche(frage) {
            antworteUnterflaeche(false);
            zeigeFlaeche(frage.sprache, frage.flaeche);
            unterFrage.value = frage;
            return new Promise<boolean>((antwort) => {
                unterAntwort = antwort;
            });
        },
        antworteUnterflaeche,
        zeigeFlaeche,
        ladeListe,
        nachlesen,
        async legeAn(name, farbe = NEUE_FARBE, wiki = []) {
            const antwort = await daten.legeAn({
                operationId: crypto.randomUUID(),
                name: name.trim(),
                farbe,
                ...(wiki.length > 0 ? { wiki: [...wiki] } : {}),
            });
            if (!antwort.ok) return { ok: false, satz: satzVon(antwort) };
            geschrieben(antwort.quittung.mapRevision);
            oeffneVorn(antwort.quittung.publicId, false);
            return { ok: true, mapRevision: antwort.quittung.mapRevision, id: antwort.quittung.publicId };
        },
        ordneZu(spracheId, artikelId) {
            oeffneVorn(spracheId, false);
            const bearbeitung = bearbeitungen.value.get(spracheId);
            if (bearbeitung === undefined) return;
            wennGeladen(bearbeitung, () =>
                bearbeitung.feld((felder) => ({ ...felder, wiki: pilleDazu(felder.wiki, artikelId) })),
            );
        },
        async stand(id, wechsel) {
            const d = nebenstand.value.get(id) ?? bearbeitungVon(id)?.detail.value;
            if (d === undefined) return { ok: false, satz: t("entwurf.lesefehler") };
            if (aktivBei(id)) return { ok: false, satz: t("verlauf.gesperrtBearbeitung") };
            const body = { operationId: crypto.randomUUID(), baseRevision: d.revision };
            const antwort = await unterSperre(id, () =>
                wechsel === "stilllegen" ? daten.stilllegen(id, body) : daten.zurueckholen(id, body),
            );
            if ("gesperrt" in antwort) return { ok: false, satz: antwort.gesperrt };
            if (!antwort.ok) return { ok: false, satz: satzVon(antwort) };
            geschrieben(antwort.quittung.mapRevision);
            await nachlesen(id);
            return { ok: true, mapRevision: antwort.quittung.mapRevision };
        },
        async teilflaeche(id, teil, wechsel) {
            const body = { operationId: crypto.randomUUID(), baseRevision: teil.revision };
            const antwort = await unterSperre(id, () =>
                wechsel === "stilllegen"
                    ? daten.flaecheStilllegen(id, teil.id, body)
                    : daten.flaecheZurueckholen(id, teil.id, body),
            );
            if ("gesperrt" in antwort) return { ok: false, satz: antwort.gesperrt };
            if (!antwort.ok) return { ok: false, satz: satzVon(antwort) };
            const nachher =
                antwort.quittung.affected.find((x) => x.kind === "sprache_flaeche" && x.id === teil.id)?.revision ??
                teil.revision + 1;
            const bisher = (stillgelegt.value.get(id) ?? []).filter((x) => x.id !== teil.id);
            stillgelegt.value = new Map(stillgelegt.value).set(
                id,
                wechsel === "stilllegen"
                    ? [...bisher, { id: teil.id, flaeche: teil.flaeche, revision: nachher }]
                    : bisher,
            );
            geschrieben(antwort.quittung.mapRevision);
            await nachlesen(id);
            return { ok: true, mapRevision: antwort.quittung.mapRevision };
        },
        async neuRechnen(id) {
            const antwort = await daten.neuRechnen(id);
            if (!antwort.ok) return { ok: false, satz: satzVon(antwort) };
            await nachlesen(id);
            return { ok: true };
        },
        async kopiere(id, teil, ziel) {
            const body = { operationId: crypto.randomUUID(), baseRevision: teil.revision, ...ziel };
            const schreibe = () => daten.flaecheKopieren(id, teil.id, body);
            // Die Sperre der Quelle immer, die einer bestehenden Zielsprache dazu: Die Kopie entsteht dort, und mit dem Haken geht die Quelle (der Server
            // verlangt beide). Eine neue Sprache gibt es vorher nicht; sie braucht keine.
            const antwort = await unterSperre(id, async (): Promise<SchreibAntwort<SpracheFlaecheNeuQuittung>> => {
                if (!("targetId" in ziel)) return schreibe();
                const innen = await unterSperre(ziel.targetId, schreibe);
                return "gesperrt" in innen
                    ? { ok: false, status: 409, fehler: { code: "object_locked", message: innen.gesperrt } }
                    : innen;
            });
            if ("gesperrt" in antwort) return { ok: false, satz: antwort.gesperrt };
            if (!antwort.ok) return { ok: false, satz: satzVon(antwort) };
            // Kacheln und Liste neu (eine neue Sprache steht danach darin), dann das Fenster an der Zielsprache mit der Kopie gewählt.
            geschrieben(antwort.quittung.mapRevision);
            const kopie = antwort.quittung.flaecheId;
            const zielSprache = antwort.quittung.spracheId ?? ("targetId" in ziel ? ziel.targetId : undefined);
            if (kopie !== undefined && zielSprache !== undefined) zeigeFlaeche(zielSprache, kopie);
            await Promise.all([nachlesen(id), ...(zielSprache === undefined ? [] : [nachlesen(zielSprache)])]);
            return {
                ok: true,
                mapRevision: antwort.quittung.mapRevision,
                ...(kopie === undefined ? {} : { id: kopie }),
            };
        },
        async kopiereAusLandschaft(quelle, ziel) {
            const body = {
                operationId: crypto.randomUUID(),
                regionId: quelle.regionId,
                areaId: quelle.areaId,
                ...ziel,
            };
            const schreibe = () => daten.ausLandschaft(body);
            const antwort = "targetId" in ziel ? await unterSperre(ziel.targetId, schreibe) : await schreibe();
            if ("gesperrt" in antwort) return { ok: false, satz: antwort.gesperrt };
            if (!antwort.ok) return { ok: false, satz: satzVon(antwort) };
            // Kacheln und Liste neu (eine neue Sprache steht danach darin), dann das Fenster an der Zielsprache mit der neuen Teilfläche gewählt (G3).
            geschrieben(antwort.quittung.mapRevision);
            const sprache = antwort.quittung.spracheId ?? ("targetId" in ziel ? ziel.targetId : undefined);
            const flaeche = antwort.quittung.flaecheId;
            if (sprache !== undefined && flaeche !== undefined) zeigeFlaeche(sprache, flaeche);
            if (sprache !== undefined) await nachlesen(sprache);
            return {
                ok: true,
                mapRevision: antwort.quittung.mapRevision,
                ...(flaeche === undefined ? {} : { id: flaeche }),
            };
        },
        destroy() {
            antworteUnterflaeche(false);
            laden?.abort();
            stopBearbeitungen();
            stopNeben();
            stopUngespeichert();
            stopListe();
            stopSprachMeldung();
            stopTitel();
            for (const bearbeitung of bearbeitungen.value.values()) bearbeitung.destroy();
            for (const verlauf of verlaeufe.values()) verlauf.destroy();
        },
    };
}
