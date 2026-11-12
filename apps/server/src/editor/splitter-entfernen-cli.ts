import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import type { TerritoryReshapeArea } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import type { MapActor } from "./map-operation.ts";
import { readEditorTerritoryForm } from "./territory-form.ts";
import { updateTerritory } from "./territory-update.ts";

/**
 * Splitter an Herrschaftsgebieten entfernen, als Lauf (OPS-000075; Vali 2026-11-02 auf „alle löschen“ oder „einzeln“: „beides“). Gebaut von Claudio;
 * das Werkzeug für einzelne Teile ist Claudias Rechtsklick „Unterpolygone löschen …“ (8000a3241). Dieser Lauf schreibt GENAU wie es:
 * `territory.update` mit `areas` gegen die Revision der Fläche, Fachprotokoll mit der Form davor und danach, ↺ in „Änderungen“ holt den Teil zurück.
 *
 * **Splitter** heißt hier, alles zugleich (Kriterium im Trockenlauf je Teil sichtbar):
 *   - nicht der größte Teil seiner Fläche (der bleibt immer),
 *   - kleiner als `MAX_FLAECHE` (0,1 Karteneinheiten²) UND kleiner als 1 % des größten Teils,
 *   - berührt den größten Teil (Abstand < `MAX_ABSTAND` = 0,01). Abgesetzte kleine Teile sind meist Inseln oder Exklaven (Theaterritter, Haipu …)
 *     und bleiben: Die räumt bei Bedarf ein Editor mit dem Rechtsklick.
 *
 * 🔴 Map Mutation Guard: Ohne `--ausfuehren` nur lesen (`read only`). Schreiben nur mit `--freigabe "<Wortlaut>"` (Akteur Agent Claudio, `approvalRef`) und
 * `--erwartet <n>` (Zahl der Teile aus dem Trockenlauf; sonst nichts geschrieben). Die Kartensperre (`system_state.map_lock`) hält den Lauf an.
 * Je Gebiet EINE Operation mit fester Kennung (aus Fläche und Revision); ein zweiter Lauf findet die Teile nicht mehr. Hat sich die Fläche seit dem
 * Trockenlauf geändert (Revision) oder stimmt der Teil nicht mehr (Größe), bleibt das Gebiet liegen und steht als Fehler da.
 *
 *   node apps/server/dist/editor/splitter-entfernen-cli.js
 *   node apps/server/dist/editor/splitter-entfernen-cli.js --ausfuehren --erwartet <n> --freigabe "<Wortlaut>"
 */
const MAX_FLAECHE = 0.1;
const ANTEIL = 0.01;
const MAX_ABSTAND = 0.01;

const { values } = parseArgs({
    options: {
        ausfuehren: { type: "boolean", default: false },
        erwartet: { type: "string" },
        freigabe: { type: "string" },
    },
});

function abbruch(text: string, code = 2): never {
    console.error(text);
    process.exit(code);
}

type Ring = number[][];
const ringFlaeche = (ring: Ring): number => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
        const [x1, y1] = ring[i]!;
        const [x2, y2] = ring[(i + 1) % ring.length]!;
        s += x1! * y2! - x2! * y1!;
    }
    return Math.abs(s) / 2;
};
const polygonFlaeche = (polygon: Ring[]): number =>
    polygon.reduce((summe, ring, i) => (i === 0 ? summe + ringFlaeche(ring) : summe - ringFlaeche(ring)), 0);

interface Teil {
    gebiet: string;
    name: string;
    flaeche: string;
    revision: number;
    /** 1-basiert wie ST_Dump, in gespeicherter Folge (= Folge der Form). */
    index: number;
    groesse: number;
    abstand: number;
    haupt: number;
}

const config = loadConfig();
if (!config.databaseUrl) abbruch("DATABASE_URL ist nicht gesetzt", 1);
const umgebung = config.auth?.environment;
if (values.ausfuehren) {
    if (umgebung === undefined) abbruch("Schreiben nur in einer benannten Umgebung (AVESMAPS_ENV). Nichts geschrieben.");
    if ((values.freigabe ?? "").trim() === "")
        abbruch("Ohne --freigabe (Wortlaut der Freigabe des Betreibers) wird nichts geschrieben.");
    if (!/^[0-9]{1,4}$/u.test(values.erwartet ?? ""))
        abbruch("Ohne --erwartet <n> (Zahl der Teile aus dem Trockenlauf) wird nichts geschrieben.");
}

const db = createDatabase(config.databaseUrl, { max: 1 });
try {
    const teile = await db.begin("read only", async (tx) =>
        tx<Teil[]>`
            WITH d AS (
                SELECT a.public_id::text AS flaeche, a.revision::int AS revision, t.public_id::text AS gebiet, t.name,
                       (st_dump(a.geom)).path[1] AS index, (st_dump(a.geom)).geom AS g
                  FROM territory_area a JOIN territory t ON t.id = a.territory_id
                 WHERE a.is_active AND t.is_active AND st_numgeometries(a.geom) > 1
            ), r AS (
                SELECT d.*, st_area(g) AS groesse, rank() OVER (PARTITION BY flaeche ORDER BY st_area(g) DESC, index) AS rang FROM d
            )
            SELECT r.gebiet, r.name, r.flaeche, r.revision, r.index::int AS index, r.groesse, st_distance(r.g, h.g) AS abstand, h.groesse AS haupt
              FROM r JOIN r h ON h.flaeche = r.flaeche AND h.rang = 1
             WHERE r.rang > 1 AND r.groesse < ${MAX_FLAECHE} AND r.groesse < ${ANTEIL} * h.groesse AND st_distance(r.g, h.g) < ${MAX_ABSTAND}
             ORDER BY r.name, r.flaeche, r.index`,
    );
    for (const t of teile)
        console.log(
            `splitter  ${t.gebiet}  ${t.name}: Fläche ${t.flaeche} Teil ${String(t.index)}, Größe ${t.groesse.toFixed(5)} (Hauptteil ${t.haupt.toFixed(2)}), Abstand ${t.abstand.toFixed(4)}`,
        );
    const gebiete = new Map<string, Teil[]>();
    for (const t of teile) gebiete.set(t.gebiet, [...(gebiete.get(t.gebiet) ?? []), t]);
    console.log(
        `teile     ${String(teile.length)} Splitter in ${String(new Set(teile.map((t) => t.flaeche)).size)} Flächen, ${String(gebiete.size)} Gebieten (Regel: < ${String(MAX_FLAECHE)}, < ${String(ANTEIL * 100)} % des Hauptteils, Abstand < ${String(MAX_ABSTAND)})`,
    );
    if (!values.ausfuehren) {
        console.log("TROCKENLAUF: nichts geschrieben");
    } else if (String(teile.length) !== values.erwartet) {
        console.error(`Der Trockenlauf zählt ${String(teile.length)} Splitter, erwartet ${values.erwartet ?? "?"}: nichts geschrieben.`);
        process.exitCode = 2;
    } else {
        const [sperre] = await db<{ map_lock: boolean }[]>`SELECT map_lock FROM system_state WHERE id = 1`;
        if (sperre?.map_lock !== false)
            abbruch("Die Karte ist gesperrt (SYS-4) oder der Zustand ist unbekannt: nichts geschrieben.", 3);
        const actor: MapActor = {
            kind: "agent",
            label: "claudio",
            approvalRef: values.freigabe!.trim().slice(0, 300),
            environment: umgebung!,
        };
        let ok = 0;
        let entfernt = 0;
        let fehler = 0;
        for (const [gebiet, eigene] of gebiete) {
            const name = eigene[0]!.name;
            try {
                const form = await readEditorTerritoryForm(db, gebiet, undefined, "aventuria", undefined, true);
                const areas: TerritoryReshapeArea[] = [];
                for (const flaeche of new Set(eigene.map((t) => t.flaeche))) {
                    const stand = form?.areas.find((a) => a.id === flaeche);
                    const weg = eigene.filter((t) => t.flaeche === flaeche);
                    if (stand === undefined) throw new Error(`Fläche ${flaeche} steht nicht in der Form`);
                    if (stand.revision !== Number(weg[0]!.revision))
                        throw new Error(`Fläche ${flaeche}: Revision ${String(stand.revision)} statt ${String(weg[0]!.revision)}`);
                    for (const t of weg) {
                        const polygon = stand.polygons[t.index - 1];
                        const g = polygon === undefined ? -1 : polygonFlaeche(polygon as Ring[]);
                        if (Math.abs(g - t.groesse) > 1e-9 + 1e-6 * t.groesse)
                            throw new Error(`Fläche ${flaeche} Teil ${String(t.index)}: Größe ${g.toFixed(6)} statt ${t.groesse.toFixed(6)}`);
                    }
                    const raus = new Set(weg.map((t) => t.index - 1));
                    areas.push({ id: flaeche, baseRevision: stand.revision, polygons: stand.polygons.filter((_, i) => !raus.has(i)) });
                }
                const h = createHash("sha256")
                    .update(`splitter-entfernen:${gebiet}:${areas.map((a) => `${a.id}@${String(a.baseRevision)}`).join(",")}`)
                    .digest("hex");
                const operationId = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
                await updateTerritory(db, actor, gebiet, { operationId, areas });
                ok++;
                entfernt += eigene.length;
                console.log(`entfernt  ${gebiet}  ${name}: ${String(eigene.length)} Teil(e), Operation ${operationId}`);
            } catch (error) {
                fehler++;
                console.error(`FEHLER    ${gebiet}  ${name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        console.log(`ergebnis  ${String(entfernt)} Splitter in ${String(ok)} Gebieten entfernt, ${String(fehler)} Fehler`);
        if (fehler > 0) process.exitCode = 1;
    }
} finally {
    await db.end();
}
