import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    kurzinfoAus,
    type Kurzinfo,
    type ReleaseNotizen,
    type ReleaseVoll,
    type VersionenListe,
} from "@avesmaps3d/shared";
import type { AdminCall } from "./verwaltung-stub.ts";

/**
 * „Versionen“ ohne Server (WI-0137, VERSION-0001): liest die echten Release-Notizen aus `config/releases/` und antwortet wie
 * `routes/versionen.ts` (laufend = neueste Datei, frühere kurz, Aufklappen). Die echten Routen prüft `apps/server/test/versionen-routes.test.ts`.
 */

const ORDNER = resolve(import.meta.dirname, "../../../config/releases");

function releases(): ReleaseVoll[] {
    return readdirSync(ORDNER)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
            const n = JSON.parse(readFileSync(resolve(ORDNER, name), "utf8")) as ReleaseNotizen;
            const doku = n.commits.filter((c) => c.doku).length;
            return {
                stamm: name.slice(0, -".json".length),
                titel: n.titel,
                datum: n.datum,
                von: n.von,
                bis: n.bis,
                zahl: n.commits.length - doku,
                doku,
                pakete: n.pakete,
                commits: n.commits,
            };
        })
        .sort((a, b) => Date.parse(a.datum) - Date.parse(b.datum));
}

/** `GET /api/version/kurzinfo` wie `lesen.ts`: die Kurzinfo der neuesten Datei; ohne `.md` keine Abschnitte. */
export function kurzinfoAntwort(): Kurzinfo {
    const laufend = releases().at(-1);
    if (laufend === undefined) return { stand: null, abschnitte: [] };
    const md = resolve(ORDNER, `${laufend.stamm}.md`);
    return { stand: laufend.datum, abschnitte: existsSync(md) ? kurzinfoAus(readFileSync(md, "utf8")).abschnitte : [] };
}

/**
 * 🪤 Der Datenstand der Tests ist das Release `bis` (Vorgabe df6f840c): Jeder spätere Release-Schnitt legt eine neue Datei unter
 * `config/releases/` an, und ohne diesen Schnitt wäre die neue das laufende Release; alle Zusicherungen über df6f840c wurden so mit 5c37bc88
 * (22bd709e) rot. Spätere Dateien bleiben deshalb draußen.
 */
export function versionenAntwort(
    releaseId = "20261011T093012Z-df6f840c",
    bis = "2026-10-11-df6f840c",
): (call: AdminCall) => { status: number; body: unknown } | undefined {
    return (call) => {
        if (call.method !== "GET" || !call.path.startsWith("/api/admin/system/versionen")) return undefined;
        const sortiert = releases();
        const ende = sortiert.findIndex((r) => r.stamm === bis);
        const alle = ende < 0 ? sortiert : sortiert.slice(0, ende + 1);
        if (call.path === "/api/admin/system/versionen") {
            const laufend = alle.at(-1) ?? null;
            const body: VersionenListe = {
                releaseId,
                laufend,
                frueher: alle
                    .slice(0, -1)
                    .reverse()
                    .map((r) => ({
                        stamm: r.stamm,
                        titel: r.titel,
                        datum: r.datum,
                        von: r.von,
                        bis: r.bis,
                        zahl: r.zahl,
                        doku: r.doku,
                    })),
            };
            return { status: 200, body };
        }
        const stamm = call.path.split("/").at(-1);
        const release = alle.find((r) => r.stamm === stamm);
        return release === undefined
            ? { status: 404, body: { error: { code: "not_found", message: "vom Nachbau" } } }
            : { status: 200, body: release };
    };
}
