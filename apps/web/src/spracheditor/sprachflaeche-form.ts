import { shallowRef, watch, type ShallowRef, type WatchStopHandle } from "vue";
import type { EditorLockTarget, SpracheEditorFlaecheForm, SprachePolygone } from "@avesmaps3d/shared";
import type { Entwurf } from "../fenster/entwurf-kern";
import { SPRACHE } from "../map/geometrie/arten";
import { bereitVon } from "../map/geometrie/flaechen-quelle";
import {
    createFormentwurf,
    teileAus,
    type FormKarte,
    type FormStand,
    type FormStart,
    type Formentwurf,
} from "../map/geometrie/formentwurf";
import { aufbauAus, operationAus } from "../map/geometrie/formoperation";
import type { SperrHalter } from "./sprach-sperre";
import type { SprachflaecheBearbeitung, SprachflaechenWerkzeuge } from "./sprachflaeche-werkzeuge";

/**
 * „◇ Fläche bearbeiten“ an EINER Teilfläche einer Sprache (WI-0261 S5d2; Bauvorlage `karte.js` `startBearbeiten`, Modusleiste „Fläche
 * bearbeiten“ mit „n ungespeichert“, ↶ ↷, Verwerfen, Fertig) als Quelle des gemeinsamen Formentwurfs (`map/geometrie/formentwurf.ts`); Ablauf,
 * Entwurf, Esc und Frage stehen dort. Was die Sprache anders hat:
 *
 * - **Art** `SPRACHE`: eckig, 🔴 ohne Einrasten und ohne Mitziehen (E4; Flächen sind unabhängig und dürfen sich überlappen, E2). Darum gibt
 *   es keine Nachbarn und keine Ziele.
 * - **Gesperrt wird die Sprache** (der Vertrag kennt keine Sperre je Teilfläche), Teil `form`, über einen eigenen Halter der geteilten
 *   Sperre (`sprach-sperre.ts`): Ein offener Entwurf der Felder derselben Sprache behält sie, wenn der Modus endet.
 * - 🔴 **Ein Entwurf** (WI-0261 Stufe 2, wie „Ecken bearbeiten“ an der Landschaft, `landschaftseditor/ecken-anbindung.ts`): Der Formentwurf hängt mit
 *   seinen Schritten an der EINEN Bearbeitung der Teilfläche (`sprachflaeche-werkzeuge.ts`), an der auch Verschieben, Malen, Radieren und
 *   Vereinfachen hängen. „Fertig“ der Bearbeitung schreibt `sprache_flaeche.reshape` gegen die Revision der Teilfläche, die ganze Form (Ringe ohne
 *   Schlusspunkt, je Polygon zuerst außen, dann die Löcher, im Aufbau vom Lesen). Die Fläche wird damit eine der Redaktion (T-1). Einen eigenen
 *   Schreibweg hat der Formentwurf nicht mehr; Leiste, Frage, Konfliktkasten und Fuß gehören der Bearbeitung (EDIT-0003 §3b R1, R2).
 * - **Gelesen** wird die Form von der Bearbeitung (sie liest sie beim Öffnen); verliert sie die Sperre, sagt es ihr Kasten im Fenster, nicht noch
 *   einmal ein Hinweis des Modus.
 * - Gestartet wird mit `starteAn(sprache, flaeche, name)`; die Kennung des Laufs ist `sprache:flaeche` (`laufKennung`).
 */

export interface SprachflaecheStart extends FormStart {
    readonly spracheId: string;
    readonly flaecheId: string;
    readonly aufbau: readonly number[];
}

export interface Sprachflaeche extends Formentwurf {
    /** Startet „Fläche bearbeiten“ an dieser Teilfläche; `name` steht in der Leiste. Ohne Schreibrecht beginnt nichts. */
    starteAn(sprache: string, flaeche: string, name: string): Promise<void>;
    /** Die Bearbeitung des Laufs (Leiste mit „Fertig“, Frage); sie bleibt nach seinem Ende stehen, bis ein neuer beginnt. */
    readonly bearbeitung: Readonly<ShallowRef<SprachflaecheBearbeitung | undefined>>;
}

export interface SprachflaecheOptionen {
    /** Der EINE Entwurf der Teilfläche: Seine Bearbeitung trägt die Schritte und schreibt mit „Fertig“. */
    readonly werkzeuge: Pick<SprachflaechenWerkzeuge, "quelle">;
    readonly karte: FormKarte;
    readonly fangradius: () => number;
    readonly sperre: SperrHalter;
    /** „Fertig“ hat geschrieben, während der Modus lief (der Hinweis „✓ … gespeichert“). */
    gespeichert?(name: string): void;
}

const KEINE_LAGE = { ungespeichert: 0, zurueck: false, wieder: false, frage: false } as const;

/** Die Kennung eines Laufs: Sprache und Teilfläche. */
export const laufKennung = (sprache: string, flaeche: string): string => `${sprache}:${flaeche}`;
export function ausKennung(kennung: string): { sprache: string; flaeche: string } | undefined {
    const [sprache, flaeche] = kennung.split(":");
    return sprache === undefined || flaeche === undefined || flaeche === "" ? undefined : { sprache, flaeche };
}

/** Der Start aus der gelesenen Form: die eine Teilfläche als Teile, ohne Nachbarn und ohne Ziele. */
export function startAus(form: SpracheEditorFlaecheForm, name: string): SprachflaecheStart {
    const teile = teileAus([{ id: form.id, revision: form.revision, polygons: form.polygons }], name);
    return {
        sperrId: form.sprache,
        name,
        teile,
        nachbarn: [],
        ziele: () => [],
        spracheId: form.sprache,
        flaecheId: form.id,
        aufbau: aufbauAus([form]).get(form.id) ?? [],
    };
}

/**
 * Die Polygone für `reshape` aus dem Entwurf; `undefined`, wenn sich nichts geändert hat. Auch die Werkzeuge der Form schreiben so
 * (`sprachflaeche-werkzeuge.ts`); nach einem Pinselstrich fasst das Stück der Teile die Ringe (`operationAus`).
 */
export function polygoneAus(
    start: Pick<SprachflaecheStart, "flaecheId" | "aufbau">,
    vorher: FormStand,
    jetzt: FormStand,
): SprachePolygone | undefined {
    const operation = operationAus(vorher, jetzt, new Map([[start.flaecheId, start.aufbau]]), "");
    const flaeche = operation.areas.find((area) => area.id === start.flaecheId);
    return flaeche === undefined ? undefined : (flaeche.polygons as SprachePolygone);
}

export function createSprachflaecheForm(optionen: SprachflaecheOptionen): Sprachflaeche {
    const { sperre } = optionen;
    let name = "";
    /** Die Sicht der Bearbeitung des laufenden Modus auf die Form. */
    let sicht: Entwurf<FormStand> | undefined;
    const bearbeitung = shallowRef<SprachflaecheBearbeitung | undefined>(undefined);
    let stopHinweis: WatchStopHandle | undefined;

    /** Der Kern des Formentwurfs reicht alles an die Sicht der Bearbeitung des laufenden Modus (wie `ecken-anbindung.ts`). */
    const vermittler: Entwurf<FormStand> = {
        beginne: (stand) => sicht?.beginne(stand),
        leere: () => sicht?.leere(),
        schritt: (stand, verschmelze) => sicht?.schritt(stand, verschmelze),
        schluss: () => sicht?.schluss(),
        ersetzeAlle: (neu) => sicht?.ersetzeAlle(neu),
        start: () => sicht?.start(),
        jetzt: () => sicht?.jetzt(),
        zurueck: () => sicht?.zurueck() ?? false,
        wieder: () => sicht?.wieder() ?? false,
        verwerfen: () => sicht?.verwerfen() ?? false,
        esc: () => sicht?.esc() ?? "ende",
        antworte: (verwerfen) => sicht?.antworte(verwerfen) ?? "ende",
        lage: () => sicht?.lage() ?? KEINE_LAGE,
    };
    const istSprache = (ziel: EditorLockTarget): boolean => ziel.kind === "sprache";

    const entwurf = createFormentwurf<SprachflaecheStart>({
        art: SPRACHE,
        // Was der Server beim Speichern ablehnen würde (kreuzt sich, zu wenige Ecken, außerhalb der Karte), übernimmt schon der Schritt
        // nicht (Vali 2026-11-10, `map/geometrie/form-regel.ts`). Nachbarn hat eine Sprachfläche keine.
        pruefeSchritte: true,
        quelle: {
            sperrArt: "sprache",
            // Die Form, wie die Bearbeitung sie gelesen hat; eine stillgelegte Teilfläche gibt es nicht.
            async lade(kennung) {
                const jetzt = bearbeitung.value;
                if (jetzt === undefined || ausKennung(kennung) === undefined || !(await bereitVon(jetzt))) return null;
                const form = jetzt.detail.value;
                return form === undefined || !form.aktiv ? null : startAus(form, name);
            },
        },
        karte: optionen.karte,
        fangradius: optionen.fangradius,
        sperre: {
            nimm: (ziel, teil) => sperre.nimm(ziel, teil),
            gib: (ziel) => sperre.gib(ziel),
            liste: (art) => sperre.liste(art),
            // Den Verlust der Sperre meldet die Bearbeitung (Kasten im Fenster, R1).
            beiVerlust: (zuhoerer) => sperre.beiVerlust((ziel) => (istSprache(ziel) ? undefined : zuhoerer(ziel))),
        },
        entwurf: vermittler,
    });

    return {
        ...entwurf,
        bearbeitung,
        starteAn(sprache, flaeche, neuerName) {
            const kennung = laufKennung(sprache, flaeche);
            const neu = optionen.werkzeuge.quelle(neuerName).bearbeitung(kennung);
            if (neu === undefined) return Promise.resolve();
            // Ein laufender Modus endet zuerst; seine Form hängt ab.
            entwurf.beende();
            name = neuerName;
            bearbeitung.value = neu;
            sicht = neu.formEntwurf({
                zurueck: () => entwurf.zurueck(),
                wieder: () => entwurf.wieder(),
                verwerfen: () => entwurf.verwerfen(),
                abbrechen: () => entwurf.abbrechen(),
                beende: () => entwurf.beende(),
            });
            // Schreibt „Fertig“ der Bearbeitung, während der Modus läuft, sagt der Hinweis es wie bisher.
            stopHinweis?.();
            let mitForm = false;
            stopHinweis = watch(
                () => neu.zustand.value.art,
                (art) => {
                    if (art === "speichert") mitForm = entwurf.laufend.value !== undefined;
                    else if (art === "gespeichert" && mitForm) optionen.gespeichert?.(neuerName);
                    if (art !== "speichert") mitForm = false;
                },
                { flush: "sync" },
            );
            return entwurf.starte(kennung);
        },
        destroy() {
            stopHinweis?.();
            entwurf.destroy();
        },
    };
}
