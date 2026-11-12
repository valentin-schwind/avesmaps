/**
 * Baut Legacys produktiven Routinggraphen aus dem Snapshot nach und misst ihn (MCS-017, WI-0017).
 *
 * Aufruf: node scripts/dev/measure-legacy-route-graph.mjs [--snapshot <map-features.json>] [--list <datei.md>]
 *
 * `--list` schreibt die Wegenden, an denen Legacys Regel und „nächster Knoten" verschieden anbinden, als
 * Tabelle für die Editoren: Repariert ist eine Stelle, wenn das Wegende genau auf dem gemeinten Ort liegt.
 *
 * Die Regeln stammen aus `api/_internal/routing/client-graph.php` (Discovery gegen avesmaps@bfec670):
 *
 *   Knoten    benannte Punktobjekte ausser Labels, also Orte UND Kreuzungen  (network-data.php#L70-L77)
 *   Wegende   Knoten im Kasten |dx| < 0,5 und |dy| < 0,5; ein exakter Treffer (< 0,01) hat Vorrang, unter
 *             mehreren der naechste; sonst entscheidet der niedrigste Listenindex, nicht die Naehe
 *             (client-graph.php#L22-L30, #L1631-L1656)
 *   Ende ohne Knoten   der ganze Weg faellt heraus                         (client-graph.php#L239-L241)
 *   Innenpunkt teilt den Weg nur, wenn er auf 5 Stellen gerundet exakt auf einem Knoten liegt
 *
 * 🪤 Legacy haengt danach jede abgetrennte Komponente ueber eine kuenstliche Querfeldein-Bruecke an
 * (Laenge x 25, ohne Distanzgrenze). Gemessen wird hier der Graph VOR diesen Bruecken - also, wie
 * viel von einer Route auf echten Wegen liegt und wie viel die Bruecken verdecken.
 *
 * Nur lesend: der Snapshot liegt ausserhalb des Repositoriums und wird nicht veraendert.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
    options: {
        snapshot: { type: "string", default: "C:/avesmaps3d-data/legacy-snapshots/map-features.json" },
        list: { type: "string" },
    },
});
const snapshot = JSON.parse(readFileSync(values.snapshot, "utf8"));
const features = snapshot.features;

const ENDPOINT_BOX = 0.5;
const EXACT_HIT = 0.01;

const nodes = features
    .filter(
        (feature) =>
            feature.geometry.type === "Point" &&
            feature.properties?.feature_type !== "label" &&
            String(feature.properties?.name ?? "").trim() !== "",
    )
    .map((feature, index) => ({
        index,
        id: feature.id,
        name: String(feature.properties.name).trim(),
        isPlace: feature.properties.feature_type === "location",
        x: feature.geometry.coordinates[0],
        y: feature.geometry.coordinates[1],
    }));
const paths = features.filter(
    (feature) => feature.geometry.type === "LineString" && feature.properties?.feature_type === "path",
);

const cells = new Map();
for (const node of nodes) {
    const cell = `${Math.floor(node.x)}:${Math.floor(node.y)}`;
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell).push(node);
}

const differing = [];
/** Legacys Wahl fuer ein Wegende - und nebenbei, ob sie vom naechstgelegenen Knoten abweicht. */
function attach([x, y], path, side) {
    const inBox = [];
    for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
            for (const node of cells.get(`${Math.floor(x) + dx}:${Math.floor(y) + dy}`) ?? []) {
                if (Math.abs(node.x - x) < ENDPOINT_BOX && Math.abs(node.y - y) < ENDPOINT_BOX) inBox.push(node);
            }
        }
    }
    if (inBox.length === 0) return undefined;
    const distance = (node) => Math.hypot(node.x - x, node.y - y);
    const exact = inBox.filter((node) => distance(node) < EXACT_HIT);
    // Unter exakten Treffern gewinnt der naechste, sonst der niedrigste Listenindex.
    const legacyChoice =
        exact.length > 0
            ? [...exact].sort((a, b) => distance(a) - distance(b))[0]
            : [...inBox].sort((a, b) => a.index - b.index)[0];
    const nearest = [...inBox].sort((a, b) => distance(a) - distance(b))[0];
    if (legacyChoice !== nearest) {
        differing.push({ path, side, x, y, legacy: legacyChoice, nearest, distance });
    }
    return legacyChoice;
}

const exactKey = (x, y) => `${x.toFixed(5)}:${y.toFixed(5)}`;
const exactNodes = new Map(nodes.map((node) => [exactKey(node.x, node.y), node]));

const parent = new Map(nodes.map((node) => [node.id, node.id]));
function find(id) {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    parent.set(id, root);
    return root;
}
const union = (a, b) => parent.set(find(a), find(b));

const dropped = {};
let used = 0;
let edges = 0;
for (const path of paths) {
    const coordinates = path.geometry.coordinates;
    const start = attach(coordinates[0], path, "Anfang");
    const end = attach(coordinates[coordinates.length - 1], path, "Ende");
    if (!start || !end) {
        const subtype = path.properties.feature_subtype;
        dropped[subtype] = (dropped[subtype] ?? 0) + 1;
        continue;
    }
    used += 1;
    let previous = start;
    for (const [x, y] of coordinates.slice(1, -1)) {
        const hit = exactNodes.get(exactKey(x, y));
        if (hit && hit !== previous) {
            union(previous.id, hit.id);
            previous = hit;
            edges += 1;
        }
    }
    union(previous.id, end.id);
    edges += 1;
}

const places = new Map();
const size = new Map();
for (const node of nodes) {
    const root = find(node.id);
    size.set(root, (size.get(root) ?? 0) + 1);
    if (node.isPlace) places.set(root, (places.get(root) ?? 0) + 1);
}
const components = [...places.entries()].sort((a, b) => b[1] - a[1]);
const placeCount = nodes.filter((node) => node.isPlace).length;
const names = new Map();
for (const node of nodes.filter((candidate) => candidate.isPlace))
    names.set(node.name, (names.get(node.name) ?? 0) + 1);

console.log(
    JSON.stringify(
        {
            revision: snapshot.revision,
            knoten: nodes.length,
            orte: placeCount,
            kreuzungen: nodes.length - placeCount,
            wege: paths.length,
            wegeImNetz: used,
            wegeHerausgefallen: dropped,
            kanten: edges,
            anbindungWeichtVomNaechstenAb: differing.length,
            doppelteOrtsnamen: [...names.values()].filter((count) => count > 1).length,
            teilnetzeMitOrten: components.length,
            hauptnetzOrte: components[0][1],
            hauptnetzAnteil: Number((components[0][1] / placeCount).toFixed(3)),
            naechsteTeilnetze: components.slice(1, 8).map(([, count]) => count),
            orteOhneWeg: components.filter(([root]) => size.get(root) === 1).length,
        },
        null,
        2,
    ),
);

if (values.list) {
    const label = (node, distance) => `${node.name} (${distance(node).toFixed(2)})`;
    const rows = differing
        .map(({ path, side, x, y, legacy, nearest, distance }) => {
            const name = String(path.properties.name ?? "").trim() || "(ohne Name)";
            return `| ${name} | ${path.properties.feature_subtype} | ${side} | ${x.toFixed(3)}, ${y.toFixed(3)} | ${label(legacy, distance)} | ${label(nearest, distance)} | \`${path.id}\` |`;
        })
        .sort();
    writeFileSync(
        values.list,
        [
            "# Wegenden, an denen Legacys Anbindung vom nächsten Ort abweicht",
            "",
            "Ein Wegende hängt an einem Knoten (Ort oder Kreuzung), wenn es in x und y weniger als 0,5 Einheiten entfernt liegt. Liegen dort mehrere und keiner genau auf dem Ende, nimmt Legacy den, der in seiner Liste zuerst steht; Avesmaps3D nimmt den nächsten. **Repariert ist eine Stelle, wenn das Wegende genau auf dem gemeinten Knoten liegt** - dann rechnen beide gleich.",
            "",
            `Snapshot ${snapshot.revision}, ${rows.length} Wegenden. Erzeugt von \`scripts/dev/measure-legacy-route-graph.mjs --list\`.`,
            "",
            "| Weg | Art | Ende | Koordinate | Legacy hängt an (Abstand) | nächster Knoten (Abstand) | Weg-Id |",
            "|---|---|---|---|---|---|---|",
            ...rows,
            "",
        ].join("\n"),
    );
}
