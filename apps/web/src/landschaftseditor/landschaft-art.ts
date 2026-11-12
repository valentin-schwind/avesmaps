import {
    editorLandscapeUrl,
    EDITOR_LANDSCAPES_URL,
    gleicheGefahren,
    ordneGefahren,
    type EditorLandscapeDetail,
    type EditorLandscapeLayer,
    type EditorLandscapeLabel,
    type LandscapeLabelChanges,
    type LandscapeUpdateBody,
} from "@avesmaps3d/shared";
import type { BearbeitungsArt, Stand } from "../fenster/bearbeitung";
import { sende } from "../fenster/entwurf-senden";
import { isMessageKey, t } from "../i18n/i18n";
import type { Teil } from "../map/geometrie/geometrie";
import { aufbauAus, operationAus, type Aufbau } from "./ecken";
import { aenderungAus, GEBIRGE_LEER, gleich, type GebirgsEntwurf } from "./gebirge-stand";

/**
 * Die Landschaft als Art des gemeinsamen Entwurfs (WI-0178 B2; O3, `fenster/bearbeitung.ts`; EDIT-0003 T44): was ihre Felder sind und
 * wie Felder, Beschriftungen und Form als EINE Operation `landscape.update` gehen (`PATCH /api/editor/landscapes/:id`).
 *
 * - **Felder** (B2): der Name und je Beschriftung Größe, Priorität, Zoom von/bis und „Auf der Karte anzeigen“; Ebene und Art
 *   (Betreiber 2026-10-17: „das muss editierbar sein“). Eine neue Ebene leert die Art; bis eine Art aus ihr gewählt ist, sperrt
 *   `pruefe` „Fertig“. Wiki, Anlegen und Löschen von Beschriftungen kommen mit eigenen Paketen (EDIT-0004 §9).
 * - **Form:** der Stand des Formentwurfs („Ecken bearbeiten“): eigene Ringe und die der Nachbarn. Wie viele Ringe jedes Polygon hat
 *   (`aufbau`), meldet der Start des Modus (`merkeAufbau`), weil die Nachbarn nicht im gelesenen Stand stehen.
 * - **Revision je Objekt** (T44 (4)): die Landschaft nur für ihre Felder, jede Beschriftung und Teilfläche für sich.
 * - **Klicksperre, Kurve, Text** (2026-10-18): „für Klicks gesperrt“, Punkt oder entlang der Fläche samt Läufen (F7) und je Beschriftung
 *   ↺ „Namen übernehmen“ (FL3).
 * - **Platz in der Ebene** (D1, Legacys `set_region_stack`): ganz nach vorn oder ganz nach hinten, ein Wunsch, kein Rang; den Rang
 *   rechnet der Server aus der ganzen Ebene.
 * - **Für Besucher verborgen** (T41): ein Feld neben der Klicksperre; Wörter wie am Ort („Verbergen“, „Zurückholen“).
 * - **Das Gebirge** (P4, Reiter „Gebirge“): je Teilfläche Typ und Abweichungen (`gebirge-stand.ts`); geschrieben nur, solange die
 *   Fläche im Entwurf ein Gebirge ist (sonst wäre es 400 `kein_gebirge`).
 * - **Gipfelhöhen** (P5, Gipfelliste im Reiter): je Gipfel des Gebirges seine Höhe, geschrieben gegen die Revision des Gipfels
 *   (`peaks`), derselbe Weg wie im Fenster des Gipfels. Teil `gipfel`.
 * - **Gefahrenlage** (WI-0308, Abschnitt „Merkmale“): die ganze Auswahl als ein Feld; leer heißt „ungefährlich“.
 * - Für Konflikt und Fuß heißen die Teile `name`, `ebene`, `art`, `sperre`, `verborgen`, `gefahr`, `kurve`, `platz`, `beschriftungen`,
 *   `gebirge` und `form`.
 */

/** Die schreibbaren Werte einer Beschriftung (`map_label`). */
export interface BeschriftungFelder {
    readonly size?: number | undefined;
    readonly priority?: number | undefined;
    readonly zoomMin?: number | undefined;
    readonly zoomMax?: number | undefined;
    readonly visible: boolean;
    /** Der Text folgt dem Namen; `false`: ein abweichender Text aus Legacy (FL3, ↺ „Namen übernehmen“ setzt `true`). */
    readonly followName: boolean;
    /** Die Lage in Karteneinheiten (C4: „Auf der Karte verschieben“); reist als Paar. Fehlt in Sicherungen von vorher. */
    readonly x?: number | undefined;
    readonly y?: number | undefined;
}

export interface LandschaftFelder {
    readonly name: string;
    readonly ebene: EditorLandscapeLayer;
    /** Die Art; `undefined`: keine (nach einer neuen Ebene noch nicht gewählt, oder die Landschaft hatte nie eine). */
    readonly art: string | undefined;
    /** Für Klicks gesperrt. */
    readonly gesperrt: boolean;
    /** Für Besucher verborgen (T41); fehlt in Sicherungen von vorher (dann wie gelesen). */
    readonly verborgen?: boolean | undefined;
    /** Die Gefahrenlage (WI-0308) in der Folge des Katalogs, leer „ungefährlich“; fehlt in Sicherungen von vorher (dann wie gelesen). */
    readonly gefahren?: readonly string[] | undefined;
    /** Entlang der Fläche (an/aus); `undefined`: noch nicht migriert (NULL). */
    readonly kurve: boolean | undefined;
    /** Wie oft der Name höchstens auf der Kurve steht (1 bis 3); `undefined`: die Vorgabe der Tafel. */
    readonly laeufe: number | undefined;
    /** Ganz nach vorn oder ganz nach hinten (D1); `undefined`: der Platz bleibt (in einer neuen Ebene: vorn). */
    readonly platz?: "vorn" | "hinten" | undefined;
    readonly labels: Readonly<Record<string, BeschriftungFelder>>;
    /** Je Teilfläche Typ und Abweichungen des Gebirges (P4); fehlt eine Teilfläche, gilt ihr gelesener Stand. */
    readonly gebirge?: Readonly<Record<string, GebirgsEntwurf>> | undefined;
    /** Je Gipfel des Gebirges die Höhe aus der Gipfelliste (P5); fehlt ein Gipfel, gilt seine gelesene Höhe. */
    readonly gipfelHoehen?: Readonly<Record<string, number>> | undefined;
}

/** Ist die Fläche (im Entwurf) ein Gebirge? Nur dann hat sie den Reiter „Gebirge“ und schreibt ihn. */
export const istGebirge = (felder: Pick<LandschaftFelder, "ebene" | "art">): boolean =>
    felder.ebene === "topographie" && felder.art === "gebirge";

/** Der gelesene Stand des Gebirges einer Teilfläche; an einer Fläche, die erst zum Gebirge wird, keiner (T50: die alten Werte fallen weg). */
export const gebirgeGelesen = (d: EditorLandscapeDetail, flaeche: string): GebirgsEntwurf =>
    d.areas.find((area) => area.id === flaeche)?.gebirge ?? GEBIRGE_LEER;

/** Die Gipfel, deren Höhe im Entwurf anders steht als gelesen. */
const gipfelGeaendert = (d: EditorLandscapeDetail, felder: LandschaftFelder): string[] =>
    Object.entries(felder.gipfelHoehen ?? {})
        .filter(([id, hoehe]) => {
            const gipfel = d.peaks?.find((p) => p.id === id);
            return gipfel !== undefined && gipfel.height !== hoehe;
        })
        .map(([id]) => id);

/** Die Teilflächen, deren Gebirge im Entwurf anders steht als gelesen. */
const gebirgeGeaendert = (d: EditorLandscapeDetail, felder: LandschaftFelder): string[] =>
    Object.entries(felder.gebirge ?? {})
        .filter(([flaeche, stand]) => !gleich(gebirgeGelesen(d, flaeche), stand))
        .map(([flaeche]) => flaeche);

/** Die Form im Entwurf: der Stand des Formentwurfs. */
export interface LandschaftForm {
    readonly teile: readonly Teil[];
    readonly nachbarn: readonly Teil[];
}

export type LandschaftStand = Stand<LandschaftFelder, LandschaftForm>;

/** Die Felder einer Beschriftung, die je für sich reisen; die Spanne (`zoomMin`, `zoomMax`) reist als Paar. */
const LABEL_FELDER = ["size", "priority", "visible", "followName"] as const;

const beschriftungAus = (label: EditorLandscapeLabel, name: string): BeschriftungFelder => ({
    size: label.size,
    priority: label.priority,
    zoomMin: label.zoomMin,
    zoomMax: label.zoomMax,
    visible: label.visible,
    followName: label.text === name,
    x: label.x,
    y: label.y,
});

export function felderAus(d: EditorLandscapeDetail): LandschaftFelder {
    return {
        name: d.name,
        ebene: d.layer,
        art: d.type,
        gesperrt: d.clickLocked,
        verborgen: d.hidden === true,
        gefahren: d.hazards ?? [],
        kurve: d.curve?.enabled,
        laeufe: d.curve?.max,
        labels: Object.fromEntries(d.labels.map((label) => [label.id, beschriftungAus(label, d.name)])),
    };
}

/** Die eigenen Gipfelhöhen (gegenüber `vorher`) auf dem neuen Stand; sie schreiben gegen dessen Revision. */
function gipfelMitEigenen(vorher: EditorLandscapeDetail, felder: LandschaftFelder): LandschaftFelder["gipfelHoehen"] {
    const eigene = Object.fromEntries(gipfelGeaendert(vorher, felder).map((id) => [id, felder.gipfelHoehen![id]!]));
    return Object.keys(eigene).length === 0 ? undefined : eigene;
}

/** Die Gebirge des neuen Stands mit den eigenen Änderungen (gegenüber `vorher`) darüber. */
function gebirgeMitEigenen(
    vorher: EditorLandscapeDetail,
    eigene: LandschaftFelder["gebirge"],
): LandschaftFelder["gebirge"] {
    const raus = Object.fromEntries(
        Object.entries(eigene ?? {}).filter(([flaeche, stand]) => !gleich(gebirgeGelesen(vorher, flaeche), stand)),
    );
    return Object.keys(raus).length === 0 ? undefined : raus;
}

/** Was sich an einer Beschriftung zwischen zwei Ständen ändert, in der Form von `landscape.update`. */
function labelAenderung(vorher: BeschriftungFelder | undefined, jetzt: BeschriftungFelder): LandscapeLabelChanges {
    const raus: Record<string, unknown> = {};
    for (const feld of LABEL_FELDER) {
        const wert = jetzt[feld];
        // Folgen geht nur in eine Richtung: ↺ „Namen übernehmen“; einen eigenen Text gibt es nicht (FL3).
        if (feld === "followName" && wert !== true) continue;
        if (wert !== undefined && wert !== vorher?.[feld]) raus[feld] = wert;
    }
    // Die eigene Spanne wirkt nur als Paar (Sicht `map_label_effective`, 0057): beide, oder ↺ keine (die Vorgabe der Art).
    if (jetzt.zoomMin !== vorher?.zoomMin || jetzt.zoomMax !== vorher?.zoomMax) {
        if (jetzt.zoomMin === undefined && jetzt.zoomMax === undefined) raus["zoomReset"] = true;
        else {
            raus["zoomMin"] = jetzt.zoomMin ?? 0;
            raus["zoomMax"] = jetzt.zoomMax ?? 8;
        }
    }
    // Die Lage als Paar (C4); eine Sicherung von vorher kennt sie nicht und bewegt nichts.
    if (jetzt.x !== undefined && jetzt.y !== undefined && (jetzt.x !== vorher?.x || jetzt.y !== vorher?.y))
        raus["position"] = [jetzt.x, jetzt.y];
    return raus as LandscapeLabelChanges;
}

/** Eine Beschriftung des neuen Stands mit den eigenen Änderungen (gegenüber `alt`) darüber. */
function mitEigenen(
    neu: BeschriftungFelder,
    alt: BeschriftungFelder | undefined,
    eigene: BeschriftungFelder | undefined,
): BeschriftungFelder {
    if (eigene === undefined) return neu;
    const raus: Record<string, unknown> = { ...neu };
    for (const feld of LABEL_FELDER) if (eigene[feld] !== alt?.[feld]) raus[feld] = eigene[feld];
    if (eigene.zoomMin !== alt?.zoomMin || eigene.zoomMax !== alt?.zoomMax) {
        raus["zoomMin"] = eigene.zoomMin;
        raus["zoomMax"] = eigene.zoomMax;
    }
    if (eigene.x !== undefined && eigene.y !== undefined && (eigene.x !== alt?.x || eigene.y !== alt?.y)) {
        raus["x"] = eigene.x;
        raus["y"] = eigene.y;
    }
    return raus as unknown as BeschriftungFelder;
}

const ringe = (teile: readonly Teil[]): string =>
    teile
        .map((teil) => `${teil.objekt}:${teil.punkte.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(";")}`)
        .join("|");

/** Die eigenen Ringe eines gelesenen Stands, in der Folge von `teileAus` (Fläche, dann ihre Ringe). */
const ringeVon = (d: EditorLandscapeDetail): string =>
    d.areas
        .flatMap((area) =>
            area.polygons.flatMap((polygon) =>
                polygon.map(
                    (ring) => `${area.id}:${ring.map(([x, y]) => `${x.toFixed(5)},${y.toFixed(5)}`).join(";")}`,
                ),
            ),
        )
        .join("|");

const formGeaendert = (a: LandschaftForm | undefined, b: LandschaftForm | undefined): boolean =>
    a !== undefined &&
    b !== undefined &&
    (ringe(a.teile) !== ringe(b.teile) || ringe(a.nachbarn) !== ringe(b.nachbarn));

/** Der Name einer Ebene wie im Fächer der Karte (`layer.*`). */
function ebenenName(ebene: string): string {
    const key = `layer.${ebene}`;
    return isMessageKey(key) ? t(key) : ebene;
}

/** Ändern sich Beschriftungen zwischen zwei Feldständen? */
const labelsGeaendert = (a: LandschaftFelder, b: LandschaftFelder): boolean =>
    Object.keys(b.labels).some((id) => Object.keys(labelAenderung(a.labels[id], b.labels[id]!)).length > 0);

export interface LandschaftArt extends BearbeitungsArt<
    EditorLandscapeDetail,
    LandschaftFelder,
    LandschaftForm,
    LandscapeUpdateBody
> {
    /** Der Start des Formentwurfs meldet, wie viele Ringe jedes Polygon der eigenen Flächen und der Nachbarn hat. */
    merkeAufbau(aufbau: Aufbau): void;
}

export function createLandschaftArt(fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init)): LandschaftArt {
    let aufbau: Aufbau = new Map();
    return {
        sperrArt: "landscape",
        merkeAufbau(neu) {
            aufbau = neu;
        },
        async lade(id, signal) {
            const antwort = await fetcher(`${EDITOR_LANDSCAPES_URL}/${id}`, {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`Landschaft ${id}: ${String(antwort.status)}`);
            return (await antwort.json()) as EditorLandscapeDetail;
        },
        felder: felderAus,
        operation(d, start, jetzt, operationId) {
            const body: { -readonly [K in keyof LandscapeUpdateBody]: LandscapeUpdateBody[K] } = { operationId };
            const name = jetzt.felder.name.trim();
            const changes: NonNullable<LandscapeUpdateBody["changes"]> = {};
            if (name !== start.felder.name.trim()) changes.name = name;
            // Ebene und Art gehen zusammen: Eine neue Ebene braucht ihre Art (der Server prüft es auch).
            const { ebene, art } = jetzt.felder;
            if (art !== undefined && (ebene !== start.felder.ebene || art !== start.felder.art)) {
                changes.type = art;
                if (ebene !== d.layer) changes.layer = ebene;
            }
            if (jetzt.felder.gesperrt !== start.felder.gesperrt) changes.locked = jetzt.felder.gesperrt;
            if (jetzt.felder.verborgen !== undefined && jetzt.felder.verborgen !== (start.felder.verborgen ?? false))
                changes.hidden = jetzt.felder.verborgen;
            if (
                jetzt.felder.gefahren !== undefined &&
                !gleicheGefahren(jetzt.felder.gefahren, start.felder.gefahren ?? d.hazards ?? [])
            )
                changes.hazards = ordneGefahren(jetzt.felder.gefahren);
            const { kurve, laeufe } = jetzt.felder;
            if (kurve !== start.felder.kurve || laeufe !== start.felder.laeufe)
                changes.curve = {
                    enabled: kurve === true,
                    ...(laeufe !== undefined && laeufe !== start.felder.laeufe ? { max: laeufe } : {}),
                };
            const { platz } = jetzt.felder;
            if (platz !== undefined && platz !== start.felder.platz)
                changes.order = platz === "vorn" ? "front" : "back";
            if (Object.keys(changes).length > 0) {
                body.baseRevision = d.revision;
                body.changes = changes;
            }
            const labels: NonNullable<LandscapeUpdateBody["labels"]> = [];
            for (const label of d.labels) {
                const neu = jetzt.felder.labels[label.id];
                if (neu === undefined) continue;
                const changes = labelAenderung(start.felder.labels[label.id], neu);
                if (Object.keys(changes).length > 0)
                    labels.push({ id: label.id, baseRevision: label.revision, changes });
            }
            if (labels.length > 0) body.labels = labels;
            if (istGebirge(jetzt.felder)) {
                const gebirge: NonNullable<LandscapeUpdateBody["gebirge"]> = [];
                for (const [flaeche, stand] of Object.entries(jetzt.felder.gebirge ?? {})) {
                    const vorher = start.felder.gebirge?.[flaeche] ?? gebirgeGelesen(d, flaeche);
                    const changes = aenderungAus(vorher, stand);
                    if (changes !== undefined) gebirge.push({ area: flaeche, changes });
                }
                if (gebirge.length > 0) body.gebirge = gebirge;
                const peaks: NonNullable<LandscapeUpdateBody["peaks"]> = [];
                for (const id of gipfelGeaendert(d, jetzt.felder)) {
                    const gipfel = d.peaks!.find((p) => p.id === id)!;
                    const vorher = start.felder.gipfelHoehen?.[id] ?? gipfel.height;
                    const hoehe = jetzt.felder.gipfelHoehen![id]!;
                    if (hoehe !== vorher) peaks.push({ id, baseRevision: gipfel.revision, height: hoehe });
                }
                if (peaks.length > 0) body.peaks = peaks;
            }
            if (start.form !== undefined && jetzt.form !== undefined && formGeaendert(start.form, jetzt.form)) {
                const bekannt = new Map([...aufbauAus(d.areas), ...aufbau]);
                const areas = operationAus(start.form, jetzt.form, bekannt, operationId).areas;
                if (areas.length > 0) body.areas = areas;
            }
            return body.changes === undefined &&
                body.labels === undefined &&
                body.areas === undefined &&
                body.gebirge === undefined &&
                body.peaks === undefined
                ? undefined
                : body;
        },
        schreibe: (id, body) => sende(editorLandscapeUrl(id), body, "PATCH", fetcher),
        geaendert(d, stand) {
            const raus: string[] = [];
            if (stand.felder.name.trim() !== d.name) raus.push("name");
            if (stand.felder.ebene !== d.layer) raus.push("ebene");
            if (stand.felder.art !== d.type) raus.push("art");
            if (stand.felder.gesperrt !== d.clickLocked) raus.push("sperre");
            if (stand.felder.verborgen !== undefined && stand.felder.verborgen !== (d.hidden === true))
                raus.push("verborgen");
            if (stand.felder.gefahren !== undefined && !gleicheGefahren(stand.felder.gefahren, d.hazards ?? []))
                raus.push("gefahr");
            if (stand.felder.kurve !== d.curve?.enabled || stand.felder.laeufe !== d.curve?.max) raus.push("kurve");
            if (stand.felder.platz !== undefined) raus.push("platz");
            if (labelsGeaendert(felderAus(d), stand.felder)) raus.push("beschriftungen");
            if (gebirgeGeaendert(d, stand.felder).length > 0) raus.push("gebirge");
            if (gipfelGeaendert(d, stand.felder).length > 0) raus.push("gipfel");
            // Die Form zählt als geändert, sobald ein eigener Ring anders liegt als beim Lesen.
            if (stand.form !== undefined && ringeVon(d) !== ringe(stand.form.teile)) raus.push("form");
            return raus;
        },
        fremde(vorher, jetzt) {
            const raus: string[] = [];
            if (vorher.name !== jetzt.name) raus.push("name");
            if (vorher.layer !== jetzt.layer) raus.push("ebene");
            if (vorher.type !== jetzt.type) raus.push("art");
            if (vorher.clickLocked !== jetzt.clickLocked) raus.push("sperre");
            if ((vorher.hidden === true) !== (jetzt.hidden === true)) raus.push("verborgen");
            if (!gleicheGefahren(vorher.hazards ?? [], jetzt.hazards ?? [])) raus.push("gefahr");
            if (JSON.stringify(vorher.curve) !== JSON.stringify(jetzt.curve)) raus.push("kurve");
            if (vorher.order !== jetzt.order) raus.push("platz");
            const labelRev = (d: EditorLandscapeDetail): string =>
                d.labels.map((l) => `${l.id}:${String(l.revision)}`).join();
            if (labelRev(vorher) !== labelRev(jetzt) && labelsGeaendert(felderAus(vorher), felderAus(jetzt)))
                raus.push("beschriftungen");
            const flaechenRev = (d: EditorLandscapeDetail): string =>
                d.areas.map((a) => `${a.id}:${String(a.revision)}`).join();
            if (flaechenRev(vorher) !== flaechenRev(jetzt)) raus.push("form");
            // Die Gebirgswerte haben keine Revision: Ein anderer Stand beim Neulesen ist fremd.
            const gebirgeVon = (d: EditorLandscapeDetail): string =>
                JSON.stringify(d.areas.map((a) => a.gebirge ?? null));
            if (gebirgeVon(vorher) !== gebirgeVon(jetzt)) raus.push("gebirge");
            const gipfelRev = (d: EditorLandscapeDetail): string =>
                (d.peaks ?? []).map((p) => `${p.id}:${String(p.revision)}`).join();
            if (gipfelRev(vorher) !== gipfelRev(jetzt)) raus.push("gipfel");
            return raus;
        },
        aufNeuenStand(vorher, jetzt, stand) {
            const alt = felderAus(vorher);
            const neu = felderAus(jetzt);
            const labels: Record<string, BeschriftungFelder> = {};
            for (const [id, label] of Object.entries(neu.labels))
                labels[id] = mitEigenen(label, alt.labels[id], stand.felder.labels[id]);
            return {
                felder: {
                    name: stand.felder.name.trim() !== vorher.name ? stand.felder.name : jetzt.name,
                    // Ebene und Art als Paar: Wer eine geändert hat, behält beide.
                    ...(stand.felder.ebene !== vorher.layer || stand.felder.art !== vorher.type
                        ? { ebene: stand.felder.ebene, art: stand.felder.art }
                        : { ebene: jetzt.layer, art: jetzt.type }),
                    gesperrt: stand.felder.gesperrt !== vorher.clickLocked ? stand.felder.gesperrt : jetzt.clickLocked,
                    verborgen:
                        stand.felder.verborgen !== undefined && stand.felder.verborgen !== (vorher.hidden === true)
                            ? stand.felder.verborgen
                            : jetzt.hidden === true,
                    gefahren:
                        stand.felder.gefahren !== undefined &&
                        !gleicheGefahren(stand.felder.gefahren, vorher.hazards ?? [])
                            ? stand.felder.gefahren
                            : (jetzt.hazards ?? []),
                    ...(stand.felder.kurve !== vorher.curve?.enabled || stand.felder.laeufe !== vorher.curve?.max
                        ? { kurve: stand.felder.kurve, laeufe: stand.felder.laeufe }
                        : { kurve: jetzt.curve?.enabled, laeufe: jetzt.curve?.max }),
                    // Ein Wunsch, kein Rang: Er gilt auf jedem Stand.
                    ...(stand.felder.platz !== undefined ? { platz: stand.felder.platz } : {}),
                    labels,
                    gebirge: gebirgeMitEigenen(vorher, stand.felder.gebirge),
                    gipfelHoehen: gipfelMitEigenen(vorher, stand.felder),
                },
                // Die eigenen Teilflächen tragen die Revision des neuen Stands (Überschreiben schreibt gegen sie).
                form:
                    stand.form === undefined
                        ? undefined
                        : {
                              ...stand.form,
                              teile: stand.form.teile.map((teil) => {
                                  const flaeche = jetzt.areas.find((area) => area.id === teil.objekt);
                                  return flaeche === undefined ? teil : { ...teil, revision: flaeche.revision };
                              }),
                          },
            };
        },
        pruefe(d, stand) {
            const { ebene, art } = stand.felder;
            // Ohne Art darf nur bleiben, wer nie eine hatte und die Ebene behält.
            if (art !== undefined || (ebene === d.layer && d.type === undefined)) return undefined;
            return t("landschaftseditor.grund.artFehlt", { ebene: ebenenName(ebene) });
        },
        sicherung: {
            // 3: mit Klicksperre, Kurve und „folgt dem Namen“ (2026-10-18); ältere Sicherungen gelten nicht mehr.
            version: 3,
            aus: (stand) => stand,
            ein(wert) {
                const s = wert as Partial<LandschaftStand> | null;
                if (s === null || typeof s !== "object" || typeof s.felder?.name !== "string") return undefined;
                if (typeof s.felder.ebene !== "string" || typeof s.felder.gesperrt !== "boolean") return undefined;
                if (typeof s.felder.labels !== "object" || s.felder.labels === null) return undefined;
                return { felder: s.felder, form: s.form ?? undefined };
            },
        },
    };
}
