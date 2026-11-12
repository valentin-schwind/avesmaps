import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, type Database } from "../../server/src/database.ts";
import { formeUmIn, pruefeFlaechen } from "../../server/src/editor/landscape-reshape.ts";
import { formeGebietUmIn, pruefeGebietsflaechen } from "../../server/src/editor/territory-reshape.ts";
import type { MapActor } from "../../server/src/editor/map-operation.ts";
import { ApiError } from "../../server/src/http/api-error.ts";
import { importRegions } from "../../server/src/migration/region-import.ts";
import type { LegacyAreaPayload, LegacyMapPayload, LegacyRegionPayload } from "../../server/src/migration/regions.ts";
import type { LegacyTerritoryPayload } from "../../server/src/migration/territories.ts";
import { importTerritories } from "../../server/src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "../../server/test/support/vps-cluster.ts";
import { FLAECHE, GEBIET } from "../src/map/geometrie/arten.ts";
import { createFormentwurf, teileAus, type FormStand, type FormStart } from "../src/map/geometrie/formentwurf.ts";
import { aufbauAus, operationAus } from "../src/map/geometrie/formoperation.ts";
import type { Aenderung, GeometrieArt, Punkt, Teil } from "../src/map/geometrie/geometrie.ts";
import type { GeometrieEingabe, GeometrieModus } from "../src/map/geometrie/modus.ts";
import {
    aufGemeinsamerKante,
    gruppeVerschoben,
    mitziehende,
    mitziehendeAller,
    ohnePunkt,
    stellenAn,
    teilMit,
    teilungsPunkte,
} from "../src/map/geometrie/rechnung.ts";

/**
 * Ein ungeduldiger Editor gegen den echten Server (Vali 2026-11-10: „ok der fehler mit den ecken bearbeiten und dem server, der irgendwas
 * nicht geblickt hat, kann man da nochmal den fokus drauflegen, dass sowas nicht wieder passiert“). Zufällige Folgen von Handbewegungen an
 * einem schmalen Streifen mit Nachbarn: einrasten an Ecken und Kanten der Nachbarn, mit Strg lösen, Ecke auf Ecke, mehrere Ecken markiert
 * ziehen, Punkte setzen und löschen, ↶ und ↷. Die Handbewegungen baut der Test so, wie der Geometrie-Modus sie meldet (`modus.ts`: Mitziehen,
 * gemeinsame Kante, Löschen), und gibt sie an den ECHTEN Formentwurf (`createFormentwurf` mit `pruefeSchritte`, wie „Ecken bearbeiten“).
 *
 * 🔴 Jeder Stand, den der Entwurf danach hält, geht als Körper von „Fertig“ (`operationAus`) durch die Prüfung des Servers
 * (`pruefeFlaechen`, `formeUmIn`) in einem Wegwerf-PostgreSQL, und die Transaktion wird zurückgerollt. Der Server muss JEDEN Stand annehmen:
 * Jede Ablehnung heißt, der Editor hat einen Schritt angenommen, den der Server ablehnt. Die Meldung nennt Saat und Schritte, damit sich der
 * Fall nachstellen lässt.
 *
 * Dasselbe an Gebieten (`GEBIET`, `pruefeGebietsflaechen`, `formeGebietUmIn`): Seit 2026-11-10 prüft der Server auch dort, ob sich die Form
 * kreuzt. Das Moor ist in beiden Fällen schon beim Start kaputt (es stößt an sich selbst, wie 19 von 906 Gebietsflächen der Stage): Es muss
 * bearbeitbar bleiben, wenn die Schritte es mitziehen.
 *
 * Die Rundung (R) ändert nur die Vorschau, nie die Ecken; sie kommt darum nicht vor.
 *
 * Gegenproben (2026-11-10): Ohne `pruefeSchritte` fand der Test nach 11, 33 und 38 Saaten `ring_unter_drei`, so wie die Editoren es auf der
 * Stage trafen. Mit der Prüfung nahm der Server alle 1.123 Stände an, und von 370 Schritten, die der Editor nicht übernahm, hätte der Server
 * jeden abgelehnt (188 und 172 als `form_ungueltig`, 10 als `ring_unter_drei`): Der Editor ist nicht strenger als der Server.
 */

const ENV = "eckenzufall";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../../server/src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const AU = "e1e1e1e1-0000-4000-8000-000000000001";
const WIESE = "e1e1e1e1-0000-4000-8000-000000000002";
const ZIPFEL = "e1e1e1e1-0000-4000-8000-000000000003";
const MOOR = "e1e1e1e1-0000-4000-8000-000000000004";
const FLAECHE_VON: Record<string, string> = {
    [AU]: "e1e1e1e1-0000-4000-8000-0000000000a1",
    [WIESE]: "e1e1e1e1-0000-4000-8000-0000000000a2",
    [ZIPFEL]: "e1e1e1e1-0000-4000-8000-0000000000a3",
    [MOOR]: "e1e1e1e1-0000-4000-8000-0000000000a4",
};
type Ring = [number, number][];
const unten: Ring = Array.from({ length: 11 }, (_, i) => [300 + 10 * i, 330]);
const oben: Ring = Array.from({ length: 11 }, (_, i) => [400 - 10 * i, 334]);
/** Ein Streifen am Fluss, 100 lang und 4 breit, wie Fläche-452. */
const AU_RING: Ring = [...unten, ...oben];
/** Darüber, mit allen oberen Ecken gemeinsam. */
const WIESE_RING: Ring = [...[...oben].reverse(), [400, 350], [300, 350]];
/** Ein Zwickel am rechten Ende mit nur drei Ecken, zwei davon gemeinsam. */
const ZIPFEL_RING: Ring = [
    [400, 330],
    [410, 332],
    [400, 334],
];
/**
 * Darunter, nur die linke untere Ecke gemeinsam; seine Ecken (320, 326) und (340, 326) liegen dicht am Streifen. Schon kaputt (Legacy): Die Ecke
 * (330, 320) liegt auf seiner eigenen Unterkante. Der Import nimmt es heil an, `beforeAll` setzt es danach so.
 */
const MOOR_HEIL: Ring = [
    [300, 330],
    [300, 320],
    [340, 320],
    [340, 326],
    [320, 326],
];
const MOOR_RING: Ring = [
    [300, 330],
    [300, 320],
    [340, 320],
    [340, 326],
    [330, 326],
    [330, 320],
    [320, 326],
];
const RINGE: Record<string, Ring> = { [AU]: AU_RING, [WIESE]: WIESE_RING, [ZIPFEL]: ZIPFEL_RING, [MOOR]: MOOR_RING };
const NAMEN: Record<string, string> = { [AU]: "Au", [WIESE]: "Wiese", [ZIPFEL]: "Zipfel", [MOOR]: "Moor" };

function quelle(): { regions: LegacyRegionPayload; areas: LegacyAreaPayload; labels: LegacyMapPayload } {
    return {
        regions: {
            ok: true,
            regions: Object.keys(RINGE).map((id) => ({
                public_id: id,
                name: NAMEN[id],
                kind: "vegetation",
                region_type: "wald",
                area_count: 1,
            })),
        } as never,
        areas: {
            ok: true,
            revision: 9501,
            truncated: false,
            areas: Object.entries(RINGE).map(([id, ring]) => ({
                public_id: FLAECHE_VON[id],
                region_public_id: id,
                geometry: { type: "Polygon", coordinates: [geschlossen(id === MOOR ? MOOR_HEIL : ring)] },
            })),
        } as never,
        labels: {
            ok: true,
            revision: 9502,
            features: Object.entries(RINGE).map(([id, ring], i) => ({
                geometry: { type: "Point", coordinates: ring[0] },
                properties: {
                    feature_type: "label",
                    public_id: `e1e1e1e1-0000-4000-8000-0000000000c${String(i)}`,
                    name: NAMEN[id],
                    ecosystem_region_public_id: id,
                },
            })),
        } as never,
    };
}

const geschlossen = (ring: Ring): Ring => [...ring, ring[0]!];

/** Dieselben vier als Baronien. */
function gebiete(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-eckenzufall",
        territories: Object.keys(RINGE).map((id) => ({
            public_id: id,
            name: NAMEN[id],
            short_name: "",
            type: "Baronie",
            wiki_type: "Baronie",
            parent_public_id: null,
            status: "",
            color: "#b2b065",
            opacity: 0.7,
            min_zoom: 4,
            max_zoom: 6,
            valid_from_bf: 100,
            valid_to_bf: 9999,
            valid_label: "",
            wiki_key: `wiki:${NAMEN[id]!}`,
            wiki_url: null,
            capital_place_public_id: null,
            seat_place_public_id: null,
            sort_order: 0,
            updated_at: "2026-11-10 01:00:00",
            coat_of_arms_url: "",
            coat_license_status: "",
            coat_origin: "",
        })),
        geometries: Object.entries(RINGE).map(([id, ring]) => ({
            public_id: FLAECHE_VON[id],
            territory_public_id: id,
            geometry: { type: "Polygon", coordinates: [geschlossen(id === MOOR ? MOOR_HEIL : ring)] },
            valid_from_bf: null,
            valid_to_bf: null,
            min_zoom: null,
            max_zoom: null,
            updated_at: "2026-11-10 01:00:00",
        })),
        claims: [],
    } as unknown as LegacyTerritoryPayload;
}

/** Ein kleiner Zufall mit Saat (mulberry32): Dieselbe Saat gibt dieselbe Folge. */
function zufall(saat: number): () => number {
    let a = saat >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Die Revision je Fläche, wie die Datenbank sie nach dem Aufbau führt (das Kaputtmachen des Moors zählt mit). */
type Revisionen = ReadonlyMap<string, number>;
const teilVon = (id: string, revision: Revisionen): Teil[] =>
    teileAus(
        [{ id: FLAECHE_VON[id]!, revision: revision.get(FLAECHE_VON[id]!) ?? 1, polygons: [[RINGE[id]!]] }],
        NAMEN[id]!,
    );
const startVon = (revision: Revisionen): FormStand => ({
    teile: teilVon(AU, revision),
    nachbarn: [...teilVon(WIESE, revision), ...teilVon(ZIPFEL, revision), ...teilVon(MOOR, revision)],
});
const AUFBAU = aufbauAus(Object.values(FLAECHE_VON).map((id) => ({ id, polygons: [[[]]] })));

/** Eine Handbewegung, wie der Geometrie-Modus sie aus dem Stand `s` meldet; `undefined`, wenn der Zug nichts täte. */
function handbewegung(
    s: FormStand,
    r: () => number,
    protokoll: string[],
): Aenderung | "zurueck" | "wieder" | undefined {
    const eigen = s.teile[0]!;
    const n = eigen.punkte.length;
    const wahl = r();
    const index = Math.floor(r() * n);
    const von = eigen.punkte[index]!;
    const nachbarEcken = s.nachbarn.flatMap((t) => t.punkte);
    if (wahl < 0.1) {
        protokoll.push("↶");
        return "zurueck";
    }
    if (wahl < 0.16) {
        protokoll.push("↷");
        return "wieder";
    }
    if (wahl < 0.24 && n > 3) {
        // Doppelklick auf eine Ecke: Sie geht; was beim Nachbarn darauf liegt, entscheidet der Entwurf (`ausDemEntwurf`).
        protokoll.push(`löschen ${String(index)}`);
        return {
            art: "loeschen",
            stelle: { objekt: eigen.objekt, nr: eigen.nr, index },
            teile: [teilMit(eigen, ohnePunkt(eigen.punkte, index))],
            mitgezogen: [],
            entfernt: stellenAn(von, s.nachbarn).map(({ objekt, nr, index: i }) => ({
                stelle: { objekt, nr, index: i },
            })),
            treffer: undefined,
            getrennt: false,
        };
    }
    if (wahl < 0.34) {
        // Doppelklick auf eine Kante, oft knapp neben eine Ecke, oder Strg + Klick (vier Punkte): auf einer gemeinsamen Kante auch in die
        // Nachbarn.
        const position = 1 + Math.floor(r() * n);
        const a = eigen.punkte[position - 1]!;
        const b = eigen.punkte[position % n]!;
        const vier = r() < 0.3;
        const t = r() < 0.5 ? r() * 0.05 : r();
        const neue = vier ? teilungsPunkte(a, b) : [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
        protokoll.push(`${vier ? "vier Punkte" : "Punkt"} vor ${String(position)}`);
        const punkte = [...eigen.punkte.slice(0, position), ...neue, ...eigen.punkte.slice(position)];
        const eingefuegt = aufGemeinsamerKante(eigen, position, vier ? neue : neue[0]!, s.nachbarn);
        return {
            art: "einfuegen",
            stelle: { objekt: eigen.objekt, nr: eigen.nr, index: position },
            teile: [teilMit(eigen, punkte)],
            mitgezogen: [],
            ...(eingefuegt.length > 0 ? { eingefuegt } : {}),
            treffer: undefined,
            getrennt: false,
        };
    }
    if (wahl < 0.42) {
        // Umschalt + Klick: zwei oder drei Ecken markiert und gemeinsam gezogen, ohne Einrasten.
        const auch = [...new Set([index, Math.floor(r() * n), Math.floor(r() * n)])].slice(0, 2 + Math.floor(r() * 2));
        const dx = (r() - 0.5) * 8;
        const dy = (r() - 0.5) * 8;
        const strg = r() < 0.3;
        protokoll.push(`markiert ${auch.join(",")} um ${dx.toFixed(2)},${dy.toFixed(2)}${strg ? " Strg" : ""}`);
        const gruppe = auch.slice(1).map((i) => ({
            stelle: { objekt: eigen.objekt, nr: eigen.nr, index: i },
            revision: eigen.revision,
            von: eigen.punkte[i]!,
        }));
        const eigene = gruppeVerschoben(gruppe, dx, dy);
        const nach = { x: von.x + dx, y: von.y + dy };
        const punkte = eigen.punkte.map((p, i) =>
            i === index ? nach : (eigene.find((e) => e.stelle.index === i)?.nach ?? p),
        );
        return {
            art: "ziehen",
            stelle: { objekt: eigen.objekt, nr: eigen.nr, index },
            auch: gruppe.map((g) => g.stelle),
            teile: [teilMit(eigen, punkte)],
            mitgezogen: mitziehendeAller([{ von, nach }, ...eigene], s.nachbarn, [], strg),
            treffer: undefined,
            getrennt: strg,
        };
    }
    // Ein Zug: einrasten an einer Ecke eines Nachbarn (oft die nächste: Ecke auf Ecke im schmalen Streifen), an einer seiner Kanten, oder
    // frei; Strg, auch mitten im Zug gedrückt, heißt: nie eingerastet, nichts zieht mit.
    const strg = r() < 0.3;
    const ziel = r();
    let nach: Punkt;
    if (!strg && ziel < 0.25 && nachbarEcken.length > 0) {
        const naechste = [...nachbarEcken]
            .filter((p) => p.x !== von.x || p.y !== von.y)
            .sort((p, q) => Math.hypot(p.x - von.x, p.y - von.y) - Math.hypot(q.x - von.x, q.y - von.y));
        nach = naechste[Math.floor(r() * Math.min(3, naechste.length))]!;
        protokoll.push(`Ecke ${String(index)} auf nahe Nachbarecke ${nach.x.toFixed(3)},${nach.y.toFixed(3)}`);
    } else if (!strg && ziel < 0.5 && nachbarEcken.length > 0) {
        nach = nachbarEcken[Math.floor(r() * nachbarEcken.length)]!;
        protokoll.push(`Ecke ${String(index)} auf Nachbarecke ${nach.x.toFixed(3)},${nach.y.toFixed(3)}`);
    } else if (!strg && ziel < 0.6) {
        const teil = s.nachbarn[Math.floor(r() * s.nachbarn.length)]!;
        const k = Math.floor(r() * teil.punkte.length);
        const a = teil.punkte[k]!;
        const b = teil.punkte[(k + 1) % teil.punkte.length]!;
        const t = r();
        nach = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        protokoll.push(`Ecke ${String(index)} auf Nachbarkante ${nach.x.toFixed(3)},${nach.y.toFixed(3)}`);
    } else {
        nach = { x: von.x + (r() - 0.5) * 12, y: von.y + (r() - 0.5) * 12 };
        protokoll.push(
            `Ecke ${String(index)} frei nach ${nach.x.toFixed(3)},${nach.y.toFixed(3)}${strg ? " Strg" : ""}`,
        );
    }
    if (nach.x === von.x && nach.y === von.y) return undefined;
    return {
        art: "ziehen",
        stelle: { objekt: eigen.objekt, nr: eigen.nr, index },
        teile: [
            teilMit(
                eigen,
                eigen.punkte.map((p, i) => (i === index ? nach : p)),
            ),
        ],
        mitgezogen: mitziehende(von, nach, s.nachbarn, [], strg),
        treffer: undefined,
        getrennt: strg,
    };
}

/** Was je Art anders ist: die Art des Geometrie-Moduls, die Sperre, die Tafel und die Prüfung des Servers. */
interface Fall {
    readonly name: string;
    readonly art: GeometrieArt;
    readonly sperrArt: "landscape" | "territory";
    readonly tafel: "region_area" | "territory_area";
    pruefe(cluster: VpsCluster, actor: MapActor, areas: ReturnType<typeof operationAus>["areas"]): Promise<void>;
}

const ZURUECK = new Error("zurückrollen");
const FAELLE: readonly Fall[] = [
    {
        name: "Landschaft",
        art: FLAECHE,
        sperrArt: "landscape",
        tafel: "region_area",
        async pruefe(cluster, actor, areas) {
            const vorab = await pruefeFlaechen(cluster.app, AU, areas);
            await cluster.app.begin(async (tx) => {
                await formeUmIn(tx, actor, AU, areas, vorab);
                throw ZURUECK;
            });
        },
    },
    {
        name: "Gebiet",
        art: GEBIET,
        sperrArt: "territory",
        tafel: "territory_area",
        async pruefe(cluster, actor, areas) {
            const vorab = await pruefeGebietsflaechen(cluster.app, AU, areas);
            await cluster.app.begin(async (tx) => {
                await formeGebietUmIn(tx, actor, AU, areas, vorab);
                throw ZURUECK;
            });
        },
    },
];

describeWithCluster(
    "Ecken bearbeiten: ein ungeduldiger Editor gegen den Server (Wegwerf-Cluster)",
    { timeout: 900_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };
        const revision = new Map<string, Map<string, number>>();

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
            const satz = quelle();
            await importRegions(importer, satz.regions, satz.areas, satz.labels);
            await importTerritories(importer, gebiete());
            // Das Moor kaputt machen, wie Altdaten es sind (der Import nimmt es heil an).
            const moor = JSON.stringify({ type: "Polygon", coordinates: [geschlossen(MOOR_RING)] });
            await cluster.admin`
            UPDATE region_area SET geom = ST_SetSRID(ST_GeomFromGeoJSON(${moor}), 0) WHERE public_id = ${FLAECHE_VON[MOOR]!}
        `;
            await cluster.admin`
            UPDATE territory_area SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${moor}), 0))
             WHERE public_id = ${FLAECHE_VON[MOOR]!}
        `;
            for (const tafel of ["region_area", "territory_area"] as const) {
                const zeilen = await cluster.admin<{ id: string; revision: number; gueltig: boolean }[]>`
                SELECT public_id::text AS id, revision::int AS revision, ST_IsValid(geom) AS gueltig FROM ${cluster.admin(tafel)}
                 WHERE public_id = ANY(${Object.values(FLAECHE_VON)}::uuid[])
            `;
                expect(zeilen.find((z) => z.id === FLAECHE_VON[MOOR])?.gueltig).toBe(false);
                revision.set(tafel, new Map(zeilen.map((z) => [z.id, z.revision])));
            }
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        for (const fall of FAELLE) {
            /** Der Stand als Körper von „Fertig“ durch die Prüfung des Servers, zurückgerollt; gibt den Grund einer Ablehnung zurück. */
            const server = async (start: FormStand, jetzt: FormStand): Promise<string | undefined> => {
                const { areas } = operationAus(start, jetzt, AUFBAU, randomUUID());
                if (areas.length === 0) return undefined;
                try {
                    await fall.pruefe(cluster!, thomas, areas);
                } catch (fehler) {
                    if (fehler === ZURUECK) return undefined;
                    if (fehler instanceof ApiError) return String(fehler.details?.["reason"] ?? fehler.code);
                    throw fehler;
                }
                return undefined;
            };

            it(`🔴 ${fall.name}: der Ausgangsstand selbst ist dem Server recht (die Fixtur stimmt)`, async () => {
                const START = startVon(revision.get(fall.tafel)!);
                const au = START.teile[0]!;
                const verschoben: FormStand = {
                    ...START,
                    teile: [
                        teilMit(
                            au,
                            au.punkte.map((p, i) => (i === 3 ? { x: p.x, y: p.y - 1 } : p)),
                        ),
                    ],
                };
                expect(await server(START, verschoben)).toBeUndefined();
            });

            it(`🔴 ${fall.name}: keine Folge von Handbewegungen führt zu einem Stand, den der Server ablehnt`, async () => {
                const START = startVon(revision.get(fall.tafel)!);
                const FOLGEN = 80;
                const SCHRITTE = 20;
                const funde: string[] = [];
                // Ein ungeduldiger Editor: nicht der sorgfältige Weg, sondern schnell und daneben (Vali 2026-11-10 zu den Editoren: „die sind
                // verrückt und wollen schnell editieren ohne fehler bzw. verstehen ihre fehler nicht“).
                let gepruefte = 0;
                for (let saat = 1; saat <= FOLGEN && funde.length < 3; saat += 1) {
                    const r = zufall(saat);
                    let eingabe: GeometrieEingabe | undefined;
                    const modus: GeometrieModus = {
                        aktualisiere: vi.fn(),
                        markiere: vi.fn(),
                        sperre: vi.fn(),
                        abbrechen: vi.fn(() => false),
                        aus: vi.fn(),
                    };
                    const start: FormStart = {
                        sperrId: AU,
                        name: "Au",
                        teile: START.teile,
                        nachbarn: [WIESE, ZIPFEL, MOOR].map((id) => ({
                            sperrId: id,
                            name: NAMEN[id]!,
                            teile: START.nachbarn.filter((t) => t.objekt === FLAECHE_VON[id]),
                        })),
                        ziele: () => [],
                    };
                    const entwurf = createFormentwurf({
                        art: fall.art,
                        quelle: { sperrArt: fall.sperrArt, lade: async () => start },
                        karte: {
                            ein: (e) => {
                                eingabe = e;
                                return modus;
                            },
                            zeige: vi.fn(),
                            geaendert: vi.fn(),
                        },
                        fangradius: () => 12,
                        sperre: {
                            nimm: vi.fn(async () => ({ art: "genommen", sperre: {} as never })),
                            gib: vi.fn(),
                            liste: vi.fn(async () => []),
                            beiVerlust: vi.fn(() => () => undefined),
                        } as never,
                        pruefeSchritte: true,
                    });
                    await entwurf.starte(AU);
                    const protokoll: string[] = [];
                    for (let schritt = 0; schritt < SCHRITTE; schritt += 1) {
                        const jetzt = entwurf.entwurf()!;
                        const bewegung = handbewegung(jetzt, r, protokoll);
                        // ↶ und ↷ oft mehrmals schnell hintereinander.
                        const mal = 1 + Math.floor(r() * 3);
                        if (bewegung === "zurueck") for (let k = 0; k < mal; k += 1) entwurf.zurueck();
                        else if (bewegung === "wieder") for (let k = 0; k < mal; k += 1) entwurf.wieder();
                        else if (bewegung !== undefined) eingabe!.handbewegung(bewegung);
                        const danach = entwurf.entwurf()!;
                        if (danach === jetzt) continue;
                        gepruefte += 1;
                        const grund = await server(START, danach);
                        if (grund !== undefined) {
                            funde.push(`Saat ${String(saat)}: ${grund} nach ${protokoll.join(" · ")}`);
                            break;
                        }
                    }
                    entwurf.destroy();
                }
                expect(funde).toEqual([]);
                // Die Folgen prüfen wirklich etwas: Die meisten Schritte ändern den Stand.
                expect(gepruefte).toBeGreaterThan(FOLGEN * 6);
            });
        }
    },
);
