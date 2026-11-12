import { shallowRef, type ShallowRef } from "vue";
import { editorTerritoryFormUrl, type EditorTerritoryForm } from "@avesmaps3d/shared";
import type { EditorSperre } from "../editor-sperre/sperre";
import type { Entwurf } from "../fenster/entwurf-kern";
import { GEBIET } from "../map/geometrie/arten";
import {
    createFormentwurf,
    kantenZiele,
    ringZiele,
    teileAus,
    type FormKarte,
    type FormNachbar,
    type FormStand,
    type FormStart,
    type Formentwurf,
} from "../map/geometrie/formentwurf";
import { aufbauAus, type Aufbau } from "../map/geometrie/formoperation";
import type { Punkt, Ziel } from "../map/geometrie/geometrie";

/**
 * „Gebietsform bearbeiten“ an einem Herrschaftsgebiet (WI-0209 C1, B2; EDIT-0005 §9 „C1“, H3; EDIT-0003 F18, T23 Frage 1 und 2, T44) als
 * Quelle des gemeinsamen Formentwurfs (`map/geometrie/formentwurf.ts`); Ablauf, Entwurf, Sperre und Esc stehen dort. Was das Gebiet
 * anders hat:
 *
 * - **Art** `GEBIET`: eckig wie die Karte, gemeinsame Ecken mit Flächen anderer Gebiete ziehen mit (Strg löst).
 * - **Welches Gebiet** (Frage 2): Der Lesepfad `GET /api/editor/territories/:id/form?x=&y=` nimmt den Klickpunkt mit; an einem
 *   abgeleiteten Gebiet (ohne eigene Fläche dort) bearbeitet der Modus die Baronie darunter und sagt es (`darunter`). Die Anbindung löst
 *   das vor dem Start auf (`starteMit` mit dem gelesenen Stand), damit Bearbeitung und Sperre am richtigen Gebiet hängen.
 * - **Die Leiste** nennt die Obergebiete, deren Grenze sich mitändert (Frage 1; `obergebiete`); neu abgeleitet wird nach „Fertig“.
 * - **Geschrieben** wird nicht hier (B2 Teil 2, O3): Die Form steht im EINEN Entwurf des Gebiets (`entwurf`, die Sicht der Bearbeitung),
 *   und „Fertig“ der Bearbeitung schreibt sie mit den Feldern als `territory.update` (`gebiet-art.ts`). Wie viele Ringe jedes Polygon hat,
 *   meldet das Lesen (`merkeAufbau`).
 */

export interface GebietsformDaten {
    form(id: string, at: Punkt | undefined, signal: AbortSignal): Promise<EditorTerritoryForm | null>;
}

export interface Gebietsform extends Formentwurf {
    /** Startet am Gebiet; `vorab` ist sein schon gelesener Stand (die Baronie unter dem Klickpunkt), sonst liest der Start selbst. */
    starteMit(id: string, vorab?: EditorTerritoryForm): Promise<void>;
    /** Die Obergebiete des bearbeiteten Gebiets, zuerst der Elter (Frage 1). */
    readonly obergebiete: Readonly<ShallowRef<readonly string[]>>;
}

export interface GebietsformOptionen {
    readonly daten: GebietsformDaten;
    readonly karte: FormKarte;
    readonly fangradius: () => number;
    readonly sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust" | "liste">;
    /** Der EINE Entwurf des Gebiets (O3, `bearbeitung.formEntwurf()`); ohne Angabe ein eigener (Tests). */
    readonly entwurf?: Entwurf<FormStand>;
    /** Wie viele Ringe jedes Polygon der eigenen Flächen und der Nachbarn hat, sobald gelesen (für `territory.update`). */
    readonly merkeAufbau?: (aufbau: Aufbau) => void;
}

/** Der Start aus dem Lesepfad: eigene Flächen, Nachbarn je Gebiet (so werden sie gesperrt), Ziele aus Nachbarn und Kanten. */
export function startAus(form: EditorTerritoryForm): FormStart {
    const jeGebiet = new Map<string, { name: string; flaechen: EditorTerritoryForm["neighbors"] }>();
    for (const n of form.neighbors) {
        const gebiet = jeGebiet.get(n.territory) ?? { name: n.name, flaechen: [] };
        gebiet.flaechen.push(n);
        jeGebiet.set(n.territory, gebiet);
    }
    const nachbarn: FormNachbar[] = [...jeGebiet].map(([sperrId, gebiet]) => ({
        sperrId,
        name: gebiet.name,
        teile: teileAus(gebiet.flaechen, gebiet.name),
    }));
    return {
        sperrId: form.id,
        name: form.name,
        teile: teileAus(form.areas, form.name),
        nachbarn,
        ziele(freie, gehalten) {
            const raus: Ziel[] = [];
            const gesehen = new Set<string>();
            ringZiele(freie, true, gesehen, raus);
            ringZiele(gehalten, false, gesehen, raus);
            kantenZiele(form.edges, gesehen, raus);
            return raus;
        },
        ...(form.requested === undefined
            ? {}
            : { hinweis: { art: "darunter" as const, name: form.name, von: form.requested.name } }),
    };
}

/** Der Lesepfad, immer frisch und abbrechbar (wie `landschaftseditor/ecken-daten.ts`). */
export function createGebietsformDaten(): GebietsformDaten {
    return {
        async form(id, at, signal) {
            const url = editorTerritoryFormUrl(id, at === undefined ? undefined : { x: at.x, y: at.y });
            const antwort = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as EditorTerritoryForm;
        },
    };
}

export function createGebietsform(optionen: GebietsformOptionen): Gebietsform {
    let vorab: EditorTerritoryForm | undefined;
    const obergebiete = shallowRef<readonly string[]>([]);
    const entwurf = createFormentwurf({
        art: GEBIET,
        quelle: {
            sperrArt: "territory",
            async lade(id, signal) {
                obergebiete.value = [];
                const gelesen = vorab?.id === id ? vorab : await optionen.daten.form(id, undefined, signal);
                vorab = undefined;
                if (gelesen === null) return null;
                obergebiete.value = gelesen.parents.map((p) => p.name);
                optionen.merkeAufbau?.(aufbauAus([...gelesen.areas, ...gelesen.neighbors]));
                return startAus(gelesen);
            },
        },
        karte: optionen.karte,
        fangradius: optionen.fangradius,
        sperre: optionen.sperre,
        // Was der Server beim Speichern ablehnen würde, übernimmt schon der Schritt nicht (Vali 2026-11-10, `form-regel.ts`).
        pruefeSchritte: true,
        ...(optionen.entwurf === undefined ? {} : { entwurf: optionen.entwurf }),
    });
    return {
        ...entwurf,
        obergebiete,
        starteMit(id, gelesen) {
            vorab = gelesen;
            return entwurf.starte(id);
        },
    };
}
