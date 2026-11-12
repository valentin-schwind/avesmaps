import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteResponse, WaypointHit } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { createPlanner, type PlannerEffects, type PlannerMapState } from "../src/route-planner/use-planner.ts";
import { dropBox, MARK_SIZE } from "../src/route-planner/waypoint-mark-shape.ts";
import { INTERACTION_PRIORITY } from "../src/map/interaction/priorities.ts";

/**
 * **WI-0100 — „Ziel hinzufügen“ im Kartenmenü**, Betreiber 2026-10-07: „kannst du beim rechtsklick auf ein ort
 * ‚Hierhin reisen‘ ersetzen durch ‚Ziel hinzufügen‘ (mit den tropfen als icon)“, und klarstellend:
 *
 * > „‚Hierher reisen‘ ist ein klick auf der freien fläche (‚Kartenpunkt bei …‘) · ‚Ziel hinzufügen‘ fügt einen ort
 * > hinzu (wie ‚Reiseziel hinzufügen‘) · das eine ersetzt das andere wenn ich auf einen ort geklickt hat. Der
 * > Linksklick macht ein Ortsmarker gelb. Genau dasselbe will ich mit rechtsklick nur dass das Kontextmenü aufgeht.“
 *
 * 🔴 **Es sind ZWEI Einträge an einer Stelle, nicht eine Umbenennung.** Geprüft wird deshalb: welcher Eintrag wann
 * steht, dass jeder die Naht seiner gleichnamigen Aktionskachel benutzt, und dass der Rechtsklick auf einen Ort
 * durch **dasselbe** `select` läuft wie der Linksklick. Im Browser steht derselbe Beleg an der laufenden
 * Oberfläche (`e2e/ziel-hinzufuegen.spec.ts`), samt gemessener Zeilenhöhe und goldenem Ortskern.
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path: string): string => readFileSync(join(repositoryRoot, path), "utf8");

/** Ein Quelltext ohne Kommentare: Ein Kommentar darf das Verbotene nennen, um es zu begründen. */
function withoutComments(text: string): string {
    return text
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const MENU = "apps/web/src/controls/map-context-menu.vue";
const EINTRAG = "apps/web/src/controls/menue-eintrag.css";

describe("🔴 ZWEI Einträge an einer Stelle, je nachdem worauf geklickt wurde", () => {
    const bare = withoutComments(read(MENU));

    it("beide Wortlaute stehen in beiden Sprachtafeln", () => {
        expect(de["ctxmenu.travelHere"]).toBe("Hierher reisen");
        expect(de["ctxmenu.addDestination"]).toBe("Ziel hinzufügen");
        expect(en["ctxmenu.travelHere"]).toBe("Travel here");
        expect(en["ctxmenu.addDestination"]).toBe("Add destination");
    });

    it("🔴 die freie Fläche trägt Legacys Stiefel, der Ort den gezeichneten Tropfen - und jeder nur dort", () => {
        expect(bare).toMatch(
            /\{ action: "travel-here", label: "ctxmenu\.travelHere", icon: `\$\{ICONS\}schuh\.webp`, on: "point" \}/,
        );
        expect(bare).toMatch(
            /\{ action: "add-destination", label: "ctxmenu\.addDestination", mark: "ziel", on: "place" \}/,
        );
    });

    it("🔴 der Filter lässt genau einen der beiden stehen, nie beide und nie keinen", () => {
        expect(bare).toMatch(
            /entry\.on === undefined \|\| entry\.on === \(props\.atPlace === true \? "place" : "point"\)/,
        );
    });

    /*
     * 🔴 Die Aktionskennung `travel-here` BLEIBT bei der freien Fläche: Sie ist Legacys `data-context-action`
     * (`index.html:385`) und damit der Paritätsanker - ebenso der Schlüssel `travelHere.startSet`.
     */
    it("die Meldung des Startpunkts behält ihren vom Betreiber abgenommenen Satz (WI-0076)", () => {
        expect(de["travelHere.startSet"]).toBe("Kartenpunkt als Startpunkt gesetzt – jetzt fehlt noch ein Ziel.");
        expect(en["travelHere.startSet"]).toBe("Map point set as the starting point — a destination is still missing.");
    });
});

describe("🔴 Das Zeichen: der gezeichnete Tropfen, kein neues Bild", () => {
    const bare = withoutComments(read(MENU));

    it("das Menü zeichnet die Wegpunktmarke selbst; die gemalten Bilder sind alle noch da", () => {
        expect(bare).toMatch(/import WaypointMark from "\.\.\/route-planner\/waypoint-mark\.vue"/);
        expect(bare).toMatch(/<WaypointMark :rolle="entry\.mark" \/>/);
        // 🪤 `schuh.webp` bleibt in Gebrauch: Es ist das Zeichen der freien Fläche.
        for (const bild of [
            "wegweiser.webp",
            "schuh.webp",
            "brief.webp",
            "fernrohr.webp",
            "lupe.webp",
            "lineal.webp",
        ]) {
            expect(bare, bild).toContain(bild);
        }
    });

    it("🪤 das Bauteil bekommt KEINEN `size`-Parameter zurück (WI-0097)", () => {
        expect(bare).not.toMatch(/<WaypointMark[^>]*\bsize\b/);
        expect(withoutComments(read("apps/web/src/route-planner/waypoint-mark.vue"))).toMatch(
            /defineProps<\{ rolle: "wegpunkt" \| "ziel" \}>\(\)/,
        );
    });

    it("die Nadel wird auf die Bildhöhe der Nachbarn gestellt - 18 von 24, aus vorhandenen Werten", () => {
        expect(dropBox(MARK_SIZE)).toEqual({ width: 14, height: 24 });
        // Legacys Bildkante im Kartenmenü, in der Klasse und in der Rechnung dieselbe Zahl. Die Klasse steht seit WI-0178 A4 in der
        // gemeinsamen Fassung der Menüeinträge (`menue-eintrag.css`), die das Kartenmenü einbindet.
        expect(bare).toMatch(/<style scoped src="\.\/menue-eintrag\.css"><\/style>/);
        expect(withoutComments(read(EINTRAG))).toMatch(/\.context-menu__icon \{[^}]*width: 18px;[^}]*height: 18px;/);
        expect(bare).toMatch(/const ICON_SIZE = 18;/);
        expect(bare).toMatch(/const markScale = String\(ICON_SIZE \/ dropBox\(MARK_SIZE\)\.height\);/);
        expect(bare).toMatch(/transform: scale\(v-bind\(markScale\)\);/);
        expect(18 / dropBox(MARK_SIZE).height).toBe(0.75);
    });

    it("der Kasten der Nadel trägt dieselbe Klasse wie ein Bild - gleiche Fläche, gleiche Zeilenhöhe", () => {
        expect(bare).toMatch(/class="context-menu__icon context-menu__icon--mark"/);
        expect(bare).toMatch(/\.context-menu__icon--mark \{[^}]*place-items: center;/);
    });
});

/* ---------------------------------------------------------------- Das Verhalten ---------------------------------- */

function effectsSpy() {
    const calls = { maps: [] as PlannerMapState[], notes: [] as string[], addresses: [] as string[] };
    const effects: PlannerEffects = {
        showOnMap: (state) => calls.maps.push(state),
        fitRoute: () => undefined,
        showPlace: () => undefined,
        notify: (message) => calls.notes.push(message),
        writeAddress: (query) => calls.addresses.push(query),
    };
    return { calls, effects };
}

const answer = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

function hit(name: string): WaypointHit {
    return { id: `id-${name}`, name, subtype: "dorf", hidden: false, x: 1, y: 2 };
}

/** Eine gefundene Route; die Zahlen spielen hier keine Rolle, nur dass der Planer „ready“ wird. */
function routeOf(stages: number): RouteResponse {
    const segments = Array.from({ length: stages }, () => ({
        kind: "path" as const,
        path_public_id: "p",
        name: "Weg",
        surface: "unpaved" as const,
        points: [
            [0, 0],
            [1, 1],
        ] as [number, number][],
        length_units: 1,
        hours: 1,
    }));
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        total_length_units: stages,
        total_hours: stages,
        stages: segments.map((segment, index) => ({
            from: { name: `A${String(index)}`, x: 0, y: 0 },
            to: { name: `A${String(index + 1)}`, x: 1, y: 1 },
            length_units: 1,
            hours: 1,
            segments: [segment],
        })),
    } as unknown as RouteResponse;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("🔴 Das Verhalten muss zur Beschriftung passen - und zwar je Eintrag", () => {
    /** Der Namensdienst des Kartenpunkts antwortet „kein Ort in der Nähe“; die Route wird gefunden. */
    function stubFetch(stages = 2): void {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>((input) =>
                String(input).includes("/nearest") ? answer({ place: null, distance: null }) : answer(routeOf(stages)),
            ),
        );
    }

    it("leere Reise: der Ort wird der START, und die Meldung sagt, dass noch ein Ziel fehlt", () => {
        stubFetch();
        const planner = createPlanner(effectsSpy().effects);

        expect(planner.addMapPoint({ x: 10, y: 20 }), "noch kein Ziel: der Aufrufer meldet den Startpunkt").toBe(true);
        expect(planner.waypoints).toHaveLength(1);
        expect(planner.waypoints[0]?.place?.id).toBe("p:10:20");
    });

    it("🔴 bestehende Reise mit DREI Stationen: der Ort hängt als VIERTE hinten an - nichts wird ersetzt", async () => {
        stubFetch(2);
        const planner = createPlanner(effectsSpy().effects);
        const first = planner.waypoints[0]?.key ?? 0;
        planner.setPlace(first, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Greifenfurt"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => {
            expect(planner.filled.value).toHaveLength(3);
        });

        expect(planner.addMapPoint({ x: 30, y: 40 }), "es fehlt kein Ziel mehr").toBe(false);

        expect(planner.waypoints.map((row) => row.place?.name)).toEqual([
            "Gareth",
            "Greifenfurt",
            "Perricum",
            "Kartenpunkt",
        ]);
        expect(planner.waypoints.at(-1)?.place?.id).toBe("p:30:40");
    });

    it("eine WARTENDE leere Zeile wird gefüllt, statt eine fünfte anzulegen (Legacy `fillLastEmptyWaypointOrAppend`)", async () => {
        stubFetch(2);
        const planner = createPlanner(effectsSpy().effects);
        const first = planner.waypoints[0]?.key ?? 0;
        planner.setPlace(first, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Greifenfurt"));
        await vi.waitFor(() => {
            expect(planner.filled.value).toHaveLength(2);
        });
        planner.addWaypoint();
        expect(planner.waypoints).toHaveLength(3);

        planner.addMapPoint({ x: 30, y: 40 });

        expect(planner.waypoints).toHaveLength(3);
        expect(planner.waypoints.at(-1)?.place?.id).toBe("p:30:40");
    });

    it("🔴 ein ORT kommt als Ort in die Reise, nicht als Kartenpunkt - und auch er hängt hinten an", async () => {
        stubFetch(2);
        const planner = createPlanner(effectsSpy().effects);
        const first = planner.waypoints[0]?.key ?? 0;
        planner.setPlace(first, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Greifenfurt"));
        await vi.waitFor(() => {
            expect(planner.filled.value).toHaveLength(2);
        });

        planner.addPlace(hit("Perricum"));

        expect(planner.waypoints.map((row) => row.place?.name)).toEqual(["Gareth", "Greifenfurt", "Perricum"]);
        // Kein Kartenpunkt: die Kennung ist die des Orts, nicht `p:x:y`.
        expect(planner.waypoints.at(-1)?.place?.id).toBe("id-Perricum");
    });

    it("🪤 ein Ort, der schon in der Reise steht, kommt nicht zweimal hinein (Legacy)", async () => {
        stubFetch(2);
        const planner = createPlanner(effectsSpy().effects);
        const first = planner.waypoints[0]?.key ?? 0;
        planner.setPlace(first, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Greifenfurt"));
        await vi.waitFor(() => {
            expect(planner.filled.value).toHaveLength(2);
        });

        planner.addPlace(hit("Gareth"));

        expect(planner.waypoints.map((row) => row.place?.name)).toEqual(["Gareth", "Greifenfurt"]);
    });

    it("🔴 jede Zeile benutzt DIESELBE Naht wie die gleichnamige Aktionskachel des Infopanels", () => {
        const panel = withoutComments(read("apps/web/src/info-panel/panel-actions.ts"));
        const app = withoutComments(read("apps/web/src/app.vue"));
        // Freie Fläche: Kartenpunkt.
        expect(panel).toMatch(/case "addMapPoint":[\s\S]{0,200}planner\.addMapPoint\(\{ x: run\.x, y: run\.y \}\)/);
        expect(app).toMatch(/action === "travel-here"[\s\S]{0,200}planner\.addMapPoint\(point\)/);
        // Ort: der Ort selbst.
        expect(panel).toMatch(/case "addPlace":[\s\S]{0,200}planner\.addPlace\(run\.hit\)/);
        // Dieselbe Naht auch für die Landmarke (WI-0271 L6): Der Ort kommt, wie er ist, die Landmarke als ihr Wegpunkt (`landmarkeAlsZiel`).
        expect(app).toMatch(
            /action === "add-destination"[\s\S]{0,400}const ziel = contextPlace \? \{ \.\.\.contextPlace, hidden: false \} : contextLandmarke;\s+if \(ziel\) \{\s+planner\.addPlace\(ziel\);/,
        );
    });

    it("🔴 der Ortsfall meldet NICHTS - wie die Kachel; `travelHere.startSet` gehört dem Kartenpunkt", () => {
        const app = withoutComments(read("apps/web/src/app.vue"));
        const ortsfall =
            /action === "add-destination"([\s\S]*?)\} else if \(action === "nearest"\)/.exec(app)?.[1] ?? "";
        expect(ortsfall, "der Ortszweig wurde nicht gefunden").toContain("planner.addPlace");
        expect(ortsfall).not.toContain("startSet");
        expect(ortsfall).not.toContain("showToast");
    });
});

describe("🔴 Der Rechtsklick auf einen Ort wählt ihn - dieselbe Naht wie der Linksklick", () => {
    const owners = withoutComments(read("apps/web/src/map/interaction/owners.ts"));

    it("der Besitzer `place` nimmt den Rechtsklick an - und damit auch den langen Druck (WI-0108)", () => {
        expect(owners).toMatch(/id: "place",[\s\S]{0,200}kinds: \["click", "hover", "contextmenu"\]/);
    });

    it("🔴 er ruft EIN `select` für beide Arten, und erst danach das Menü", () => {
        const zweig =
            /if \(kind !== "click" && kind !== "contextmenu"\) return;([\s\S]*?)\n {8}\},/.exec(owners)?.[1] ?? "";
        expect(zweig, "der Zweig wurde nicht gefunden").toContain("input.select(place, context.screen)");
        // Genau EIN Aufruf: eine zweite Fassung für den Rechtsklick wäre genau der Fehler.
        expect(zweig.match(/input\.select\(/g)).toHaveLength(1);
        expect(zweig).toMatch(
            /if \(kind === "contextmenu"\)[\s\S]{0,160}input\.menu\?\.\(place, context\.screen, context\.lngLat\)/,
        );
        // Kein Browsermenü neben unserem.
        expect(zweig).toContain("context.event.preventDefault()");
    });

    it("er steht über dem allgemeinen Kontextmenü - sonst bekäme der den Rechtsklick", () => {
        expect(INTERACTION_PRIORITY.place).toBeGreaterThan(INTERACTION_PRIORITY.context);
    });
});
