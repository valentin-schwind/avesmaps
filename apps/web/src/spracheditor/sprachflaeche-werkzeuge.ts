import { computed, shallowRef, watch, type ComputedRef } from "vue";
import type { SpracheEditorFlaecheForm, SpracheFlaecheUmformenBody } from "@avesmaps3d/shared";
import {
    createBearbeitung,
    type Bearbeitung,
    type BearbeitungsArt,
    type BearbeitungsZustand,
    type Stand,
} from "../fenster/bearbeitung";
import { bereitVon, type FlaechenQuelle } from "../map/geometrie/flaechen-quelle";
import { teileAus, type FormMeldung, type FormStand } from "../map/geometrie/formentwurf";
import { formHinweis } from "../map/geometrie/formentwurf-texte";
import { aufbauAus } from "../map/geometrie/formoperation";
import type { SperrHalter } from "./sprach-sperre";
import type { SprachenDaten } from "./sprachen-daten";
import { ausKennung, polygoneAus } from "./sprachflaeche-form";

/**
 * Der EINE Entwurf der Form einer Teilfläche einer Sprache (WI-0261 Stufe 2; Betreiber 2026-10-31, wörtlich: „beim editieren der sprachflächen wär es
 * gut, wenn wir die tools des flächeneditors hätten“, danach „stufe 2“): die Teilfläche als Quelle (`map/geometrie/flaechen-quelle.ts`) für DIESELBEN Modi
 * wie an der Fläche der Derographie („Verschieben“, „Fläche malen“, „Fläche radieren“, „Fläche vereinfachen“, `landschaftseditor/flaeche-*.ts`), mit
 * deren Leisten, Vorschau und Besitzer der Karte; „Teilfläche bearbeiten“ (`sprachflaeche-form.ts`) hängt am selben Entwurf. Was die Sprache anders hat:
 *
 * - 🔴 **Ein Entwurf je Teilfläche** (EDIT-0003 G4, Betreiber 2026-10-31): eine Bearbeitung des gemeinsamen Rumpfs (`fenster/bearbeitung.ts`) ohne Felder;
 *   die Form ist der Entwurf. Jedes Werkzeug ändert nur ihn (ein Schritt je Absetzen, Strich, Reglerstellung, Ecke), erst „Fertig“ schreibt EINE Operation
 *   `sprache_flaeche.reshape` gegen die Revision der Teilfläche (die ganze Form, im Aufbau vom Lesen; nach einem Pinselstrich nach seinen Stücken).
 * - **Gesperrt wird die Sprache** (Teil `form`) über einen eigenen Halter der geteilten Sperre (`sprach-sperre.ts`).
 * - **Kein Fenster trägt den Entwurf**: Endet der Modus, endet die Bearbeitung; was noch ungeschrieben war, ist verworfen, die Sperre frei. Im Browser
 *   gesichert wird nichts. Es läuft immer nur ein Modus: Ein neuer schließt, was noch offen ist.
 * - **Keine Nachbarn, keine Flüsse** (E2, E4: Flächen sind unabhängig und rasten nicht ein): Vereinfachen hält keine Ecke fest und sagt das auch nicht
 *   (`mitNachbarn`), Verschieben löst nichts.
 * - **Malen und Radieren** rechnet `POST …/sprachen/:id/flaechen/:flaeche/brush` (nichts geschrieben).
 * - **Geschrieben:** Kacheln neu (`geaendert`), das Fenster liest die Sprache nach, die Teilfläche bleibt dort gewählt (`gespeichert`). Den Auftrag
 *   `sprache_treffer` reiht der Server mit `reshape` ein. Den Satz „gespeichert“ sagt der Modus selbst.
 * - 🔴 **Konflikt und abgelaufene Sperre** (EDIT-0003 §3b R1): Der Entwurf bleibt; im Fenster der Sprache stehen Konfliktkasten und Fuß der Derographie
 *   (`fenster/entwurf-konflikt.vue`, `fenster/entwurf-fuss.vue`) an dieser Bearbeitung, mit „anwenden · übernehmen · überschreiben“ (`bearbeitungVon`).
 *   Damit es ein Fenster dafür gibt, holt `konflikt` die Sprache hervor.
 * - **Nicht geschrieben** sonst (fremde Sperre beim Start, Sperrfehler, Ablehnung): der Satz des Formentwurfs als Hinweis (`formHinweis`).
 */

export type SprachflaecheBearbeitung = Bearbeitung<SpracheEditorFlaecheForm, null, FormStand>;

/** Die Art einer Bearbeitung der Teilfläche: keine Felder, die Form ist der Entwurf, „Fertig“ ist `sprache_flaeche.reshape`. */
export function sprachflaecheArt(
    daten: Pick<SprachenDaten, "form" | "flaecheUmformen">,
    spracheId: string,
    flaecheId: string,
): BearbeitungsArt<SpracheEditorFlaecheForm, null, FormStand, SpracheFlaecheUmformenBody> {
    const polygone = (d: SpracheEditorFlaecheForm, vorher: FormStand, jetzt: FormStand) =>
        polygoneAus({ flaecheId: d.id, aufbau: aufbauAus([d]).get(d.id) ?? [] }, vorher, jetzt);
    const gelesen = (d: SpracheEditorFlaecheForm): FormStand => ({ teile: teileAus([d], ""), nachbarn: [] });
    const geaendert = (d: SpracheEditorFlaecheForm, stand: Stand<null, FormStand>): string[] =>
        stand.form !== undefined && polygone(d, gelesen(d), stand.form) !== undefined ? ["form"] : [];
    return {
        sperrArt: "sprache",
        async lade(_id, signal) {
            const form = await daten.form(spracheId, flaecheId, signal);
            return form === null || !form.aktiv ? null : form;
        },
        felder: () => null,
        operation(d, start, jetzt, operationId) {
            if (start.form === undefined || jetzt.form === undefined) return undefined;
            const polygons = polygone(d, start.form, jetzt.form);
            return polygons === undefined ? undefined : { operationId, baseRevision: d.revision, polygons };
        },
        schreibe: (_id, body) => daten.flaecheUmformen(spracheId, flaecheId, body),
        geaendert,
        fremde: (vorher, jetzt) => (vorher.revision === jetzt.revision ? [] : ["form"]),
        // Die eigene Form auf den neuen Stand: Hat der Stand sie geändert, bleibt sie („überschreiben“); sonst gilt die neue (der Start rückt nach).
        aufNeuenStand: (vorher, jetzt, stand) =>
            stand.form === undefined || geaendert(vorher, stand).length > 0
                ? stand
                : { felder: null, form: gelesen(jetzt) },
    };
}

export interface SprachflaechenWerkzeugeOptionen {
    readonly daten: Pick<SprachenDaten, "form" | "flaecheUmformen" | "flaechePinsel">;
    /** Ein eigener Halter der geteilten Sperre der Sprachen. */
    readonly sperre: SperrHalter;
    /** Das Werkzeug des Spracheditors: Seine Liste zieht ein, solange ein Modus läuft. */
    readonly werkzeug: string;
    /** Darf diese Sitzung Sprachen schreiben? Sonst beginnt nichts. */
    darf(): boolean;
    /** Geschrieben: die Kacheln der Sprachen mit dieser Revision neu. */
    geaendert(revision: number | undefined): void;
    /** Geschrieben: Das Fenster liest die Sprache nach, die Teilfläche bleibt gewählt. */
    gespeichert(spracheId: string, flaecheId: string): void;
    /** Ein Konflikt oder eine abgelaufene Sperre: das Fenster an der Sprache, mit der Teilfläche gewählt (dort steht der Kasten, R1). */
    konflikt(spracheId: string, flaecheId: string): void;
    /** Ein Hinweis unten (Toast). */
    melde(text: string, ton?: "warning" | "success"): void;
}

export interface SprachflaechenWerkzeuge {
    /**
     * Die Quelle für die Modi; `name` steht in Leiste und Hinweis (etwa „Garethi · Teilfläche 3“). Die Kennung, mit der ein Modus startet, ist
     * `laufKennung(sprache, flaeche)` (`sprachflaeche-form.ts`).
     */
    quelle(name: string): FlaechenQuelle<SprachflaecheBearbeitung>;
    /** Die Sprache, an deren Teilfläche gerade ein Werkzeug den Entwurf hält (die Form hängt an); sonst keine. */
    readonly laeuft: ComputedRef<string | undefined>;
    /** Die offene Bearbeitung einer Teilfläche dieser Sprache, für Konfliktkasten und Fuß im Fenster; sonst keine. */
    bearbeitungVon(spracheId: string | undefined): SprachflaecheBearbeitung | undefined;
    destroy(): void;
}

/**
 * Was eine Bearbeitung meldet, die nicht geschrieben hat, in den Worten des Formentwurfs; sonst nichts. Ein Konflikt steht nicht hier, sondern als
 * Kasten im Fenster (R1).
 */
export function nichtGeschrieben(zustand: BearbeitungsZustand<unknown>, name: string): FormMeldung | undefined {
    switch (zustand.art) {
        case "gesperrt":
            return { art: "gesperrt", name, wer: zustand.wer };
        case "sperrfehler":
            return { art: "sperrfehler", name };
        case "abgelehnt":
            return { art: "abgelehnt", satz: zustand.satz };
        default:
            return undefined;
    }
}

export function createSprachflaechenWerkzeuge(optionen: SprachflaechenWerkzeugeOptionen): SprachflaechenWerkzeuge {
    const { daten, sperre } = optionen;
    /** Die offene Bearbeitung; es läuft immer nur ein Werkzeug, und ein neues schließt, was noch offen ist. */
    const offen = shallowRef<
        { readonly sprache: string; readonly bearbeitung: SprachflaecheBearbeitung; ende(): void } | undefined
    >(undefined);

    function schliesse(): void {
        const eintrag = offen.value;
        if (eintrag === undefined) return;
        offen.value = undefined;
        eintrag.ende();
    }

    function oeffne(kennung: string, spracheId: string, flaecheId: string, name: string): SprachflaecheBearbeitung {
        schliesse();
        /** Geschlossen: Eine Sperre, die erst danach ankommt (Esc gleich nach dem Start), geht sofort zurück; sonst hielte die Seite die Sprache ohne Entwurf. */
        let geschlossen = false;
        const bearbeitung = createBearbeitung(sprachflaecheArt(daten, spracheId, flaecheId), {
            id: kennung,
            sperrId: spracheId,
            titel: name,
            // Ohne Freigabe auf Bitte: Die bietet das Fenster der Sprache an (sein Entwurf der Felder); dieser Entwurf lebt nur so lange wie sein Modus.
            sperre: {
                async nimm(ziel, teil) {
                    const ergebnis = await sperre.nimm(ziel, teil);
                    if (geschlossen && ergebnis.art === "genommen") sperre.gib(ziel);
                    return ergebnis;
                },
                gib: sperre.gib,
                beiVerlust: sperre.beiVerlust,
            },
            karte: { geaendert: (revision) => optionen.geaendert(revision) },
        });
        const stop = watch(
            () => bearbeitung.zustand.value,
            (zustand) => {
                if (zustand.art === "gespeichert") {
                    optionen.gespeichert(spracheId, flaecheId);
                    return;
                }
                if (zustand.art === "konflikt") {
                    optionen.konflikt(spracheId, flaecheId);
                    return;
                }
                const meldung = nichtGeschrieben(zustand, name);
                if (meldung === undefined) return;
                const { text, ton } = formHinweis(meldung, { ladefehler: "spracheditor.form.ladefehler" });
                optionen.melde(text, ton);
            },
            { flush: "sync" },
        );
        const eintrag = {
            sprache: spracheId,
            bearbeitung,
            ende() {
                geschlossen = true;
                stop();
                bearbeitung.destroy();
            },
        };
        offen.value = eintrag;
        return {
            ...bearbeitung,
            formEntwurf(teil) {
                const sicht = bearbeitung.formEntwurf(teil);
                /** Hängt die Form an? Ein Modus leert auch, bevor er beginnt (`starte` beendet zuerst); das schließt nichts. */
                let dran = false;
                return {
                    ...sicht,
                    beginne(g0) {
                        dran = true;
                        sicht.beginne(g0);
                    },
                    leere() {
                        sicht.leere();
                        if (!dran) return;
                        dran = false;
                        // Der Modus endet, also auch der Entwurf (kein Fenster trägt ihn). Erst nach dem laufenden Schritt: „Fertig“ meldet
                        // „gespeichert“ erst, nachdem der Modus abgehängt hat.
                        queueMicrotask(() => {
                            if (offen.value === eintrag) schliesse();
                        });
                    },
                };
            },
        };
    }

    return {
        quelle: (name) => ({
            bearbeitung(kennung) {
                const teile = ausKennung(kennung);
                if (teile === undefined || !optionen.darf()) return undefined;
                return oeffne(kennung, teile.sprache, teile.flaeche, name);
            },
            // Die Bearbeitung liest die Form selbst; sie ist die eine Teilfläche, ohne Nachbarn und Flüsse.
            async lade(_kennung, bearbeitung) {
                if (!(await bereitVon(bearbeitung))) return null;
                const d = bearbeitung.detail.value;
                return d === undefined ? null : { name, flaechen: [d], nachbarn: [], fluesse: [] };
            },
            async strich(kennung, flaecheId, strich) {
                const teile = ausKennung(kennung);
                if (teile === undefined) return { ok: false, satz: "" };
                const antwort = await daten.flaechePinsel(teile.sprache, flaecheId, strich);
                return antwort.ok
                    ? { ok: true, polygons: antwort.quittung.polygons }
                    : { ok: false, satz: antwort.fehler.message };
            },
            getragen: () => true,
            werkzeug: optionen.werkzeug,
            mitNachbarn: false,
        }),
        bearbeitungVon: (spracheId) => {
            const eintrag = offen.value;
            return eintrag !== undefined && eintrag.sprache === spracheId ? eintrag.bearbeitung : undefined;
        },
        laeuft: computed(() => {
            const eintrag = offen.value;
            return eintrag?.bearbeitung.lage.value.form === true ? eintrag.sprache : undefined;
        }),
        destroy: schliesse,
    };
}
