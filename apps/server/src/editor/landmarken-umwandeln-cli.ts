import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { istLandmarkenArt } from "@avesmaps3d/shared";
import { loadConfig } from "../config.ts";
import { createDatabase } from "../database.ts";
import { fuehreLaufAus, pruefeZeile, type Befund, type LaufZeile } from "./landmarken-umwandeln.ts";
import type { MapActor } from "./map-operation.ts";

/**
 * Bauwerke in Landmarken umwandeln, als Lauf über eine feste Liste (WI-0271 L8; Vali 2026-11-02: „ich klick doch nicht jedes bauwerk an“ und, wörtlich, „Wandle die
 * 22 natürlichen Bauwerke aus Claudios Liste in Landmarken um, Zielart nach Vorschlag, Bröllerloch als Grotte, Nebelhöhle und Narai Tuschas mit. Dafür darf ein
 * Lauf-Weg nach Production gebaut werden.“; Handover `2026-11-02-landmarken-lauf-production-an-claudia.md`). Gebaut von Claudio, weil Claudia nicht greifbar war;
 * von Claudia nachgeprüft (WI-0271 §17). Der Lauf selbst steht in `landmarken-umwandeln.ts`.
 *
 * Je Zeile GENAU die Operation des Editors (`wandleOrtInLandmarke`, `landmarke.umwandeln`), mit ↺ in „Änderungen“. Weicht die gewünschte Art vom Vorschlag der Regel ab
 * (Bröllerloch: Regel `hoehle`, gewünscht `grotte`), folgt eine zweite Operation `peak.update` mit der Art, wie sie ein Editor im Fenster setzt. ↺ dann in umgekehrter Folge.
 *
 * 🔴 Map Mutation Guard: Ohne `--ausfuehren` nur lesen (`read only`). Schreiben nur mit `--freigabe "<Wortlaut>"` (Akteur Agent Claudio, `approvalRef`) und
 * `--erwartet <n>` (die Zahl offener und nachzuziehender Zeilen aus dem Trockenlauf; sonst nichts geschrieben). Die Kartensperre (SYS-4, `system_state.map_lock`) hält den Lauf an wie die
 * Route (423). `MAP_EDITING` sperrt die Knöpfe der Editoren (`requireMapEditing` an der Route), nicht diesen Lauf: Vali schaltet dafür nicht ein.
 * Gesperrte Zeilen (innerorts, Gebiet) bleiben liegen und stehen in der Ausgabe. Kraftlinien sperren seit WI-0271 §17 nicht mehr: Sie hängen auf die Landmarke um, ↺ hängt sie zurück.
 * Idempotent: Die Kennung jeder Operation folgt aus der Zeile; eine schon umgewandelte Zeile (aktiver Verweis `umgewandelt_aus`) zählt als erledigt.
 *
 * **Nachzug** (WI-0271 §17; Vali 2026-11-02: Landmarken können verborgen, Nodix, unterirdisch, entrückt und ungefähr sein): Die ersten Läufe nahmen die Merkmale des Orts nicht mit, verborgene Orte bekamen nur `show_name = false`. Steht eine
 * schon umgewandelte Zeile so da, liest der Lauf den stillen Ort über den Verweis und zieht nach: Die Merkmale des Orts kommen zu denen der Landmarke, eine verborgene steht wieder auf der Karte (`show_name`), jetzt ohne Namen und in keiner Suche.
 * EINE Operation `peak.update` je Zeile, mit ↺; die ↺ der Umwandlung kommt erst danach dran. Nur einmal: Hat die Zeile ihre Kennung schon, gilt sie als erledigt, auch wenn ein Editor ein Merkmal inzwischen wieder wegnahm.
 * Ruine und Seehafen zieht niemand nach: Sie bleiben am stillen Ort, die Ausgabe nennt sie.
 *
 *   node apps/server/dist/editor/landmarken-umwandeln-cli.js --liste <datei.json>
 *   node apps/server/dist/editor/landmarken-umwandeln-cli.js --liste <datei.json> --ausfuehren --erwartet <n> --freigabe "<Wortlaut>"
 *
 * Liste: `[{ "publicId": "<uuid>", "art": "wasserfall" }, …]`. Ausgabe ohne Personenbezug.
 */
const { values } = parseArgs({
    options: {
        liste: { type: "string" },
        ausfuehren: { type: "boolean", default: false },
        erwartet: { type: "string" },
        freigabe: { type: "string" },
    },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function abbruch(text: string, code = 2): never {
    console.error(text);
    process.exit(code);
}

function leseListe(datei: string): LaufZeile[] {
    const roh: unknown = JSON.parse(readFileSync(datei, "utf8"));
    if (!Array.isArray(roh) || roh.length === 0) abbruch("Die Liste ist leer oder kein Feld.");
    const gesehen = new Set<string>();
    return roh.map((eintrag: unknown, i) => {
        const e = eintrag as { publicId?: unknown; art?: unknown };
        if (typeof e.publicId !== "string" || !UUID.test(e.publicId))
            abbruch(`Zeile ${String(i + 1)}: publicId fehlt oder ist keine UUID.`);
        if (typeof e.art !== "string" || !istLandmarkenArt(e.art))
            abbruch(`Zeile ${String(i + 1)}: unbekannte Art ${String(e.art)}.`);
        if (gesehen.has(e.publicId)) abbruch(`Zeile ${String(i + 1)}: ${e.publicId} steht doppelt.`);
        gesehen.add(e.publicId);
        return { publicId: e.publicId, art: e.art };
    });
}

function zeige(b: Befund): void {
    const art =
        b.vorschlag === undefined || b.vorschlag === b.zeile.art
            ? b.zeile.art
            : `${b.zeile.art} (Regel: ${b.vorschlag}, danach Art gesetzt)`;
    const merkmale = (b.merkmale ?? []).length > 0 ? `, Merkmale ${(b.merkmale ?? []).join(" ")}` : "";
    const bleibt = (b.bleibt ?? []).length > 0 ? `, bleibt am Ort: ${(b.bleibt ?? []).join(" ")}` : "";
    const rest =
        b.zustand === "offen"
            ? `${art}, Revision ${String(b.revision)}, Wegenden ${String(b.wegenden)}, Kraftlinien ${String(b.kraftlinien)}${merkmale}${bleibt}`
            : b.zustand === "nachzug"
              ? `Landmarke ${b.landmarke ?? "?"}, Nachzug${merkmale}${b.nachzug?.changes.showName === true ? ", zurück auf die Karte" : ""}${bleibt}`
              : b.zustand === "erledigt"
                ? `schon Landmarke ${b.landmarke ?? "?"}${b.artHeute === undefined ? "" : `, Art heute ${b.artHeute} (Liste: ${b.zeile.art}), nicht geändert`}${bleibt}`
                : `GESPERRT: ${b.grund ?? "?"}`;
    console.log(`${b.zustand.padEnd(9)}${b.zeile.publicId}  ${b.name}: ${rest}`);
}

const config = loadConfig();
if (!config.databaseUrl) abbruch("DATABASE_URL ist nicht gesetzt", 1);
if (!values.liste) abbruch("--liste <datei.json> fehlt");
const umgebung = config.auth?.environment;
if (values.ausfuehren) {
    if (umgebung === undefined)
        abbruch("Schreiben nur in einer benannten Umgebung (AVESMAPS_ENV). Nichts geschrieben.");
    if ((values.freigabe ?? "").trim() === "")
        abbruch("Ohne --freigabe (Wortlaut der Freigabe des Betreibers) wird nichts geschrieben.");
    if (!/^[0-9]{1,4}$/u.test(values.erwartet ?? ""))
        abbruch("Ohne --erwartet <n> (offene und nachzuziehende Zeilen aus dem Trockenlauf) wird nichts geschrieben.");
}
const liste = leseListe(values.liste);
const db = createDatabase(config.databaseUrl, { max: 1 });
try {
    const befunde = await db.begin("read only", async (tx) => {
        const alle: Befund[] = [];
        for (const zeile of liste) alle.push(await pruefeZeile(tx, zeile, umgebung ?? "development"));
        return alle;
    });
    befunde.forEach(zeige);
    const anstehend = befunde.filter((b) => b.zustand === "offen" || b.zustand === "nachzug");
    const zahl = (zustand: Befund["zustand"]): string => String(befunde.filter((b) => b.zustand === zustand).length);
    console.log(
        `zeilen    ${String(befunde.length)}: ${zahl("offen")} offen, ${zahl("nachzug")} Nachzug, ${zahl("erledigt")} erledigt, ${zahl("gesperrt")} gesperrt`,
    );
    if (!values.ausfuehren) {
        console.log("TROCKENLAUF: nichts geschrieben");
    } else if (String(anstehend.length) !== values.erwartet) {
        console.error(
            `Der Trockenlauf zählt ${String(anstehend.length)} anstehende Zeilen, erwartet ${values.erwartet ?? "?"}: nichts geschrieben.`,
        );
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
        const ergebnisse = await fuehreLaufAus(db, actor, anstehend);
        for (const e of ergebnisse) {
            if (e.art === "umgewandelt")
                console.log(`umgewandelt ${e.befund.zeile.publicId} -> ${e.peakId}  ${e.name}: ${e.subtype}`);
            else if (e.art === "nachgezogen")
                console.log(`nachgezogen ${e.befund.zeile.publicId} -> ${e.befund.landmarke ?? "?"}  ${e.befund.name}`);
            else console.error(`FEHLER ${e.befund.zeile.publicId} ${e.befund.name}: ${e.text}`);
        }
        const anzahl = (art: (typeof ergebnisse)[number]["art"]): number =>
            ergebnisse.filter((e) => e.art === art).length;
        console.log(
            `ergebnis  ${String(anzahl("umgewandelt"))} umgewandelt, ${String(anzahl("nachgezogen"))} nachgezogen, ${String(anzahl("fehler"))} Fehler`,
        );
        if (anzahl("fehler") > 0) process.exitCode = 1;
    }
} finally {
    await db.end();
}
