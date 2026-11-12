import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "../../apps/server/src/config.ts";
import { createDatabase } from "../../apps/server/src/database.ts";
import {
    legacyPathUrl,
    legacySpotUrl,
    loadLooseEndpoints,
    looseEndpointSummary,
    LOOSE_DISTANCE,
    type LooseEnd,
    type LooseEndpointReport,
    type LooseSpot,
} from "../../apps/server/src/routing/loose-endpoints.ts";

/**
 * Die Arbeitsliste der losen Wegenden: wo ein Wegende an einem Ort hängt, der nicht dort steht, wo der Weg
 * endet (Befund `project-control/discovery/route-gareth-alfenmohn-haken-2026-10-06.md`).
 *
 * 🔴 Seit WI-0132 Release N auf der Topologie ohne Kreuzungen (`routing/topology.ts`). Repariert wird nach
 * dem Cutoff in Avesmaps3D-Production im Wegeeditor (Betreiber 2026-10-10, WI-0132 §6), nicht in Legacy.
 * Dieses Werkzeug **liest nur** — es führt keine einzige Schreibanweisung, weder hier noch in Legacy, und
 * es ändert keine Kartendaten (Map Mutation Guard, Cutoff-Regel).
 *
 * Nach einer Redaktionsrunde noch einmal laufen lassen: dann stehen weniger Zeilen im Dokument.
 *
 *   npm run ops:lose-wegenden                 # misst und schreibt die Liste
 *   npm run ops:lose-wegenden -- --nur-zaehlen # misst und schreibt NICHTS
 *   npm run ops:lose-wegenden -- --ziel <datei>
 */
const { values } = parseArgs({
    options: {
        ziel: { type: "string" },
        "nur-zaehlen": { type: "boolean", default: false },
        domain: { type: "string" },
    },
});

const ZIEL = values.ziel ?? "project-control/discovery/lose-wegenden-redaktionsliste.md";

const config = loadConfig();
if (!config.databaseUrl) {
    console.error("DATABASE_URL ist nicht gesetzt");
    process.exit(1);
}

const einheit = (value: number): string => value.toFixed(3).replace(".", ",");
const meilen = (value: number): string => (value * 3).toFixed(1).replace(".", ",");
const punkt = (x: number, y: number): string => `${einheit(x)} | ${einheit(y)}`;
/** Derselbe Punkt in einer Tabellenzelle: der senkrechte Strich muss dort maskiert sein. */
const punktZelle = (x: number, y: number): string => `${einheit(x)} \\| ${einheit(y)}`;
const kurz = (publicId: string): string => `${publicId.slice(0, 8)}…`;
const zeile = (...zellen: string[]): string => `| ${zellen.join(" | ")} |`;
const anzahl = (n: number, eins: string, viele: string): string => `${String(n)} ${n === 1 ? eins : viele}`;
/** „das eine Wegende“ statt „die 1 Wegende“ — eine Liste für Menschen, nicht für ein Protokoll. */
const menge = (n: number, eins: string, viele: string): string =>
    n === 1 ? `das eine ${eins}` : `die ${String(n)} ${viele}`;
/** Ein Datum, wie es in Deutschland geschrieben wird. */
const tag = (iso: string | null): string => {
    const teile = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
    return teile ? `${teile[3]}.${teile[2]}.${teile[1]}` : "unbekannten Tag";
};

const wikiZelle = (report: LooseEndpointReport, publicId: string): string => {
    const assignment = report.wikiKeys.get(publicId);
    return assignment ? `\`${assignment.key}\`` : "— (kein Wiki-Artikel zugewiesen)";
};

/** Woran ein loses Ende heute hängt, in Worten. */
function haengtAn(end: LooseEnd | undefined): string {
    if (!end) return "einem anderen Knoten";
    return end.nodeKind === "technical" ? `dem Treffpunkt \`${kurz(end.nodeId)}\`` : `dem Ort „${end.nodeName}“`;
}

function wegZeile(report: LooseEndpointReport, end: LooseEnd): string {
    const assignment = report.wikiKeys.get(end.pathPublicId);
    const adresse = legacyPathUrl(end.subtype, assignment?.url ?? null);
    return zeile(
        end.pathName.trim() === "" ? "(ohne Namen)" : end.pathName,
        end.subtype,
        end.which === "anfang" ? "Anfang" : end.which === "ende" ? "Ende" : "Teilungspunkt",
        `${einheit(end.distance)} E (${meilen(end.distance)} Meilen)`,
        wikiZelle(report, end.pathPublicId),
        `\`${end.pathPublicId}\``,
        adresse === null ? "— (nur über die Stelle)" : `[Weg öffnen](${adresse})`,
    );
}

/** Die Gegend einer Stelle, benannt statt gezählt. */
function gegend(spot: LooseSpot): string {
    if (!spot.nearest) return "ohne nennenswerten Ort in der Nähe";
    return `${einheit(spot.nearest.distance)} E (${meilen(spot.nearest.distance)} Meilen) von ${spot.nearest.name}`;
}

function stelleBlock(report: LooseEndpointReport, spot: LooseSpot, nummer: number): string {
    const lines: string[] = [];
    const retired = spot.retired;
    const titel = retired ? `hier stand „${retired.name}“` : "loser Stoß, hier stand nie ein Ort";
    lines.push(`### ${String(nummer)}. (${punkt(spot.x, spot.y)}) — ${titel}`);
    lines.push("");
    lines.push("| | |");
    lines.push("|---|---|");
    lines.push(zeile("**Die Stelle in Legacy**", `[Karte an dieser Stelle öffnen](${legacySpotUrl(spot.x, spot.y)})`));
    lines.push(zeile("Wo das ist", gegend(spot)));
    if (retired) {
        const art = `**${retired.name}** · Ort${retired.subtype === null ? "" : ` (${retired.subtype})`}`;
        const versatz = Math.hypot(retired.x - spot.x, retired.y - spot.y);
        lines.push(
            zeile(
                "Gelöschter Knoten",
                `${art} · Wiki-Key ${wikiZelle(report, retired.publicId)} · Kennung \`${retired.publicId}\` · ` +
                    `bei uns stillgelegt am ${tag(retired.retiredOn)}` +
                    (versatz > 0.0005
                        ? ` · stand ${einheit(versatz)} E neben dem Treffpunkt, bei (${punktZelle(retired.x, retired.y)})`
                        : ""),
            ),
        );
    }
    const maximum = Math.max(...spot.ends.map((end) => end.distance));
    lines.push(
        zeile(
            "Was dort steht",
            `${anzahl(spot.ends.length, "Wegende endet", "Wegenden enden")} hier, ohne dass ein Ort darauf sitzt. ` +
                (spot.ends.length === 1
                    ? `Es hängt ${einheit(maximum)} E (${meilen(maximum)} Meilen)`
                    : `Sie hängen bis zu ${einheit(maximum)} E (${meilen(maximum)} Meilen)`) +
                ` entfernt an ${haengtAn(spot.ends[0])}; diese Lücke kostet die Routenberechnung nichts.`,
        ),
    );
    if (spot.detached.length > 0) {
        lines.push(
            zeile(
                "Folge",
                `${anzahl(spot.detached.length, "Weg hat", "Wege haben")} hier keine Kante mehr (sie liegen ganz im Kasten des Ortes)`,
            ),
        );
    }
    lines.push(
        zeile(
            "**Zu tun**",
            retired
                ? `Hier stand bis zum ${tag(retired.retiredOn)} **„${retired.name}“**; der Ort ist gelöscht. Wenn er zu Unrecht ` +
                      `verschwunden ist, den Ort wieder anlegen; sonst ${menge(spot.ends.length, "Wegende", "Wegenden")} aus der ` +
                      "Tabelle genau aufeinander oder genau auf den durchgehenden Weg ziehen: Dann verbindet die Topologie sie ohne Kreuzung."
                : `Hier treffen ${anzahl(spot.ends.length, "Wegende", "Wegenden")} zusammen, aber **kein Ort** sitzt darauf. ` +
                      `Entweder ${menge(spot.ends.length, "Wegende", "Wegenden")} genau aufeinander ziehen, oder auf ${haengtAn(spot.ends[0])}, ` +
                      `${spot.ends.length === 1 ? "an dem es heute hängt" : "an dem sie heute hängen"}.`,
        ),
    );
    lines.push("");
    lines.push(zeile("Weg", "Wegart", "Ende", "Abstand", "Wiki-Key", "Kennung in Legacy", "Adresse"));
    lines.push("|---|---|---|---|---|---|---|");
    for (const end of [...spot.ends].sort((a, b) => b.distance - a.distance)) lines.push(wegZeile(report, end));
    lines.push("");
    return lines.join("\n");
}

/**
 * Wo die Stellen liegen — benannt, nicht in Koordinatenkästen. Jede Stelle zählt zu dem nächsten Ort,
 * der groß genug ist, um eine Gegend zu benennen (Metropole bis Kleinstadt); das ist dieselbe Angabe,
 * die in jedem Block unter „Wo das ist“ steht.
 */
function haeufungen(spots: LooseSpot[], hoechstens = 40): string[] {
    const nester = new Map<string, LooseSpot[]>();
    for (const spot of spots) {
        const key = spot.nearest?.name ?? "(ohne Ort in der Nähe)";
        nester.set(key, [...(nester.get(key) ?? []), spot]);
    }
    const sortiert = [...nester.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const gezeigt = sortiert.slice(0, hoechstens);
    const rest = sortiert.slice(hoechstens);
    const zeilen = gezeigt.map(([name, list]) => {
        const wege = list.reduce((sum, spot) => sum + spot.ends.length, 0);
        return `- **Großraum ${name}**: ${anzahl(list.length, "Stelle", "Stellen")}, ${anzahl(wege, "Wegende", "Wegenden")}`;
    });
    if (rest.length > 0) {
        const stellen = rest.reduce((sum, [, list]) => sum + list.length, 0);
        const wege = rest.reduce((sum, [, list]) => sum + list.reduce((n, spot) => n + spot.ends.length, 0), 0);
        zeilen.push(
            `- … und ${anzahl(rest.length, "weitere Gegend", "weitere Gegenden")} mit zusammen ` +
                `${anzahl(stellen, "Stelle", "Stellen")} und ${anzahl(wege, "Wegende", "Wegenden")} ` +
                "(alle unten in der Tabelle, Spalte „Gegend“)",
        );
    }
    return zeilen;
}

function dokument(report: LooseEndpointReport): string {
    const heute = new Date().toISOString().slice(0, 10);
    const lines: string[] = [];

    lines.push("# Lose Wegenden: Arbeitsliste");
    lines.push("");
    lines.push(
        `Stand ${heute}. Erzeugt mit \`npm run ops:lose-wegenden\` aus dem Datenbestand von Avesmaps3D ` +
            `(Kartendomäne \`${report.mapDomainId}\`). **Das Werkzeug liest nur.** Niemand hat an Kartendaten ` +
            "etwas geändert — weder hier noch in Legacy. Repariert wird nach dem Cutoff in Avesmaps3D im Wegeeditor " +
            "(WI-0132 §6), nicht in Legacy.",
    );
    lines.push("");
    lines.push("## Worum es geht");
    lines.push("");
    lines.push(
        "Wege verbinden sich ohne Kreuzungen (WI-0132): Ein Wegende hängt am Ort in seinem Kasten von einer halben " +
            "Karteneinheit (1,5 Meilen), sonst genau an einem anderen Wegende oder genau auf einem anderen Weg. Hängt " +
            "es an einem Ort, der ein Stück weit weg steht, springt die Routenberechnung durch die Luft: Sie rechnet " +
            "die Lücke weder als Weg noch als Zeit, die Strecke wird zu kurz angegeben, und eine Straße gewinnt gegen " +
            "eine andere, die in Wahrheit kürzer ist.",
    );
    lines.push("");
    lines.push(
        "Das passiert vor allem, wenn ein Ort gelöscht wird, auf dem Wege endeten. Der Ort war der Knoten; " +
            "mit ihm verschwindet er, die Wegenden bleiben liegen.",
    );
    lines.push("");
    lines.push(
        "**Die Regel für diese Liste, in einem Satz:** Dort, wo Wege sich treffen, liegen ihre Enden genau " +
            "aufeinander, genau auf dem anderen Weg oder an ihrem Ort.",
    );
    lines.push("");
    lines.push("## Was gemessen wurde");
    lines.push("");
    lines.push(
        `- **${String(report.endpointsTotal)}** Enden von Wegstücken hängen im Routennetz an einem Knoten (ein Weg, ` +
            "der unterwegs über einen Ort läuft, zählt je Stück).",
    );
    lines.push(
        `- **${String(report.loose.length)}** davon hängen ohne genauen Wegkontakt weiter als ` +
            `${String(LOOSE_DISTANCE).replace(".", ",")} Karteneinheiten ` +
            `(${(LOOSE_DISTANCE * 3).toFixed(2).replace(".", ",")} Meilen) von ihrem Ort entfernt.`,
    );
    lines.push(
        `- **Nur gezählt** (Entscheidung B der Koordination 2026-10-10, WI-0132 §10.6): ${String(report.absorbed)} ` +
            "Wegenden liegen genau auf einem anderen Ende oder Weg und springen nur wegen „Ort zuerst“ zum Ort im " +
            `Kasten; ${String(report.detached.length)} kurze Wege liegen ganz im Kasten eines Ortes und haben keine ` +
            "Kante. Beides ist verbunden und keine Stelle für die Redaktion.",
    );
    lines.push(
        `- **Rang 1:** ${String(report.retiredSpots.reduce((sum, spot) => sum + spot.ends.length, 0))} dieser ` +
            `Wegenden liegen an **${String(report.retiredSpots.length)}** Stellen, an denen früher ein Ort stand, ` +
            "den Legacy gelöscht hat. Das sind die harten Fälle.",
    );
    lines.push(
        `- **Anhang:** die übrigen ${String(report.otherSpots.reduce((sum, spot) => sum + spot.ends.length, 0))} ` +
            `losen Wegenden an ${String(report.otherSpots.length)} Stellen, nach Abstand sortiert.`,
    );
    lines.push(
        `- **Sackgassen:** ${String(report.deadEnds)} Wegenden treffen weder Ort noch Weg. Sie fallen nicht aus dem ` +
            "Netz, sind aber keine Verbindung; ihre Stellen zeigt der Prüfhaken **„Wege treffen sich nicht“** im Auge " +
            "(nur Editoren), mit dem nächsten fremden Weg und dem Hinweis „knapp verfehlt“ unter 0,001 E.",
    );
    lines.push("");
    lines.push("## Wie man eine Zeile abarbeitet");
    lines.push("");
    lines.push("1. Den Link in der Zeile **Die Stelle in Legacy** öffnen (bis zum Cutoff die Ansicht des Bestands).");
    lines.push("2. Nachsehen, ob dort wirklich mehrere Wegenden zusammenlaufen.");
    lines.push("3. Nach dem Cutoff im Wegeeditor die unten genannten **Wegenden genau aufeinander oder genau auf den");
    lines.push(
        "   durchgehenden Weg ziehen**, oder den gelöschten Ort wieder anlegen, wenn er zu Unrecht verschwunden ist.",
    );
    lines.push("4. Die **Kennung** ist die `public_id` des Weges; der **Wiki-Key** benennt den Artikel.");
    lines.push("   Der **Name allein genügt nicht** — Wegnamen gibt es mehrfach.");
    lines.push("");
    lines.push(
        "🪤 **Zum Stilllegungstag:** Das ist der Tag, an dem **unser** Abgleich die Löschung bemerkt hat. In " +
            "Legacy kann sie kurz davor geschehen sein; das Datum ist ein Anhaltspunkt für die Suche in der " +
            "Änderungsliste, keine Uhrzeit.",
    );
    lines.push("");
    lines.push("---");
    lines.push("");

    lines.push(
        `## Rang 1 — ${String(report.retiredSpots.length)} Stellen, an denen der Ort gelöscht wurde ` +
            `(${String(report.retiredSpots.reduce((sum, spot) => sum + spot.ends.length, 0))} Wegenden)`,
    );
    lines.push("");
    const haeufung1 = haeufungen(report.retiredSpots);
    if (haeufung1.length > 0) {
        lines.push(
            "**Wo sie liegen** (je Stelle der größte Ort, der noch bis dorthin reicht — eine Metropole bis 8 E, " +
                "eine Großstadt bis 5, eine Stadt bis 3, eine Kleinstadt bis 1,5):",
        );
        lines.push("");
        lines.push(...haeufung1);
        lines.push("");
    }
    report.retiredSpots.forEach((spot, index) => lines.push(stelleBlock(report, spot, index + 1)));
    if (report.retiredSpots.length === 0) lines.push("Keine. Diese Klasse ist abgearbeitet.\n");

    lines.push("---");
    lines.push("");
    lines.push(
        `## Anhang — ${String(report.otherSpots.length)} weitere Stellen mit losen Wegenden ` +
            `(${String(report.otherSpots.reduce((sum, spot) => sum + spot.ends.length, 0))} Wegenden)`,
    );
    lines.push("");
    lines.push(
        "Hier stand nach unserem Bestand **nie** ein Knoten, der gelöscht worden wäre: Die Wegenden sind von " +
            "Anfang an nicht ganz an ihrem Knoten angekommen. Nach Abstand sortiert, der größte zuerst. Alles " +
            "unter einer halben Meile ist meist harmlos.",
    );
    lines.push("");
    const haeufung3 = haeufungen(report.otherSpots, 12);
    if (haeufung3.length > 0) {
        lines.push("**Wo sie liegen:**");
        lines.push("");
        lines.push(...haeufung3);
        lines.push("");
    }
    lines.push(
        zeile("Stelle", "Gegend", "Enden", "größter Abstand", "hängt heute an", "Wege (Wiki-Key · Kennung in Legacy)"),
    );
    lines.push("|---|---|---|---|---|---|");
    for (const spot of report.otherSpots) {
        const maximum = Math.max(...spot.ends.map((end) => end.distance));
        const wege = spot.ends
            .map((end) => {
                const assignment = report.wikiKeys.get(end.pathPublicId);
                return `${end.pathName.trim() === "" ? "(ohne Namen)" : end.pathName} (${assignment ? `\`${assignment.key}\`` : "ohne Wiki-Artikel"} · \`${end.pathPublicId}\`)`;
            })
            .join("<br>");
        lines.push(
            zeile(
                `[(${punktZelle(spot.x, spot.y)})](${legacySpotUrl(spot.x, spot.y)})`,
                spot.nearest?.name ?? "—",
                String(spot.ends.length),
                `${einheit(maximum)} E (${meilen(maximum)} Meilen)`,
                haengtAn(spot.ends[0]),
                wege,
            ),
        );
    }
    if (report.otherSpots.length === 0) lines.push(zeile("—", "—", "—", "—", "—", "—"));
    lines.push("");

    lines.push("---");
    lines.push("");
    lines.push("## Was ohne Adresse bleibt");
    lines.push("");
    const alleWege = new Set(report.loose.map((end) => end.pathPublicId));
    const mitKey = [...alleWege].filter((id) => report.wikiKeys.has(id));
    const knoten = report.retiredSpots.flatMap((spot) => (spot.retired ? [spot.retired] : []));
    const knotenMitKey = knoten.filter((node) => report.wikiKeys.has(node.publicId));
    lines.push(
        `**Jede Stelle hat eine Adresse** — den Pin-Link auf ihren Punkt; das sind ` +
            `${String(report.retiredSpots.length + report.otherSpots.length)} von ` +
            `${String(report.retiredSpots.length + report.otherSpots.length)}.`,
    );
    lines.push("");
    lines.push(
        `**Jeder Weg hat eine eindeutige Kennung** (Legacys \`public_id\`) — ${String(alleWege.size)} von ` +
            `${String(alleWege.size)}. Einen **Wiki-Key** tragen davon ${String(mitKey.length)}, und genau diese ` +
            "haben auch eine eigene Adresse.",
    );
    lines.push("");
    lines.push(
        `**Von den ${String(knoten.length)} gelöschten Orten** tragen ${String(knotenMitKey.length)} einen ` +
            "Wiki-Key; alle tragen ihre Kennung und ihren Namen.",
    );
    lines.push("");
    lines.push(
        "🪤 **Warum nicht alle einen Wiki-Key haben:** Der Schlüssel kommt aus Legacys Zuordnungstafel " +
            "Wiki-Artikel → Kartenobjekt. Ein Weg ohne zugewiesenen Artikel steht dort nicht — das betrifft vor " +
            "allem die erzeugten Namen wie `Strasse-5264`. Für ihn bleibt die **Kennung**, die in jeder Zeile steht " +
            "und in Legacy dieselbe ist wie hier.",
    );
    lines.push("");
    lines.push(
        "🪤 **Warum nicht jeder Weg eine eigene Adresse hat:** In Legacy ist ein Weg nur über den Wiki-Deep-Link " +
            "seines Artikels ansprechbar (`?strasse=` / `?fluss=`). `?place=` löst Wege ausdrücklich **nicht** auf. " +
            "Ohne Artikel gilt deshalb die Adresse der Stelle — und die führt ohnehin genau dorthin, wo gearbeitet wird.",
    );
    lines.push("");
    lines.push(
        "🪤 **Die gelöschten Orte haben keine lebende Adresse mehr:** Legacy kennt sie nicht, und ihre " +
            "Wiki-Zuordnung ist mit ihnen verschwunden. Sie stehen hier mit Name, Art, Kennung und Stilllegungstag, " +
            "damit nachvollziehbar bleibt, was dort stand.",
    );
    lines.push("");
    return lines.join("\n");
}

const database = createDatabase(config.databaseUrl, { max: 1 });
try {
    const report = await loadLooseEndpoints(database, values.domain);
    console.log(looseEndpointSummary(report));
    console.log(`Rang 1: ${String(report.retiredSpots.length)} Stellen an stillgelegten Orten`);
    console.log(
        `Nur gezählt: ${String(report.absorbed)} Treffpunkte im Ortskasten, ${String(report.detached.length)} Wege ohne Kante`,
    );
    console.log(`Anhang: ${String(report.otherSpots.length)} weitere Stellen`);
    console.log(`Sackgassen: ${String(report.deadEnds)} Wegenden (Prüfhaken „Wege treffen sich nicht“)`);
    if (values["nur-zaehlen"]) {
        console.log("\nNUR GEZÄHLT — ohne Schreiben (kein --ziel geschrieben).");
    } else {
        const ziel = resolve(process.cwd(), ZIEL);
        await mkdir(dirname(ziel), { recursive: true });
        await writeFile(ziel, dokument(report), "utf8");
        console.log(`\ngeschrieben: ${ZIEL}`);
    }
} finally {
    await database.end({ timeout: 5 });
}
