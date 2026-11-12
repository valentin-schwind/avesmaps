import { createFinding, type Finding, type FindingObject } from "../../findings.ts";
import type { RiverBurnReport } from "../river-burn.ts";
import type { DomainInputs, DomainPeak } from "./inputs.ts";

/**
 * Die Randbedingungen des Domain-Höhenmodells als BEFUNDE statt als Abbruch.
 *
 * 🔴 Betreiberentscheidung 2026-10-03 („A auch für die Prüfungen“): Seen eben, Gipfel exakt, Meer 0, Flüsse nicht
 * bergauf und der Gipfelkern im Meer halten die Ableitung nicht mehr an. Die Rechnung und ihre Grenzwerte bleiben
 * unverändert; schlägt eine dieser Bedingungen an, steht ein Befund mit Zahlen und betroffenen Objekten im Bericht
 * (`report.findings` des Domain-Rasters, `BEFUND` im Log, Bericht von `legacy:update`), und der Lauf veröffentlicht.
 *
 * Die Fehlerzeilen der unabhängigen Prüfung (`verifyDomainRaster`) haben die Form `sea:N`, `lake:<Nr>:<min>..<max>`,
 * `peak:<id>`, `ignored-peak:<id>` und `river:<id>:<Anstieg>`. Diese Datei macht daraus Befunde. Eine Seefläche trägt in den
 * Eingaben keine öffentliche Kennung (die Eingaben bleiben unverändert, ihr Fingerabdruck auch), genannt wird deshalb ihre
 * Nummer in der Reihenfolge der Eingaben mit der Lage ihres ersten Stützpunkts; ein Fluss die öffentliche Kennung seines Weges
 * (`path.public_id`), ein Gipfel seine öffentliche ID.
 *
 * 🔴 Die Rechnung führt einen Fluss unter `path.id` (der Schlüssel der Eingaben und ihres Fingerabdrucks). Hinaus geht nur die
 * öffentliche Kennung (WI-0131 §5.2): Der Prüfhaken „Flüsse bergaufwärts“ liest diese Befunde, und eine interne Kennung verlässt den
 * Server nie. Ältere Berichte tragen noch `path.id`; der Leseweg übersetzt sie (`apps/server/src/map-checks/uphill-rivers.ts`).
 */

const PREFIX = "gelaende";

/** Der erste Stützpunkt einer Fläche, damit man einen See auf der Karte findet. */
function firstPoint(coordinates: unknown): [number, number] | null {
    if (!Array.isArray(coordinates)) return null;
    if (coordinates.length >= 2 && typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
        return [coordinates[0], coordinates[1]];
    }
    for (const entry of coordinates) {
        const point = firstPoint(entry);
        if (point) return point;
    }
    return null;
}

/** Die öffentliche Kennung je `path.id` der Flüsse in den Eingaben; fehlt sie (ältere Eingaben, Tests), bleibt die Kennung der Rechnung. */
function riverNames(input: Pick<DomainInputs, "rivers">): Map<string, { publicId: string; name: string }> {
    return new Map(
        input.rivers.rivers.map((river) => [river.id, { publicId: river.publicId ?? river.id, name: river.name }]),
    );
}

function peakObject(peak: DomainPeak | undefined, id: string): FindingObject {
    return { table: "terrain_peak", publicId: id, name: peak?.name ?? null };
}

/** Der Gipfelkern (die vier Zellen, aus denen er seine Höhe liest) liegt im Meer. Früher: Abbruch „operator decision needed“. */
export function peakCoreInSeaFinding(peak: DomainPeak): Finding {
    return createFinding(
        `${PREFIX}/gipfelkern_im_meer`,
        `Gipfel ${peak.name}: Der Kern liegt zum Teil im Meer; die Meerzellen werden in der Erosion nicht gesperrt, die Endprüfung nennt das Ergebnis; der Lauf geht weiter`,
        { x: peak.x, y: peak.y, hoehe: peak.h ?? 0 },
        [peakObject(peak, peak.id)],
    );
}

/** See und Fluss ließen sich in der Höchstzahl von Runden nicht zusammenbringen. Früher: Abbruch. */
export function lakeRiverNotConvergedFinding(rounds: number): Finding {
    return createFinding(
        `${PREFIX}/see_fluss_nicht_konvergiert`,
        `See und Fluss sind nach ${String(rounds)} Reparaturrunden nicht im Gleichgewicht; die Einzelbefunde zu Seen und Flüssen folgen aus der Endprüfung; der Lauf geht weiter`,
        { runden: rounds },
    );
}

/** Das Einbrennen der Flüsse ist nicht fertig, oder es steigen Flüsse außerhalb geschützter Gipfelkerne. Früher: „Domain river constraint gate“. */
export function riverGateFinding(
    burn: Pick<RiverBurnReport, "converged" | "unresolved" | "peakRises">,
    input: Pick<DomainInputs, "rivers">,
): Finding {
    const rivers = riverNames(input);
    return createFinding(
        `${PREFIX}/fluss_bergauf_ungeloest`,
        `Flüsse: Das Einbrennen ist ${burn.converged ? "" : "NICHT "}abgeschlossen, ${String(burn.unresolved.length)} Flüsse steigen außerhalb geschützter Gipfelkerne (${String(burn.peakRises.length)} an geschützten Kernen sind erlaubt); der Lauf geht weiter`,
        {
            abgeschlossen: String(burn.converged),
            ungeloest: burn.unresolved.length,
            anGipfelkernen: burn.peakRises.length,
        },
        burn.unresolved.map((river) => ({
            table: "path",
            publicId: rivers.get(river.id)?.publicId ?? river.id,
            name: river.name,
        })),
        burn.unresolved.length,
        burn.unresolved.map(
            (river) =>
                `${river.name} (${rivers.get(river.id)?.publicId ?? river.id}): Anstieg ${String(river.value)} Schritt`,
        ),
    );
}

/** Die Fehlerzeilen der unabhängigen Prüfung des Höhenrasters als Befunde, je Art einer. */
export function constraintFindings(errors: readonly string[], input: DomainInputs): Finding[] {
    const peaks = new Map(input.peaks.map((peak) => [peak.id, peak]));
    const rivers = riverNames(input);
    let seaCells = 0;
    const lakes: { objects: FindingObject; note: string }[] = [];
    const exact: FindingObject[] = [];
    const exactNotes: string[] = [];
    const ignored: FindingObject[] = [];
    const rising: { object: FindingObject; note: string }[] = [];

    for (const error of errors) {
        const [kind = ""] = error.split(":", 1);
        const rest = error.slice(kind.length + 1);
        if (kind === "sea") {
            seaCells += Number(rest) || 0;
        } else if (kind === "lake") {
            // `<Fläche>` oder `<Fläche>.<Teil>`: ein See ist ein Polygonteil einer Seefläche (`lakeBodies`).
            const match = /^(\d+)(?:\.(\d+))?:(.+)\.\.(.+)$/.exec(rest);
            const index = Number(match?.[1] ?? Number.NaN);
            const part = match?.[2] === undefined ? null : Number(match[2]);
            const geometry = input.water[index]?.geometry;
            const polygon =
                part !== null && geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)
                    ? (geometry.coordinates as unknown[])[part]
                    : geometry?.coordinates;
            const point = Number.isInteger(index) ? firstPoint(polygon) : null;
            const where = point ? `, erster Stützpunkt ${String(point[0])}/${String(point[1])}` : "";
            const span = match ? `Höhen ${match[3] ?? ""}..${match[4] ?? ""} Schritt` : rest;
            const number = `${match?.[1] ?? "?"}${part === null ? "" : `, Teil ${String(part)}`}`;
            lakes.push({
                objects: { table: "region_area (See)", publicId: `Eingabe-Nr. ${number}`, name: span },
                note: `See Nr. ${number}: ${span}${where}`,
            });
        } else if (kind === "peak") {
            exact.push(peakObject(peaks.get(rest), rest));
            const peak = peaks.get(rest);
            exactNotes.push(
                `${peak?.name ?? rest} (${rest}): Soll ${String(peak?.h ?? "?")} Schritt an allen vier Kernzellen`,
            );
        } else if (kind === "ignored-peak") {
            ignored.push(peakObject(peaks.get(rest), rest));
        } else if (kind === "river") {
            const cut = rest.lastIndexOf(":");
            const id = cut < 0 ? rest : rest.slice(0, cut);
            const value = cut < 0 ? "?" : rest.slice(cut + 1);
            const river = rivers.get(id);
            const publicId = river?.publicId ?? id;
            rising.push({
                object: { table: "path", publicId, name: river?.name ?? null },
                note: `${river?.name ?? "Fluss"} (${publicId}): Anstieg ${value} Schritt`,
            });
        }
    }

    const findings: Finding[] = [];
    if (seaCells > 0) {
        findings.push(
            createFinding(
                `${PREFIX}/meer_nicht_null`,
                `Meer: ${String(seaCells)} Zellen sind nicht 0 (oder Land liegt im Meer); der Lauf geht weiter`,
                { zellen: seaCells },
            ),
        );
    }
    if (lakes.length > 0) {
        findings.push(
            createFinding(
                `${PREFIX}/see_nicht_eben`,
                `Seen: ${String(lakes.length)} Seen sind nicht eben; der Lauf geht weiter`,
                { seen: lakes.length },
                lakes.map((lake) => lake.objects),
                lakes.length,
                lakes.map((lake) => lake.note),
            ),
        );
    }
    if (exact.length > 0) {
        findings.push(
            createFinding(
                `${PREFIX}/gipfel_nicht_exakt`,
                `Gipfel: ${String(exact.length)} bekannte Gipfel haben nicht ihre Höhe an allen vier Kernzellen; der Lauf geht weiter`,
                { gipfel: exact.length },
                exact,
                exact.length,
                exactNotes,
            ),
        );
    }
    if (ignored.length > 0) {
        findings.push(
            createFinding(
                `${PREFIX}/gipfel_ignoriert_trotz_land`,
                `Gipfel: ${String(ignored.length)} ignorierte Meer-Gipfel haben inzwischen Land; der Lauf geht weiter`,
                { gipfel: ignored.length },
                ignored,
            ),
        );
    }
    if (rising.length > 0) {
        findings.push(
            createFinding(
                `${PREFIX}/fluss_steigt`,
                `Flüsse: ${String(rising.length)} Flüsse steigen im fertigen Höhenraster bergauf; der Lauf geht weiter`,
                { fluesse: rising.length },
                rising.map((river) => river.object),
                rising.length,
                rising.map((river) => river.note),
            ),
        );
    }
    return findings;
}

/** Dieselben Befunde als Klartextzeilen für die Prüfung (`offenders`): Meldung, dann je Objekt eine Zeile. */
export function constraintLines(errors: readonly string[], input: DomainInputs): string[] {
    return constraintFindings(errors, input).flatMap((finding) => [
        finding.message,
        ...finding.notes.map((note) => `  ${note}`),
        ...(finding.notes.length === 0
            ? finding.objects.map((object) => `  ${object.table} ${object.publicId} ${object.name ?? "(ohne Namen)"}`)
            : []),
    ]);
}
