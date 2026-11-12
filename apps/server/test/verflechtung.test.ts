import { describe, expect, it } from "vitest";
import {
    anzahlNeu,
    baueGraph,
    bereichVon,
    dateiKreise,
    gegenseitige,
    grenzuebertritte,
    hinweisZeilen,
    importeAus,
    vergleiche,
} from "../../../scripts/dev/verflechtung.ts";

/**
 * Die Verflechtung der Bereiche (`scripts/dev/verflechtung.ts`, WI-0289; Vali 2026-11-08: „ich hab angst, dass du abhängigkeiten erzeugst“).
 * Problemfälle: ein reiner Typimport zählt als Laufzeitabhängigkeit; die Zusammensetzung (`app.ts`) macht jeden Bereich mit der Wurzel
 * gegenseitig; ein Push, der eine neue Gegenrichtung schafft, bleibt still; ein vorhandenes Paar wird bei jedem Push erneut gemeldet.
 */
const graph = (dateien: Record<string, string>) => baueGraph(new Map(Object.entries(dateien)));

describe("Importe einer Datei", () => {
    it("🔴 trennt Laufzeit, Nachladen und reine Typen; ignoriert Kommentare; liest in .vue nur die Skripte", () => {
        const text = [
            'import { a } from "./a.ts";',
            'import type { B } from "./b.ts";',
            'import { type C, type D } from "./c.ts";',
            'import { type E, f } from "./e.ts";',
            'export { g } from "./g.ts";',
            'import "./seiteneffekt.ts";',
            'const h = await import("./h.ts");',
            '// import { x } from "./kommentar.ts";',
            '/* import { y } from "./block.ts"; */',
        ].join("\n");
        expect(importeAus("apps/server/src/x/datei.ts", text)).toEqual([
            { spec: "./a.ts", art: "statisch" },
            { spec: "./b.ts", art: "typ" },
            { spec: "./c.ts", art: "typ" },
            { spec: "./e.ts", art: "statisch" },
            { spec: "./g.ts", art: "statisch" },
            { spec: "./seiteneffekt.ts", art: "statisch" },
            { spec: "./h.ts", art: "spaet" },
        ]);
        const vue =
            '<template><a href="//x">import { z } from "./z.ts";</a></template>\n<script setup lang="ts">\nimport { v } from "./v.ts";\n</script>';
        expect(importeAus("apps/web/src/x/k.vue", vue)).toEqual([{ spec: "./v.ts", art: "statisch" }]);
    });

    it("Bereiche: erster Ordner unter src, Wurzeldateien, shared", () => {
        expect(bereichVon("apps/server/src/terrain/domain/read.ts")).toBe("server/terrain");
        expect(bereichVon("apps/server/src/database.ts")).toBe("server/(Wurzel)");
        expect(bereichVon("apps/web/src/fenster/avm-fenster.vue")).toBe("web/fenster");
        expect(bereichVon("packages/shared/src/gebirge/index.ts")).toBe("shared");
    });
});

describe("Verflechtung eines Stands", () => {
    it("🔴 gegenseitige Bereiche zur Laufzeit; reine Typen und die Zusammensetzung zählen nicht", () => {
        const g = graph({
            "apps/server/src/wiki/a.ts": 'import { j } from "../jobs/j.ts";',
            "apps/server/src/jobs/j.ts": 'import { a } from "../wiki/a.ts";',
            "apps/server/src/terrain/t.ts": 'import type { R } from "../routing/r.ts";',
            "apps/server/src/routing/r.ts": 'import { t } from "../terrain/t.ts";',
            "apps/server/src/app.ts": 'import { m } from "./media/m.ts";',
            "apps/server/src/media/m.ts": 'import { db } from "../database.ts";',
            "apps/server/src/database.ts": "export const db = 1;",
        });
        expect(gegenseitige(g).map((p) => `${p.a}⇄${p.b}`)).toEqual(["server/jobs⇄server/wiki"]);
    });

    it("🔴 Dateikreise nur über statische Importe; ein nachgeladener Rückweg schließt keinen Kreis", () => {
        const g = graph({
            "apps/web/src/auth/x.ts": 'import { y } from "./y.ts";',
            "apps/web/src/auth/y.ts": 'import { x } from "./x.ts";',
            "apps/web/src/map/p.ts": 'import { q } from "./q.ts";',
            "apps/web/src/map/q.ts": 'const p = () => import("./p.ts");',
        });
        expect(dateiKreise(g)).toEqual([["apps/web/src/auth/x.ts", "apps/web/src/auth/y.ts"]]);
    });

    it("🔴 Grenzübertritt: web greift in server, shared in eine App; shared aus einer App ist erlaubt", () => {
        const g = graph({
            "apps/web/src/map/w.ts":
                'import { s } from "../../../server/src/routes/s.ts"; import { v } from "@avesmaps3d/shared";',
            "apps/server/src/routes/s.ts": "export const s = 1;",
            "packages/shared/src/index.ts": 'export { w } from "../../../apps/web/src/map/w.ts";',
        });
        expect(grenzuebertritte(g).map((k) => `${k.von} → ${k.nach}`)).toEqual([
            "apps/web/src/map/w.ts → apps/server/src/routes/s.ts",
            "packages/shared/src/index.ts → apps/web/src/map/w.ts",
        ]);
    });
});

describe("Was ein Push neu verflicht", () => {
    const alt = graph({
        "apps/server/src/wiki/a.ts": 'import { j } from "../jobs/j.ts";',
        "apps/server/src/jobs/j.ts": "export const j = 1;",
        "apps/server/src/editor/e.ts": 'import { i } from "../inhalte/i.ts";',
        "apps/server/src/inhalte/i.ts": 'import { e } from "../editor/e.ts";',
    });

    it("🔴 eine neue Gegenrichtung wird gemeldet, mit dem Import, der sie schafft", () => {
        const neu = graph({
            "apps/server/src/wiki/a.ts": 'import { j } from "../jobs/j.ts";',
            "apps/server/src/jobs/j.ts": 'import { w } from "../wiki/stand.ts"; export const j = 1;',
            "apps/server/src/wiki/stand.ts": "export const w = 1;",
            "apps/server/src/editor/e.ts": 'import { i } from "../inhalte/i.ts";',
            "apps/server/src/inhalte/i.ts": 'import { e } from "../editor/e.ts";',
        });
        const n = vergleiche(alt, neu);
        expect(n.paare.map((p) => `${p.paar.a}⇄${p.paar.b}`)).toEqual(["server/jobs⇄server/wiki"]);
        expect(n.paare[0]?.neueKanten.map((k) => k.von)).toEqual(["apps/server/src/jobs/j.ts"]);
        expect(hinweisZeilen(n)[0]).toMatch(
            /^⚠ neu gegenseitig: server\/jobs ⇄ server\/wiki .*server\/src\/jobs\/j\.ts → server\/src\/wiki\/stand\.ts/u,
        );
    });

    it("🔴 ein vorhandenes gegenseitiges Paar wird nicht erneut gemeldet, auch wenn ein Import dazukommt", () => {
        const neu = graph({
            "apps/server/src/wiki/a.ts": 'import { j } from "../jobs/j.ts";',
            "apps/server/src/jobs/j.ts": "export const j = 1;",
            "apps/server/src/editor/e.ts": 'import { i } from "../inhalte/i.ts"; import { k } from "../inhalte/k.ts";',
            "apps/server/src/inhalte/i.ts": 'import { e } from "../editor/e.ts";',
            "apps/server/src/inhalte/k.ts": "export const k = 1;",
        });
        const n = vergleiche(alt, neu);
        expect(anzahlNeu(n)).toBe(0);
        expect(hinweisZeilen(n)).toEqual([
            "nichts Neues: keine neue gegenseitige Abhängigkeit, kein neuer Dateikreis, kein Grenzübertritt.",
        ]);
    });

    it("ein neuer Dateikreis wird gemeldet, ein vorhandener nicht", () => {
        const neu = graph({
            "apps/server/src/wiki/a.ts": 'import { j } from "./b.ts";',
            "apps/server/src/wiki/b.ts": 'import { a } from "./a.ts";',
        });
        expect(vergleiche(alt, neu).kreise).toEqual([["apps/server/src/wiki/a.ts", "apps/server/src/wiki/b.ts"]]);
        expect(vergleiche(neu, neu).kreise).toEqual([]);
    });
});
