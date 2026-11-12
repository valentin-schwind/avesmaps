import {
    ABZUG_MEDIEN_VERZEICHNISSE,
    ABZUG_PHASEN,
    ABZUG_PLATZHALTER_TEXT,
    ABZUG_PLATZHALTER_UUID,
    ABZUG_TAR_MEDIEN,
    ABZUG_TAR_TAFELN,
    type AbzugPlan,
    type AbzugPlanTafel,
    type AbzugQuelle,
    type AbzugRegeln,
    type AbzugRegelTafel,
    type AbzugSpalte,
} from "@avesmaps3d/shared";
import { abzugsSpalten, type Katalog, type KatalogTafel } from "./katalog.ts";
import type { GeladeneRegeln } from "./regeln.ts";

/**
 * Der Exportplan (WI-0251): aus den Regeln und dem tatsächlichen Schema die Befehle, die Claudios Export in EINER lesenden Transaktion
 * ausführt. Reine Rechnung auf dem Katalog; sie liest nichts und schreibt nichts.
 *
 * 🔴 **Im Zweifel hält der Plan an.** Eine Tafel ohne Einordnung, eine Spalte, die es nicht gibt, ein Fremdschlüssel ins Leere: Der Plan
 * wirft, statt etwas Halbes auszugeben. Auf dem VPS steht dasselbe Schema wie im Release, aus dem die Regeln kommen; weicht beides ab, soll der
 * Export rot sein und nicht lautlos Daten mitnehmen, die niemand eingeordnet hat.
 */

/** Ein Befund der Prüfung der Regeln gegen das Schema; `code` für Tests und Meldungen, `text` für Menschen. */
export interface RegelBefund {
    readonly code:
        | "nicht_eingeordnet"
        | "unbekannte_tafel"
        | "nur_public"
        | "leeren_bei_weglassen"
        | "spalte_fehlt"
        | "spalte_nicht_nullbar"
        | "spalte_im_schluessel"
        | "spalte_in_pruefung"
        | "spalte_generiert"
        | "verweis_auf_weggelassene"
        | "verweis_von_weggelassener"
        | "voraussetzung_fehlt"
        | "array_typ_nicht_uebertragbar"
        | "schema_doppelt"
        | "spalte_doppelt"
        | "verdecken_typ"
        | "verdecken_eindeutig"
        | "verdecken_verweis"
        | "medien_tafel"
        | "medien_spalte"
        | "ohne_zeilen";
    readonly tafel: string;
    readonly spalte?: string;
    readonly text: string;
}

function mitgenommen(regeln: AbzugRegeln, voll: string): boolean {
    return regeln.tafeln[voll]?.art === "mitnehmen";
}

/** Der Platzhalter für den Typ einer Spalte (`uuid` oder Text), sonst `null`: andere Typen kann man nicht verdecken. */
export function platzhalterFuer(typ: string): string | null {
    if (typ === "uuid") return ABZUG_PLATZHALTER_UUID;
    if (typ === "text" || typ.startsWith("character varying")) return ABZUG_PLATZHALTER_TEXT;
    return null;
}

/** Prüft die Regeln gegen das Schema; leer heißt: Jede Tafel ist eingeordnet, und jede Angabe stimmt. */
export function pruefeRegeln(katalog: Katalog, regeln: AbzugRegeln): RegelBefund[] {
    const befunde: RegelBefund[] = [];
    const weggelasseneSchemata = new Set(Object.keys(regeln.schemataWeglassen));

    for (const tafel of katalog.tafeln.values()) {
        if (weggelasseneSchemata.has(tafel.schema)) {
            if (regeln.tafeln[tafel.voll] !== undefined && regeln.tafeln[tafel.voll]?.lokalLeeren !== true) {
                befunde.push({
                    code: "schema_doppelt",
                    tafel: tafel.voll,
                    text: `${tafel.voll}: Das Schema ${tafel.schema} bleibt ganz zu Hause, die Tafel braucht keinen eigenen Eintrag`,
                });
            }
            continue;
        }
        if (regeln.tafeln[tafel.voll] === undefined) {
            befunde.push({
                code: "nicht_eingeordnet",
                tafel: tafel.voll,
                text: `${tafel.voll}: keine Einordnung in config/abzug/regeln.json (mitnehmen oder weglassen)`,
            });
        }
    }

    for (const [voll, regel] of Object.entries(regeln.tafeln)) {
        const tafel = katalog.tafeln.get(voll);
        if (tafel === undefined) {
            befunde.push({ code: "unbekannte_tafel", tafel: voll, text: `${voll}: Die Tafel gibt es im Schema nicht` });
            continue;
        }
        if (regel.art === "weglassen") {
            if (regel.leeren !== undefined || regel.verdecken !== undefined) {
                befunde.push({
                    code: "leeren_bei_weglassen",
                    tafel: voll,
                    text: `${voll}: Spalten leeren oder verdecken hat bei einer weggelassenen Tafel keinen Sinn`,
                });
            }
            if (regel.vorausgesetzt === true && regel.lokalLeeren === true) {
                befunde.push({
                    code: "voraussetzung_fehlt",
                    tafel: voll,
                    text: `${voll}: vorausgesetzt (bleibt) und lokalLeeren (wird geleert) schließen sich aus`,
                });
            }
            continue;
        }
        if (tafel.schema !== "public") {
            befunde.push({
                code: "nur_public",
                tafel: voll,
                text: `${voll}: Gelesen wird nur das Schema public (ADR-0010), diese Tafel kann nicht mitkommen`,
            });
        }
        if (regel.ohneZeilen !== undefined) {
            const { spalte: name } = regel.ohneZeilen;
            const verwiesen = katalog.fremdschluessel.find((fk) => fk.nach === voll);
            if (!tafel.spalten.some((kandidat) => kandidat.name === name) || regel.leeren?.includes(name) === true) {
                befunde.push({
                    code: "ohne_zeilen",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Nach dieser Spalte lässt sich nicht auslassen (es gibt sie nicht, oder sie wird geleert)`,
                });
            } else if (verwiesen !== undefined) {
                befunde.push({
                    code: "ohne_zeilen",
                    tafel: voll,
                    text: `${voll}: ${verwiesen.von} verweist darauf; ausgelassene Zeilen brächen den Verweis`,
                });
            }
        }
        for (const name of regel.leeren ?? []) {
            const spalte = tafel.spalten.find((kandidat) => kandidat.name === name);
            if (spalte === undefined) {
                befunde.push({
                    code: "spalte_fehlt",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Die Spalte gibt es nicht`,
                });
            } else if (spalte.generiert) {
                befunde.push({
                    code: "spalte_generiert",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Eine errechnete Spalte kommt ohnehin nicht mit`,
                });
            } else if (spalte.nichtNull) {
                befunde.push({
                    code: "spalte_nicht_nullbar",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Die Spalte darf nicht NULL sein und kann nicht leer werden; lasse die Tafel weg oder mache die Spalte nullbar`,
                });
            } else if (spalte.imPrimaerschluessel) {
                befunde.push({
                    code: "spalte_im_schluessel",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Die Spalte gehört zum Primärschlüssel`,
                });
            } else if (spalte.inPruefung) {
                befunde.push({
                    code: "spalte_in_pruefung",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Eine CHECK-Bedingung nennt die Spalte; leer könnte das Einspielen scheitern`,
                });
            }
        }
        for (const name of regel.verdecken ?? []) {
            const spalte = tafel.spalten.find((kandidat) => kandidat.name === name);
            if (spalte === undefined) {
                befunde.push({
                    code: "spalte_fehlt",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Die Spalte gibt es nicht`,
                });
                continue;
            }
            if (regel.leeren?.includes(name) === true) {
                befunde.push({
                    code: "spalte_doppelt",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: steht in leeren und in verdecken`,
                });
            }
            if (spalte.generiert) {
                befunde.push({
                    code: "spalte_generiert",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Eine errechnete Spalte kommt ohnehin nicht mit`,
                });
            }
            if (platzhalterFuer(spalte.typ) === null) {
                befunde.push({
                    code: "verdecken_typ",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Verdeckt werden nur Spalten vom Typ uuid oder text (hier ${spalte.typ})`,
                });
            }
            if (spalte.inEindeutigem) {
                befunde.push({
                    code: "verdecken_eindeutig",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Die Spalte steht in einem eindeutigen Schlüssel; ein Platzhalter machte Werte gleich`,
                });
            }
            if (katalog.fremdschluessel.some((fk) => fk.von === voll && fk.spalten.includes(name))) {
                befunde.push({
                    code: "verdecken_verweis",
                    tafel: voll,
                    spalte: name,
                    text: `${voll}.${name}: Die Spalte ist ein Fremdschlüssel; ein Platzhalter verwiese ins Leere`,
                });
            }
        }
        for (const spalte of abzugsSpalten(tafel)) {
            if (spalte.arrayMitEigenemTyp) {
                befunde.push({
                    code: "array_typ_nicht_uebertragbar",
                    tafel: voll,
                    spalte: spalte.name,
                    text: `${voll}.${spalte.name}: Ein Array mit eigenem Elementtyp trägt im Binärformat dessen OID und lässt sich nicht in eine andere Datenbank kopieren`,
                });
            }
        }
    }

    // Mediendateien: Die Tafel, die sie nennt, kommt mit, und ihre drei Spalten gibt es mit dem Typ, den der Export liest.
    const medien = regeln.medien;
    const medienTafel = katalog.tafeln.get(medien.tafel);
    if (medienTafel === undefined || !mitgenommen(regeln, medien.tafel)) {
        befunde.push({
            code: "medien_tafel",
            tafel: medien.tafel,
            text: `${medien.tafel}: Die Tafel der Mediendateien muss es geben und mitkommen`,
        });
    } else {
        const erwartet: readonly (readonly [string, string, readonly string[]])[] = [
            ["schluessel", medien.schluessel, ["text"]],
            ["groesse", medien.groesse, ["bigint", "integer"]],
            ["sha256", medien.sha256, ["text"]],
        ];
        for (const [rolle, name, typen] of erwartet) {
            const spalte = medienTafel.spalten.find((kandidat) => kandidat.name === name);
            if (spalte === undefined || spalte.generiert || !typen.includes(spalte.typ)) {
                befunde.push({
                    code: "medien_spalte",
                    tafel: medien.tafel,
                    spalte: name,
                    text: `${medien.tafel}.${name}: Als ${rolle} der Mediendateien braucht es eine Spalte vom Typ ${typen.join(" oder ")}`,
                });
            }
        }
    }

    // Fremdschlüssel: Was mitkommt, darf nur auf Mitgenommenes, Vorausgesetztes oder auf eine geleerte Spalte zeigen.
    for (const fk of katalog.fremdschluessel) {
        const vonMit = mitgenommen(regeln, fk.von);
        const nachMit = mitgenommen(regeln, fk.nach);
        if (vonMit && !nachMit) {
            const geleert = regeln.tafeln[fk.von]?.leeren ?? [];
            const leer = fk.spalten.some((spalte) => geleert.includes(spalte));
            const voraus = regeln.tafeln[fk.nach]?.vorausgesetzt === true;
            if (!leer && !voraus) {
                befunde.push({
                    code: "verweis_auf_weggelassene",
                    tafel: fk.von,
                    text: `${fk.von} (${fk.spalten.join(", ")}) verweist auf ${fk.nach}, das nicht mitkommt: nimm ${fk.nach} mit, leere die Spalte oder setze es als vorausgesetzt`,
                });
            }
        }
    }
    // Lokal geleert wird, was mitgenommen wird, dazu die als `lokalLeeren` genannten Tafeln. Verweist eine andere Tafel auf sie, schlüge das
    // Leeren fehl; der Befund nennt, wen die Regeln noch eintragen müssen.
    const geleert = new Set<string>(
        [...katalog.tafeln.keys()].filter(
            (voll) => mitgenommen(regeln, voll) || regeln.tafeln[voll]?.lokalLeeren === true,
        ),
    );
    for (const fk of katalog.fremdschluessel) {
        if (!geleert.has(fk.von) && geleert.has(fk.nach) && regeln.tafeln[fk.von]?.vorausgesetzt !== true) {
            befunde.push({
                code: "verweis_von_weggelassener",
                tafel: fk.von,
                text: `${fk.von} (${fk.spalten.join(", ")}) verweist auf ${fk.nach}, das beim Einspielen ersetzt wird: trage ${fk.von} mit "lokalLeeren": true ein oder nimm es mit`,
            });
        }
    }
    return befunde;
}

/** Eltern vor Kindern; Tafeln in einem Kreis bleiben beieinander und stehen zusätzlich in `zyklen`. Deterministisch (nach Namen). */
export function ladeFolge(
    tafeln: readonly string[],
    fremdschluessel: readonly { von: string; nach: string }[],
): { folge: string[]; zyklen: string[][] } {
    const knoten = [...tafeln].sort();
    const bekannt = new Set(knoten);
    const eltern = new Map<string, Set<string>>(knoten.map((name) => [name, new Set()]));
    for (const fk of fremdschluessel) {
        if (fk.von === fk.nach || !bekannt.has(fk.von) || !bekannt.has(fk.nach)) continue;
        eltern.get(fk.von)!.add(fk.nach);
    }

    // Tarjan: Die Gruppen kommen so heraus, dass jede NACH den Gruppen steht, auf die sie verweist.
    let zaehler = 0;
    const index = new Map<string, number>();
    const tief = new Map<string, number>();
    const stapel: string[] = [];
    const aufStapel = new Set<string>();
    const gruppen: string[][] = [];
    const besuche = (start: string): void => {
        // Iterativ, damit tief verschachtelte Verweise den Aufrufstapel nicht sprengen.
        const arbeit: { name: string; weiter: string[] }[] = [{ name: start, weiter: [...eltern.get(start)!].sort() }];
        index.set(start, zaehler);
        tief.set(start, zaehler);
        zaehler += 1;
        stapel.push(start);
        aufStapel.add(start);
        while (arbeit.length > 0) {
            const aktuell = arbeit[arbeit.length - 1]!;
            const naechster = aktuell.weiter.shift();
            if (naechster !== undefined) {
                if (!index.has(naechster)) {
                    index.set(naechster, zaehler);
                    tief.set(naechster, zaehler);
                    zaehler += 1;
                    stapel.push(naechster);
                    aufStapel.add(naechster);
                    arbeit.push({ name: naechster, weiter: [...eltern.get(naechster)!].sort() });
                } else if (aufStapel.has(naechster)) {
                    tief.set(aktuell.name, Math.min(tief.get(aktuell.name)!, index.get(naechster)!));
                }
                continue;
            }
            arbeit.pop();
            const vorher = arbeit[arbeit.length - 1];
            if (vorher !== undefined) tief.set(vorher.name, Math.min(tief.get(vorher.name)!, tief.get(aktuell.name)!));
            if (tief.get(aktuell.name) === index.get(aktuell.name)) {
                const gruppe: string[] = [];
                for (;;) {
                    const name = stapel.pop()!;
                    aufStapel.delete(name);
                    gruppe.push(name);
                    if (name === aktuell.name) break;
                }
                gruppen.push(gruppe.sort());
            }
        }
    };
    for (const name of knoten) if (!index.has(name)) besuche(name);

    // Kahn über die Gruppen, kleinster Name zuerst: eine lesbare, stabile Reihenfolge.
    const gruppeVon = new Map<string, number>();
    gruppen.forEach((gruppe, nummer) => gruppe.forEach((name) => gruppeVon.set(name, nummer)));
    const abhaengigVon = gruppen.map(() => new Set<number>());
    for (const [kind, elternMenge] of eltern) {
        for (const elter of elternMenge) {
            const von = gruppeVon.get(kind)!;
            const nach = gruppeVon.get(elter)!;
            if (von !== nach) abhaengigVon[von]!.add(nach);
        }
    }
    const fertig = new Set<number>();
    const folge: string[] = [];
    while (fertig.size < gruppen.length) {
        const bereit = gruppen
            .map((gruppe, nummer) => ({ nummer, name: gruppe[0]! }))
            .filter(({ nummer }) => !fertig.has(nummer) && [...abhaengigVon[nummer]!].every((e) => fertig.has(e)))
            .sort((a, b) => a.name.localeCompare(b.name));
        const naechste = bereit[0];
        if (naechste === undefined) throw new Error("Ladefolge: unerwarteter Kreis zwischen Gruppen");
        fertig.add(naechste.nummer);
        folge.push(...gruppen[naechste.nummer]!);
    }
    return { folge, zyklen: gruppen.filter((gruppe) => gruppe.length > 1) };
}

export const bezeichner = (name: string): string => `"${name.replace(/"/gu, '""')}"`;

/** `schema.tafel` als SQL-Bezeichner: `"schema"."tafel"`. */
export function tafelBezeichner(voll: string): string {
    const punkt = voll.indexOf(".");
    return `${bezeichner(voll.slice(0, punkt))}.${bezeichner(voll.slice(punkt + 1))}`;
}

/** Der Dateiname einer Tafel im Tar. */
export function tarDatei(voll: string): string {
    return `${ABZUG_TAR_TAFELN}${voll}.bin`;
}

function planTafel(
    tafel: KatalogTafel,
    leeren: readonly string[],
    verdecken: readonly string[],
    ohneZeilen?: AbzugRegelTafel["ohneZeilen"],
): AbzugPlanTafel {
    const spalten = abzugsSpalten(tafel);
    const auswahl = spalten
        .map((spalte) => {
            const name = bezeichner(spalte.name);
            if (leeren.includes(spalte.name)) return `NULL::${spalte.typ} AS ${name}`;
            if (verdecken.includes(spalte.name)) {
                const platzhalter = platzhalterFuer(spalte.typ);
                if (platzhalter === null)
                    throw new Error(`${tafel.voll}.${spalte.name}: nicht verdeckbar (${spalte.typ})`);
                return `CASE WHEN ${name} IS NULL THEN NULL ELSE '${platzhalter}'::${spalte.typ} END AS ${name}`;
            }
            return name;
        })
        .join(", ");
    const felder: AbzugSpalte[] = spalten.map((spalte) => ({ name: spalte.name, typ: spalte.typ }));
    const auslassen =
        ohneZeilen === undefined
            ? ""
            : ` WHERE ${bezeichner(ohneZeilen.spalte)} NOT IN (${ohneZeilen.nicht.map((wert) => `'${wert.split("'").join("''")}'`).join(", ")})`;
    const abfrage = `SELECT ${auswahl} FROM ${bezeichner(tafel.schema)}.${bezeichner(tafel.name)}${auslassen}`;
    return {
        tafel: tafel.voll,
        datei: tarDatei(tafel.voll),
        spalten: felder,
        leeren: [...leeren],
        verdeckt: [...verdecken],
        abfrage,
        copy: `COPY (${abfrage}) TO STDOUT (FORMAT binary)`,
    };
}

/** Die Arbeitsdatei, in die das psql-Skript die Liste der Mediendateien schreibt (steht nicht im Tar). */
export const MEDIENLISTE_DATEI = "medien-liste.csv";
export const PLAN_ABFRAGE_MIGRATIONEN = "SELECT version, checksum FROM public.schema_migration ORDER BY version";
export const PLAN_ABFRAGE_KARTENDOMAENEN =
    "SELECT id, coordinate_space_id AS koordinatenraum, config_checksum AS pruefsumme FROM public.map_domain ORDER BY id";

/** Die Abfrage, die zu jeder Zeile der Medientafel den Schlüssel unter `MEDIA_ROOT`, die Größe und die Prüfsumme laut Zeile nennt. */
export function medienAbfrage(regeln: AbzugRegeln): string {
    const { tafel, schluessel, groesse, sha256 } = regeln.medien;
    return `SELECT ${bezeichner(schluessel)} AS pfad, ${bezeichner(groesse)}::bigint AS groesse, ${bezeichner(sha256)} AS sha256 FROM ${tafelBezeichner(tafel)} ORDER BY ${bezeichner(schluessel)}`;
}

/**
 * Der Plan für eine Quelle. Wirft mit allen Befunden, wenn die Regeln nicht zum Schema passen.
 */
export function baueAbzugPlan(katalog: Katalog, geladen: GeladeneRegeln, quelle: AbzugQuelle): AbzugPlan {
    const befunde = pruefeRegeln(katalog, geladen.regeln);
    if (befunde.length > 0) {
        const zeilen = befunde.slice(0, 20).map((befund) => `  - ${befund.text}`);
        const mehr = befunde.length > 20 ? `\n  … und ${String(befunde.length - 20)} weitere` : "";
        throw new Error(
            `Die Regeln des Abzugs passen nicht zum Schema (${String(befunde.length)} Befunde):\n${zeilen.join("\n")}${mehr}`,
        );
    }
    const mit = Object.entries(geladen.regeln.tafeln)
        .filter(([, regel]) => regel.art === "mitnehmen")
        .map(([voll]) => voll);
    const { folge, zyklen } = ladeFolge(
        mit,
        katalog.fremdschluessel.filter((fk) => mit.includes(fk.von) && mit.includes(fk.nach)),
    );
    const tafeln = folge.map((voll) =>
        planTafel(
            katalog.tafeln.get(voll)!,
            geladen.regeln.tafeln[voll]?.leeren ?? [],
            geladen.regeln.tafeln[voll]?.verdecken ?? [],
            geladen.regeln.tafeln[voll]?.ohneZeilen,
        ),
    );
    return {
        format: "avesmaps-abzug-plan",
        version: 1,
        quelle,
        regeln: { version: geladen.regeln.version, pruefsumme: geladen.pruefsumme },
        transaktion: "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
        abfragen: { migrationen: PLAN_ABFRAGE_MIGRATIONEN, kartendomaenen: PLAN_ABFRAGE_KARTENDOMAENEN },
        tafeln,
        medien: {
            tafel: geladen.regeln.medien.tafel,
            abfrage: medienAbfrage(geladen.regeln),
            verzeichnis: ABZUG_TAR_MEDIEN,
            wurzel: "MEDIA_ROOT",
            verzeichnisse: [...ABZUG_MEDIEN_VERZEICHNISSE],
        },
        zyklen,
    };
}

/**
 * Der Plan als psql-Skript für Claudios Export: eine lesende Transaktion, je Tafel ein `\copy … TO '<datei>' (FORMAT binary)`. Die Pfade
 * gelten relativ zum Arbeitsordner des Aufrufs (`psql` läuft im Verzeichnis, das später das Tar wird). `\copy` verlangt den ganzen Befehl in
 * EINER Zeile.
 */
export function psqlSkript(plan: AbzugPlan): string {
    const zeilen = [
        "\\set ON_ERROR_STOP on",
        `${plan.transaktion};`,
        ...plan.tafeln.map((tafel) => {
            const ziel = tafel.datei.replace(/'/gu, "''");
            return `\\copy (${tafel.abfrage}) TO '${ziel}' WITH (FORMAT binary)`;
        }),
        // Die Liste der Mediendateien aus DERSELBEN Transaktion wie die Zeilen: pfad, groesse, sha256 (laut Zeile), als CSV neben den Tafeln.
        `\\copy (${plan.medien.abfrage}) TO '${MEDIENLISTE_DATEI}' WITH (FORMAT csv)`,
        "COMMIT;",
        "",
    ];
    return zeilen.join("\n");
}

/** Der Anteil, den eine Phase des Exports am Fortschritt hat (für die Datenbankfunktion und ihren Test). */
export function phasenAnteile(): Record<string, number> {
    return Object.fromEntries(ABZUG_PHASEN.map((phase) => [phase.name, phase.progress]));
}
