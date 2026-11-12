import { onScopeDispose, shallowRef, watch } from "vue";
import {
    ROUTE_STAGE_LORE_LIMITS,
    ROUTE_STAGE_LORE_URL,
    ROUTE_UNTERWEGS_LIMITS,
    type LoreRowView,
    type RouteResponse,
    type RouteStage,
    type RouteStageLoreResponse,
    type RouteUnterwegsRequest,
} from "@avesmaps3d/shared";
import { loreRowsOfSection } from "../info-panel/lore-model";
import { loreRowModels } from "../info-panel/panel-rows";
import type { RowModel } from "../info-panel/panel-types";
import { holeBeigabe } from "./load-retry";

/**
 * Die Vorkommen einer ROUTENETAPPE im Infopanel (WI-0106): Waren, Fauna, Flora, Spezies - alles, was in den Flächen vorkommt,
 * die die Wegkette dieser Etappe berühren.
 *
 * 🔴 **Die Etappe selbst ist der Träger** (Betreiber 2026-10-06, wörtlich in der Regel des Enthaltenseins: „dasselbe für wege,
 * **routenetappen**, landschaften, politische regionen usw.“; 2026-10-07: „kannst du die lore auch in etappen anzeigen“).
 * Gerechnet wird mit DERSELBEN Stelle wie bei einem Weg - das Enthaltensein einer Linie ist seit WI-0103 auf eine Stelle gezogen
 * und nimmt schon eine LISTE von Wegen. Eine Etappe hat deshalb, wie ein Weg, nur „Aus der Region“ und den Link „Überall in
 * Aventurien“.
 *
 * 🔴 **IM INFOPANEL, NICHT IM REISEPLAN** - und das ist keine eigene Wahl, sondern eine Entscheidung, die in Legacy schon
 * gefallen ist. Der Owner am 2026-08-12 (`js/routing/__tests__/route-leg-lore-klima.test.js`): „zieh etappen nach, die sollen
 * auch alle 4 anzeigen" — **„aber nicht im routenplaner sondern im infopanel"**. Legacys Prüffall schreibt dazu: „Die
 * Etappen-ZEILE im Reiseplan … bleibt unberuehrt — sie ist die Erzaehlung, die Infobox der Beleg. Wer hier eine Zeile ergaenzt
 * und dabei den Planer mitnimmt, hat den Auftrag verfehlt.“ Die Etappenliste ist deshalb unberührt.
 *
 * ⭐ **Gemessen, und es dreht die Erwartung um: eine Etappe ist der GÜNSTIGSTE Träger.** Ein Weg heißt „Reichsstraße 2“ und
 * zieht sich über den halben Kontinent (105 Abschnitte, Median 56 Einträge, höchstens 395, Antwort 20 393 B; WI-0103). Eine
 * Etappe ist das STÜCK zwischen zwei Punkten: über vier Reisen (16, 31, 9 und 73 Etappen) berührt sie 2 bis 30 Träger und erbt
 * im Median 23 Einträge, höchstens 130 - Antwort im Median 2,0 kB, höchstens 8,3 kB, Abfrage im Median 3 bis 5 ms.
 *
 * 🔴 **Darum kommen Zähler UND Namen in EINEM Lauf**, anders als am Ort (dort stehen die Zähler im Detail und die Namen werden
 * beim Aufklappen geholt, weil ein Ort im Median 47 und bis zu 256 Einträge trägt). Die Zeile bringt ihre Antwort mit; ein
 * Aufklappen fragt nichts nach.
 *
 * 🔴 **Nicht an eine Geste gehängt** (`AGENTS.md`, „Beim Ziehen wird nicht nachgeschlagen“): Gefragt wird, wenn eine Etappe im
 * Panel STEHT - einmal je Etappe, abbrechbar, und aus einem kleinen Speicher, solange die Reise dieselbe ist. Ein Wegpunkt, den
 * jemand zieht, fragt nichts; die Reise wird gerechnet, wenn sie sich ändert, und erst dann gilt eine neue Etappe.
 */

/**
 * Die Wege, aus denen eine Etappe besteht: die öffentlichen Kennungen ihrer echten Abschnitte, jede einmal.
 *
 * 🔴 **Alle Abschnitte, nicht nur die mit gezeigtem Namen.** Die Etappenzeile nennt den ersten echten WEGNAMEN (`stagePath`,
 * `isShownPathName`) - hier geht es um Geometrie, und ein Weg mit Griffnamen („Pfad-3443“) liegt genauso in einer Landschaft
 * wie eine Reichsstraße. 🪤 Ein erzeugter Abschnitt (`synthetic`, Querfeldein) hat keine Zeile in `path` und fällt weg; eine
 * Etappe ganz aus solchen Abschnitten fragt mit einer LEEREN Liste - und bekommt trotzdem die vier Zeilen mit dem Link, weil
 * „Überall in Aventurien“ überall steht (WI-0103).
 */
export function stagePathIds(stage: RouteStage, route: RouteResponse): string[] {
    const found = new Set<string>();
    const segments = route.segments.slice(stage.segment_start, stage.segment_start + stage.segment_count);
    for (const segment of segments) {
        if (segment.synthetic || segment.public_id === "") continue;
        found.add(segment.public_id);
        // 🪤 Die Schranke des Vertrags steht auch hier: Eine Anfrage, die das Schema abweist, wäre eine Zeile, die stumm fehlt
        // (gemessen höchstens 13 Wege je Etappe, der Deckel liegt bei 64).
        if (found.size >= ROUTE_STAGE_LORE_LIMITS.paths) break;
    }
    return [...found];
}

/**
 * Die Linien der Abschnitte OHNE Weg (`synthetic`: querfeldein, freies Wasser) in Kartenkoordinaten, je Linie flach `[x0, y0, x1, y1, …]` auf zwei Stellen
 * gerundet (WI-0257 S2). Ein solcher Abschnitt hat keine Zeile in `path`; ohne seinen Verlauf bliebe die Etappe leer, obwohl sie durch Wald führt.
 *
 * 🪤 Die Schranken des Vertrags stehen auch hier (`ROUTE_STAGE_LORE_LIMITS`): höchstens 16 Linien zu 200 Stützpunkten; eine längere Linie wird gleichmäßig
 * ausgedünnt, Anfang und Ende bleiben. Eine Anfrage, die das Schema abweist, wäre eine Zeile, die stumm fehlt.
 */
export function stageLines(stage: RouteStage, route: RouteResponse): number[][] {
    const lines: number[][] = [];
    const segments = route.segments.slice(stage.segment_start, stage.segment_start + stage.segment_count);
    for (const segment of segments) {
        if (!segment.synthetic) continue;
        const points = segment.geometry.coordinates;
        if (points.length < 2) continue;
        const keep = Math.min(points.length, ROUTE_STAGE_LORE_LIMITS.vertices);
        const line: number[] = [];
        for (let at = 0; at < keep; at += 1) {
            const point = points[keep === 1 ? 0 : Math.round((at * (points.length - 1)) / (keep - 1))];
            if (point === undefined) continue;
            line.push(Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100);
        }
        lines.push(line);
        if (lines.length >= ROUTE_STAGE_LORE_LIMITS.lines) break;
    }
    return lines;
}

/**
 * Die Anfrage nach den Vorkommen der ganzen Route (`POST /api/route/unterwegs`, WI-0257 S4): je Etappe ihre Wege und Linien, dieselben wie bei `stage/lore`; `null`, wo es keine Anfrage
 * geben kann (nichts gefunden, ohne Etappen, mehr Etappen als der Vertrag erlaubt). Hier und nicht in `unterwegs.ts`, weil auch die Landschaften der Route sie mitnehmen (WI-0292).
 */
export function unterwegsAnfrage(route: RouteResponse): RouteUnterwegsRequest | null {
    if (!route.found || route.stages.length === 0 || route.stages.length > ROUTE_UNTERWEGS_LIMITS.stages) return null;
    return {
        stages: route.stages.map((stage) => {
            const lines = stageLines(stage, route);
            return { paths: stagePathIds(stage, route), ...(lines.length === 0 ? {} : { lines }) };
        }),
    };
}

/** Der Schlüssel einer Etappe im Speicher: ihre Wege, in fester Reihenfolge, und ihre Linien - zwei Etappen über dasselbe fragen einmal. */
const keyOf = (paths: readonly string[], lines: readonly (readonly number[])[] = []): string =>
    [...paths].sort().join(",") + (lines.length === 0 ? "" : `|${lines.map((line) => line.join(",")).join(";")}`);

/**
 * Holt die Vorkommen einer Etappe; `null`, wenn es nicht gelingt. Eine Absage wegen Last (503 `busy`, der Server rechnet je Prozess höchstens zwei dieser
 * Abfragen) fragt sie wie die Route selbst noch einmal, die Drossel (429) einmal (`holeBeigabe`, WI-0292), aber ohne Meldung.
 *
 * 🔴 Scheitert sie endgültig, bleibt die Etappe, wie sie ist: Die vier Zeilen fehlen, der Rest des Panels nicht. Das ist
 * dieselbe Haltung wie bei den Landschaften der Route - eine Beigabe nimmt dem Panel nichts weg, wenn das Netz klemmt.
 */
export async function fetchStageLore(
    paths: readonly string[],
    signal?: AbortSignal,
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    lines: readonly (readonly number[])[] = [],
): Promise<RouteStageLoreResponse | null> {
    const request: RequestInit = {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            paths: [...paths],
            ...(lines.length === 0 ? {} : { lines: lines.map((line) => [...line]) }),
        }),
        ...(signal ? { signal } : {}),
    };
    return (await holeBeigabe<RouteStageLoreResponse>(ROUTE_STAGE_LORE_URL, request, fetcher)).antwort;
}

/**
 * Die vier Zeilen der Feldliste aus der Antwort - in der Reihenfolge, in der der Server sie nennt (`LORE_ROWS`: Waren, Fauna,
 * Flora, Spezies).
 *
 * 🔴 **Jede Zeile bringt die ganze Antwort mit** (`section`), nicht nur ihre eigene: Die vier Zeilen EINER Etappe teilen EINEN
 * Lauf, genau wie am Ort (WI-0091 A10). 🪤 Und keine `ref`: Eine Etappe ist kein Kartenobjekt, sie hat keine Adresse, unter der
 * eine Sektion nachgeholt werden könnte - deshalb muss der Inhalt schon hier stehen.
 *
 * 🪤 Gerechnet wird das in `loreRowsOfSection` (`info-panel/lore-model.ts`), seit der KARTENPUNKT dieselbe Lage hat
 * (WI-0110): auch er bringt seine Antwort mit, und zwei Fassungen derselben Abbildung wären eine zu viel.
 */
export function stageLoreRows(section: { rows: readonly LoreRowView[] }): RowModel[] {
    return loreRowModels(loreRowsOfSection(section));
}

/** Was die Oberfläche von hier braucht: die Zeilen der Etappe `index`, oder `null`, solange es keine gibt. */
export interface StageLoreSource {
    stageLore(index: number): { rows: readonly LoreRowView[] } | null;
}

/**
 * Die Vorkommen der jeweils GEZEIGTEN Etappe. Eine andere Etappe bricht die Frage nach der alten ab, ebenso der Abbau des
 * Panels; eine andere Reise leert den Speicher, denn ihre Etappen sind andere.
 *
 * 🪤 **Gefragt wird nur, was im Panel steht.** Die Wiedergabe wählt Etappe um Etappe (`route-player.vue`), aber sie ÖFFNET das
 * Panel nie (`planner-binding.ts`): Ohne offenes Panel entsteht hier keine einzige Frage. Läuft sie mit offenem Panel, fragt
 * jede Etappe einmal - im Median 3 bis 5 ms -, und der Weg zurück kommt aus dem Speicher.
 */
export function useStageLore(
    route: () => RouteResponse | null,
    stage: () => number | null,
    fetcher?: typeof fetch,
): StageLoreSource {
    const known = shallowRef(new Map<string, { rows: readonly LoreRowView[] }>());
    let cachedRoute: RouteResponse | null = null;
    let controller: AbortController | undefined;

    watch(
        () => [route(), stage()] as const,
        async ([current, index]) => {
            controller?.abort();
            if (current !== cachedRoute) {
                cachedRoute = current;
                known.value = new Map();
            }
            const found = current === null || index === null ? undefined : current.stages[index];
            if (found === undefined) return;
            const paths = stagePathIds(found, current as RouteResponse);
            const lines = stageLines(found, current as RouteResponse);
            const key = keyOf(paths, lines);
            if (known.value.has(key)) return;
            const own = new AbortController();
            controller = own;
            const answer = await fetchStageLore(paths, own.signal, fetcher, lines);
            // 🪤 Nicht nur `controller === own`: Zwischen Frage und Antwort kann eine andere REISE dastehen, und deren
            // Speicher darf die Antwort auf eine fremde Etappe nicht aufnehmen.
            if (controller !== own || cachedRoute !== current || answer === null) return;
            const next = new Map(known.value);
            next.set(key, { rows: answer.rows });
            known.value = next;
        },
        { immediate: true },
    );
    onScopeDispose(() => controller?.abort());

    return {
        stageLore(index) {
            const current = route();
            const found = current?.stages[index];
            if (current === undefined || current === null || found === undefined) return null;
            return known.value.get(keyOf(stagePathIds(found, current), stageLines(found, current))) ?? null;
        },
    };
}
