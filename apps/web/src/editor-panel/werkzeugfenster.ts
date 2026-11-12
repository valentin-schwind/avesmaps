import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { FensterBox } from "../fenster/fenster-lage";
import { imMehrfachauswahlHandgriff } from "../editor-liste/mehrfachauswahl";
import type { Speicher } from "./editor-panel-nav";
import {
    LEERER_STAND,
    abgelegt,
    angedockt,
    ausInfoZurueck,
    hervorholen,
    infoLasche,
    leseGemerkt,
    markiere,
    merkSchluessel,
    nachVorn,
    oeffne,
    oeffneAnStelle,
    schliesse,
    schliesseAlle,
    schliesseZeile,
    setzeLage,
    verwirf,
    vorderstes,
    type AnStelle,
    type FensterLage,
    type FensterStand,
    type Oeffnen,
    type SchliessFrage,
    type SichtbareLage,
    type WerkzeugFenster,
} from "./fenster-verwaltung";

/**
 * Die offenen Werkzeugfenster als Zustand der Seite (WI-0128 E6): `fenster-verwaltung.ts` rechnet, hier steht der Stand, den das
 * Editorpanel („Offene Bearbeitungen“) und die Fenster selbst lesen. Dazu merkt der Browser je Werkzeug die zuletzt gewählte
 * sichtbare Lage und die Box des gelösten Fensters (EDIT-0001 §4.1, T6.4; `try/catch`, ohne Speicher angedockt).
 *
 * Am Telefon gibt es nur „angedockt“ und „versenkt“ (EDIT-0001 §4.1): Ein gelöstes Fenster wird dort angedockt gezeichnet.
 */
export interface Werkzeugfenster {
    readonly stand: Readonly<ShallowRef<FensterStand>>;
    readonly vorderstes: ComputedRef<WerkzeugFenster | undefined>;
    readonly abgelegt: ComputedRef<WerkzeugFenster[]>;
    /** `vorgabe`: die Lage, wenn für dieses Werkzeug nichts gemerkt ist (Ortseditor angedockt, Medienverwaltung gelöst). */
    oeffne(wunsch: Omit<Oeffnen, "lage" | "box">, vorgabe?: SichtbareLage): string;
    /**
     * D19: an der Stelle des Fensters `an` öffnen, das bisherige wird abgelegt. Während eines Handgriffs der Mehrfachauswahl
     * (`alsMehrfachauswahl`) oder mit `ohneEntwurfSchliessen` geht es ohne Entwurf zu.
     */
    oeffneAnStelle(an: string | undefined, wunsch: Omit<Oeffnen, "lage" | "box">, optionen?: AnStelle): string;
    setzeLage(id: string, lage: FensterLage, box?: FensterBox): void;
    setzeBox(id: string, box: FensterBox): void;
    hervorholen(id: string): void;
    nachVorn(id: string): void;
    /** ✕ und Escape: schließt ohne Änderungen, legt mit Änderungen ab (nie verwerfen). */
    schliesse(id: string): void;
    /** „Verwerfen“: Das Fenster geht zu, und sein Werkzeug verwirft den Entwurf darin (`beimVerwerfen`). */
    verwirf(id: string): void;
    /** ✕ an einer Zeile unter „Offene Bearbeitungen“: ohne Entwurf zu, mit Entwurf die Frage (WI-0231). */
    schliesseZeile(id: string): SchliessFrage | undefined;
    /** „Alle schließen“: was ohne Entwurf ist, geht zu; für die Entwürfe die EINE Frage (WI-0231). */
    alleSchliessen(): SchliessFrage | undefined;
    /**
     * Was ein Werkzeug tut, wenn eines seiner Fenster verworfen wird, bevor es aus dem Stand geht: den Entwurf darin verwerfen, mit Sperre
     * und Sicherung im Browser. Sonst ginge nur die Zeile, und nach dem Neuladen stünde der Entwurf aus der Sicherung wieder da.
     */
    beimVerwerfen(tu: (fenster: WerkzeugFenster) => void): () => void;
    markiere(id: string, aenderung: Parameters<typeof markiere>[2]): void;
    /** Die Lasche „Info“ legt das angedockte Fenster ab. */
    infoLasche(): void;
    /** Die Lasche „Editor“ holt das Fenster zurück, das die Lasche „Info“ abgelegt hat (EDIT-0001 §4.5 Nr. 6). */
    editorLasche(): void;
    /** Wo ein neues Fenster dieses Werkzeugs erscheinen würde (gemerkt, sonst `vorgabe`, sonst angedockt): Ziel des Hinflugs (E7). */
    neueLage(werkzeug: string, vorgabe?: SichtbareLage): Pick<Oeffnen, "lage" | "box">;
}

function lies(speicher: Speicher | undefined, schluessel: string): string | null {
    try {
        return speicher?.getItem(schluessel) ?? null;
    } catch {
        return null;
    }
}

function schreib(speicher: Speicher | undefined, schluessel: string, wert: string): void {
    try {
        speicher?.setItem(schluessel, wert);
    } catch {
        // Ohne Speicher gilt die Lage bis zum Neuladen.
    }
}

export function createWerkzeugfenster(speicher: Speicher | undefined): Werkzeugfenster {
    const stand = shallowRef<FensterStand>(LEERER_STAND);
    const verwerfer = new Set<(fenster: WerkzeugFenster) => void>();
    /** Was die Lasche „Info“ zuletzt abgelegt hat; die Lasche „Editor“ holt es zurück. */
    let vonInfo: string | undefined;

    /** Merkt die sichtbare Lage und die Box eines Werkzeugs (nicht „versenkt“: das ist eine Ablage, keine Lage). */
    function merke(fenster: WerkzeugFenster | undefined): void {
        if (!fenster || fenster.lage === "versenkt") return;
        schreib(
            speicher,
            merkSchluessel(fenster.werkzeug),
            JSON.stringify(
                fenster.box === undefined ? { lage: fenster.lage } : { lage: fenster.lage, box: fenster.box },
            ),
        );
    }
    const finde = (id: string): WerkzeugFenster | undefined => stand.value.fenster.find((x) => x.id === id);

    const gemerkt = (werkzeug: string): Pick<Oeffnen, "lage" | "box"> => {
        const wert = leseGemerkt(lies(speicher, merkSchluessel(werkzeug)));
        return wert === undefined ? {} : { lage: wert.lage, box: wert.box };
    };

    return {
        stand,
        vorderstes: computed(() => vorderstes(stand.value)),
        abgelegt: computed(() => abgelegt(stand.value)),
        oeffne(wunsch, vorgabe) {
            const ergebnis = oeffne(stand.value, {
                ...(vorgabe === undefined ? {} : { lage: vorgabe }),
                ...gemerkt(wunsch.werkzeug),
                ...wunsch,
            });
            stand.value = ergebnis.stand;
            return ergebnis.id;
        },
        oeffneAnStelle(an, wunsch, optionen) {
            const ergebnis = oeffneAnStelle(stand.value, an, wunsch, {
                ohneEntwurfSchliessen: optionen?.ohneEntwurfSchliessen ?? imMehrfachauswahlHandgriff(),
            });
            stand.value = ergebnis.stand;
            return ergebnis.id;
        },
        setzeLage(id, lage, box) {
            stand.value = setzeLage(stand.value, id, lage, box);
            merke(finde(id));
        },
        setzeBox(id, box) {
            const fenster = finde(id);
            if (!fenster) return;
            stand.value = setzeLage(stand.value, id, fenster.lage, box);
            merke(finde(id));
        },
        hervorholen(id) {
            stand.value = hervorholen(stand.value, id);
        },
        nachVorn(id) {
            stand.value = nachVorn(stand.value, id);
        },
        schliesse(id) {
            stand.value = schliesse(stand.value, id);
        },
        verwirf(id) {
            const fenster = finde(id);
            if (fenster) for (const tu of verwerfer) tu(fenster);
            stand.value = verwirf(stand.value, id);
        },
        schliesseZeile(id) {
            const ergebnis = schliesseZeile(stand.value, id);
            stand.value = ergebnis.stand;
            return ergebnis.frage;
        },
        alleSchliessen() {
            const ergebnis = schliesseAlle(stand.value);
            stand.value = ergebnis.stand;
            return ergebnis.frage;
        },
        beimVerwerfen(tu) {
            verwerfer.add(tu);
            return () => verwerfer.delete(tu);
        },
        markiere(id, aenderung) {
            stand.value = markiere(stand.value, id, aenderung);
        },
        infoLasche() {
            vonInfo = angedockt(stand.value)?.id;
            stand.value = infoLasche(stand.value);
        },
        editorLasche() {
            stand.value = ausInfoZurueck(stand.value, vonInfo);
            vonInfo = undefined;
        },
        neueLage(werkzeug, vorgabe) {
            const lage = gemerkt(werkzeug);
            return { lage: lage.lage ?? vorgabe ?? "angedockt", box: lage.box };
        },
    };
}
