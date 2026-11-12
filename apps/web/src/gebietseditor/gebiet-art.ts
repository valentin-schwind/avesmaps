import {
    editorTerritoryUrl,
    type EditorTerritoryDetail,
    type TerritoryDetailChanges,
    type TerritoryUpdateBody,
    type TerritoryUpdateChanges,
} from "@avesmaps3d/shared";
import type { BearbeitungsArt, Stand } from "../fenster/bearbeitung";
import { sende } from "../fenster/entwurf-senden";
import { aufWikiWert, herkunftIm, wikiAenderung, type WikiFelder } from "../fenster/wiki-feld";
import { ableitungAus } from "./ausstehende-gebiete";
import { detailfelderAus, detailUnterschiede, type GebietDetailfelder } from "./gebiet-detailfelder";
import type { FormStand } from "../map/geometrie/formentwurf";
import { operationAus, type Aufbau } from "../map/geometrie/formoperation";
import type { Teil } from "../map/geometrie/geometrie";

/**
 * Das Herrschaftsgebiet als Art des gemeinsamen Entwurfs (WI-0209 B2; O3, `fenster/bearbeitung.ts`; EDIT-0003 T44; Muster
 * `landschaftseditor/landschaft-art.ts`): was seine Felder sind und wie Felder und Form als EINE Operation `territory.update` gehen
 * (`PATCH /api/editor/territories/:id`).
 *
 * - **Felder** (B2): Name, Kurzname, Art, Status und die Hauptstadt als Ort (Ortssuche). Der Sitz bleibt nur lesend (EDIT-0005 E1).
 * - **Obergebiet** (D1, „Umhängen“): ein Feld wie die anderen; vorher zeigt ein Blatt die Folgen (`gebiet-umhaengen.vue`). Ohne
 *   Obergebiet ist das Gebiet eine Wurzel. Zoomspanne und Farbe gehen über den Entwurf „Farben und Zoombänder“ (D2, D4).
 * - **Die 17 Detailfelder** (G6, Wiki-Feld WI-0225, Modell c; `gebiet-detailfelder.ts`): je Feld der Wert unter seinem Schlüssel, dazu
 *   `wiki` und `herkunft`. Tippen ist manual, ↺ setzt den Wiki-Wert und die Herkunft wiki (`aufWiki`); „Fertig“ schreibt je
 *   geändertem Feld `{ value }` oder `{ revert: "wiki" }` in `changes.details`. Im Fuß und im Konflikt heißt ein Detailfeld wie sein
 *   Schlüssel.
 * - **Form:** der Stand des Formentwurfs („Grenzen bearbeiten“), eigene Ringe und die der Nachbarn. Wie viele Ringe jedes Polygon hat
 *   und wie die Form beim Start lag, meldet der Start des Modus (`merkeForm`), weil der gelesene Stand die Ringe nicht trägt.
 * - **Revision je Objekt** (T44 (4)): das Gebiet nur für seine Felder, jede Fläche für sich.
 * - Für Konflikt und Fuß heißen die Teile wie die Felder (`name`, `kurzname`, `art`, `status`, `hauptstadt`, `obergebiet`) und
 *   `form`.
 */

export type GebietFelder = GebietGrundfelder & GebietDetailfelder & WikiFelder;

export interface GebietGrundfelder {
    readonly name: string;
    readonly shortName: string;
    readonly type: string;
    readonly status: string;
    /** Die Hauptstadt als Ort (Kennung und Name für die Anzeige); fehlt ohne Hauptstadt. */
    readonly capital: { readonly id: string; readonly name: string } | undefined;
    /** Das Obergebiet (D1); fehlt bei einer Wurzel. */
    readonly parent: { readonly id: string; readonly name: string } | undefined;
}

export type GebietStand = Stand<GebietFelder, FormStand>;

/** Die Felder in der Folge, in der Fuß und Konflikt sie nennen. */
export const GEBIET_FELDER = ["name", "kurzname", "art", "status", "hauptstadt", "obergebiet"] as const;
export type GebietFeld = (typeof GEBIET_FELDER)[number] | keyof GebietDetailfelder;

export function felderAus(d: EditorTerritoryDetail): GebietFelder {
    return {
        name: d.name,
        shortName: d.shortName ?? "",
        type: d.type ?? "",
        status: d.status ?? "",
        capital: d.capital === undefined ? undefined : { id: d.capital.id, name: d.capital.name ?? "–" },
        parent: d.parents[0] === undefined ? undefined : { id: d.parents[0].id, name: d.parents[0].name },
        ...detailfelderAus(d),
    };
}

/** Welche Felder sich zwischen zwei Feldständen unterscheiden (Texte getrimmt, wie der Server schreibt). */
export function feldUnterschiede(a: GebietFelder, b: GebietFelder): GebietFeld[] {
    const raus: GebietFeld[] = [];
    if (a.name.trim() !== b.name.trim()) raus.push("name");
    if (a.shortName.trim() !== b.shortName.trim()) raus.push("kurzname");
    if (a.type.trim() !== b.type.trim()) raus.push("art");
    if (a.status.trim() !== b.status.trim()) raus.push("status");
    if (a.capital?.id !== b.capital?.id) raus.push("hauptstadt");
    if (a.parent?.id !== b.parent?.id) raus.push("obergebiet");
    raus.push(...detailUnterschiede(a, b));
    return raus;
}

/** Die Änderungen von `start` nach `jetzt` im Vertrag von `territory.update`. */
function aenderungen(start: GebietFelder, jetzt: GebietFelder): TerritoryUpdateChanges {
    const raus: { -readonly [K in keyof TerritoryUpdateChanges]: TerritoryUpdateChanges[K] } = {};
    for (const feld of feldUnterschiede(start, jetzt)) {
        if (feld === "name") raus.name = jetzt.name.trim();
        if (feld === "kurzname") raus.shortName = jetzt.shortName.trim();
        if (feld === "art") raus.type = jetzt.type.trim();
        if (feld === "status") raus.status = jetzt.status.trim();
        if (feld === "hauptstadt") raus.capital = jetzt.capital?.id ?? "";
        if (feld === "obergebiet") raus.parent = jetzt.parent?.id ?? "";
    }
    // Die Detailfelder: ein Wert (Herkunft manual; `""` der bewusste Leerwert) oder ↺ (Herkunft wiki).
    const details: { -readonly [K in keyof TerritoryDetailChanges]: TerritoryDetailChanges[K] } = {};
    for (const feld of detailUnterschiede(start, jetzt)) {
        const aenderung = wikiAenderung(jetzt, feld);
        details[feld] = "revert" in aenderung ? aenderung : { value: aenderung.value?.trim() ?? null };
    }
    if (Object.keys(details).length > 0) raus.details = details;
    return raus;
}

const ringe = (teile: readonly Teil[]): string =>
    teile
        .map((teil) => `${teil.objekt}:${teil.punkte.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(";")}`)
        .join("|");

const formGeaendert = (a: FormStand | undefined, b: FormStand | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    (ringe(a.teile) !== ringe(b.teile) || ringe(a.nachbarn) !== ringe(b.nachbarn));

export interface GebietArt extends BearbeitungsArt<
    EditorTerritoryDetail,
    GebietFelder,
    FormStand,
    TerritoryUpdateBody
> {
    /** Der Start der Form meldet ihren Aufbau (Ringe je Polygon der eigenen Flächen und der Nachbarn) und wie sie lag. */
    merkeForm(aufbau: Aufbau, start: FormStand): void;
    /** Der Auftrag `territory_derive` aus der letzten Quittung dieses Gebiets (`ausstehende-gebiete.ts`). */
    ableitung(id: string): string | undefined;
}

export function createGebietArt(fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init)): GebietArt {
    let aufbau: Aufbau = new Map();
    let formStart: FormStand | undefined;
    const ableitungen = new Map<string, string>();
    return {
        sperrArt: "territory",
        ableitung: (id) => ableitungen.get(id),
        merkeForm(neu, start) {
            aufbau = neu;
            formStart = start;
        },
        async lade(id, signal) {
            const antwort = await fetcher(editorTerritoryUrl(id), {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`Gebiet ${id}: ${String(antwort.status)}`);
            return (await antwort.json()) as EditorTerritoryDetail;
        },
        felder: felderAus,
        aufWiki: (felder, schluessel) => aufWikiWert(felder, schluessel),
        herkunft: herkunftIm,
        operation(d, start, jetzt, operationId) {
            const body: { -readonly [K in keyof TerritoryUpdateBody]: TerritoryUpdateBody[K] } = { operationId };
            const changes = aenderungen(start.felder, jetzt.felder);
            if (Object.keys(changes).length > 0) {
                if (d.revision !== undefined) body.baseRevision = d.revision;
                body.changes = changes;
            }
            if (start.form !== undefined && jetzt.form !== undefined && formGeaendert(start.form, jetzt.form)) {
                const areas = operationAus(start.form, jetzt.form, aufbau, operationId).areas;
                if (areas.length > 0) body.areas = areas;
            }
            return body.changes === undefined && body.areas === undefined ? undefined : body;
        },
        async schreibe(id, body) {
            const antwort = await sende(editorTerritoryUrl(id), body, "PATCH", fetcher);
            const job = antwort.ok ? ableitungAus(antwort.quittung) : undefined;
            if (job !== undefined) ableitungen.set(id, job);
            return antwort;
        },
        geaendert(d, stand) {
            const raus: string[] = feldUnterschiede(felderAus(d), stand.felder);
            if (formGeaendert(formStart, stand.form)) raus.push("form");
            return raus;
        },
        fremde(vorher, jetzt) {
            const raus: string[] = feldUnterschiede(felderAus(vorher), felderAus(jetzt));
            const flaechen = (d: EditorTerritoryDetail): string =>
                d.areas.map((a) => `${a.id}:${String(a.revision ?? 0)}`).join();
            if (flaechen(vorher) !== flaechen(jetzt)) raus.push("form");
            return raus;
        },
        aufNeuenStand(vorher, jetzt, stand) {
            const alt = felderAus(vorher);
            const neu = felderAus(jetzt);
            const eigene = new Set(feldUnterschiede(alt, stand.felder));
            return {
                felder: {
                    ...neu,
                    // Was der Entwurf an Detailfeldern geändert hat, bleibt mit seiner Herkunft; der Rest kommt vom neuen Stand.
                    ...Object.fromEntries(
                        detailUnterschiede(alt, stand.felder).map((feld) => [feld, stand.felder[feld]]),
                    ),
                    herkunft: {
                        ...neu.herkunft,
                        ...Object.fromEntries(
                            detailUnterschiede(alt, stand.felder).map((feld) => [feld, stand.felder.herkunft[feld]]),
                        ),
                    },
                    name: eigene.has("name") ? stand.felder.name : neu.name,
                    shortName: eigene.has("kurzname") ? stand.felder.shortName : neu.shortName,
                    type: eigene.has("art") ? stand.felder.type : neu.type,
                    status: eigene.has("status") ? stand.felder.status : neu.status,
                    capital: eigene.has("hauptstadt") ? stand.felder.capital : neu.capital,
                    parent: eigene.has("obergebiet") ? stand.felder.parent : neu.parent,
                },
                // Die eigenen Flächen tragen die Revision des neuen Stands (Überschreiben schreibt gegen sie), wie bei der Landschaft.
                form:
                    stand.form === undefined
                        ? undefined
                        : {
                              ...stand.form,
                              teile: stand.form.teile.map((teil) => {
                                  const flaeche = jetzt.areas.find((area) => area.id === teil.objekt);
                                  return flaeche?.revision === undefined
                                      ? teil
                                      : { ...teil, revision: flaeche.revision };
                              }),
                          },
            };
        },
        sicherung: {
            // 2: mit dem Obergebiet (D1); ein Entwurf ohne es hieße sonst „Wurzel“.
            version: 2,
            aus: (stand) => stand,
            ein(wert) {
                const s = wert as Partial<GebietStand> | null;
                if (s === null || typeof s !== "object" || typeof s.felder?.name !== "string") return undefined;
                const f = s.felder;
                if (typeof f.shortName !== "string" || typeof f.type !== "string" || typeof f.status !== "string")
                    return undefined;
                return { felder: f, form: s.form ?? undefined };
            },
        },
    };
}
