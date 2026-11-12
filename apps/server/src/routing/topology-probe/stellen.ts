import { readFileSync } from "node:fs";

/**
 * Die Stellenliste aus WI-0132 P1 (`project-control/discovery/wi-0132-p1-netz-ohne-kreuzungen-2026-10-10-stellen.csv`):
 * jede damals aktive Kreuzung mit Klasse, Grund und beteiligten Wegen. Sie ist der feste Bezug für den Vergleich von Release N
 * (jede Abweichung einer Stelle zuordnen) und für den Nachweis, dass der Prüfhaken jede Verluststelle findet. Gelesen wird
 * die versionierte Datei, nie die Tabelle `crossing`.
 */

export interface Stelle {
    /** Die `public_id` der Kreuzung in P1, nur noch Kennung der Stelle. */
    id: string;
    x: number;
    y: number;
    /** `a` reproduziert, `b` Ende trifft nichts, `c` X am Stützpunkt, `d` sonst. */
    cls: string;
    reason: string;
    /** Die Teilnehmer: Weg (`public_id`) und Rolle (`anfang`, `ende`, `innen`). */
    participants: { path: string; role: string }[];
}

/** Eine Zeile der Liste: Felder mit `;` getrennt, ein Feld in Anführungszeichen darf `;` und `""` enthalten. */
export function csvFields(line: string): string[] {
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index] as string;
        if (quoted) {
            if (char === '"' && line[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (char === '"') quoted = false;
            else field += char;
        } else if (char === '"') quoted = true;
        else if (char === ";") {
            fields.push(field);
            field = "";
        } else field += char;
    }
    fields.push(field);
    return fields;
}

export function readStellen(file: string): Stelle[] {
    const lines = readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1);
    return lines.map((line) => {
        const [id, x, y, cls, reason, , ways] = csvFields(line);
        const participants = (ways ?? "")
            .split(" ; ")
            .filter((one) => one.trim() !== "")
            .map((one) => {
                // Klasse a steht knapp (`weg|rolle`), alle anderen mit Name, Wegart, Rolle, Abstand und Kontakt.
                const parts = one.split("|");
                return { path: parts[0] ?? "", role: (cls === "a" ? parts[1] : parts[3]) ?? "" };
            });
        return { id: id ?? "", x: Number(x), y: Number(y), cls: cls ?? "", reason: reason ?? "", participants };
    });
}

/**
 * Die 443 Stellen echten Verbindungsverlusts aus P1: b über den Kasten oder exakt mit Partner, c, d zerfallen und d Ende an
 * Ort. Nicht dabei: b „allein“ (die Kreuzung trug nur dieses Ende; als Sackgasse gleichwertig) und d „alle am Ort“
 * (verbunden über den Ortsknoten).
 */
export function isLoss(stelle: Pick<Stelle, "cls" | "reason">): boolean {
    if (stelle.cls === "b") return stelle.reason !== "allein";
    if (stelle.cls === "c") return true;
    return stelle.cls === "d" && (stelle.reason === "zerfallen" || stelle.reason === "ende_an_ort");
}
