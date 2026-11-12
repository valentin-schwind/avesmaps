/**
 * Die mechanisch prüfbaren Teile der Regel „erst erweitern, dann umstellen, dann entfernen“ (WI-0075, AGENTS.md,
 * Abschnitt „Migrationen: erst erweitern, dann umstellen, dann entfernen“).
 *
 * Läuft kurz alter und neuer Servercode nebeneinander (Blue/Green), oder muss der Rückweg gegen das neue Schema laufen,
 * darf eine Migration dem alten Code nichts wegnehmen. Dieser Leser findet in einer Migration, was das tut. Er ist ein
 * Leser, kein SQL-Parser: Er trennt Anweisungen, blendet Kommentare, Zeichenketten und `$$`-Rümpfe aus und prüft die
 * übrigen Anweisungen mit Mustern. Was er nicht sieht (etwa ein `DROP COLUMN` in `EXECUTE 'text'` oder in einem
 * `DO`-Block), steht in der Regel in AGENTS.md und bleibt Sache des Reviews.
 */

export type RuleId =
    | "drop-column"
    | "drop-object"
    | "rename"
    | "set-not-null"
    | "add-not-null-without-default"
    | "add-check"
    | "function-signature"
    | "view-calls-new-function";

export interface Finding {
    rule: RuleId;
    /** Die Anweisung, gekürzt, damit ein roter Test zeigt, welche gemeint ist. */
    detail: string;
}

export interface MigrationFile {
    /** Dateiname ohne `.sql`, etwa `0063_terrain_dem_format`. */
    name: string;
    sql: string;
}

/**
 * Zerlegt SQL in Anweisungen: ohne Kommentare, die Leerräume zusammengezogen, klein geschrieben. Beachtet `--`,
 * verschachtelte Blockkommentare, `'…'` (mit `''`), `"…"` und `$tag$…$tag$`. Zeichenketten und Rümpfe werden durch `''`
 * beziehungsweise `$$$$` ersetzt: Ihr Inhalt ist Text, nicht DDL der Migration.
 */
export function statementsOf(sql: string): string[] {
    const statements: string[] = [];
    let current = "";
    const flush = (): void => {
        const statement = current.replace(/\s+/g, " ").trim().toLowerCase();
        if (statement !== "") statements.push(statement);
        current = "";
    };
    let index = 0;
    while (index < sql.length) {
        const char = sql[index] as string;
        const next = sql[index + 1];
        if (char === "-" && next === "-") {
            const end = sql.indexOf("\n", index);
            index = end === -1 ? sql.length : end;
        } else if (char === "/" && next === "*") {
            let depth = 1;
            index += 2;
            while (index < sql.length && depth > 0) {
                if (sql[index] === "/" && sql[index + 1] === "*") {
                    depth += 1;
                    index += 2;
                } else if (sql[index] === "*" && sql[index + 1] === "/") {
                    depth -= 1;
                    index += 2;
                } else {
                    index += 1;
                }
            }
            current += " ";
        } else if (char === "'") {
            index += 1;
            while (index < sql.length) {
                if (sql[index] === "'" && sql[index + 1] === "'") index += 2;
                else if (sql[index] === "'") break;
                else index += 1;
            }
            index += 1;
            current += "''";
        } else if (char === '"') {
            const end = sql.indexOf('"', index + 1);
            const stop = end === -1 ? sql.length : end + 1;
            current += sql.slice(index, stop);
            index = stop;
        } else if (char === "$") {
            const tag = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(index, index + 64));
            if (tag) {
                const close = sql.indexOf(tag[0], index + tag[0].length);
                index = close === -1 ? sql.length : close + tag[0].length;
                current += "$$$$";
            } else {
                current += char;
                index += 1;
            }
        } else if (char === ";") {
            flush();
            index += 1;
        } else {
            current += char;
            index += 1;
        }
    }
    flush();
    return statements;
}

const NAME = String.raw`(?:"[^"]+"|[a-z_][a-z0-9_$]*)(?:\.(?:"[^"]+"|[a-z_][a-z0-9_$]*))?`;

/** Der Name ohne Schema und Anführungszeichen. */
function bare(name: string): string {
    return (name.split(".").pop() as string).replace(/^"|"$/g, "");
}

function shorten(statement: string): string {
    return statement.length > 110 ? `${statement.slice(0, 107)}...` : statement;
}

/** Teilt an Kommas außerhalb von Klammern. */
function splitTopLevel(text: string): string[] {
    const parts: string[] = [];
    let part = "";
    let depth = 0;
    for (const char of text) {
        if (char === "(") depth += 1;
        if (char === ")") depth -= 1;
        if (char === "," && depth === 0) {
            parts.push(part);
            part = "";
        } else {
            part += char;
        }
    }
    parts.push(part);
    return parts;
}

/** Die Argumentliste ab `from`, ohne Vorgabewerte, als Vergleichsschlüssel. */
function argumentKey(statement: string, from: number): string {
    const open = statement.indexOf("(", from);
    if (open === -1) return "";
    let depth = 0;
    let end = open;
    for (; end < statement.length; end += 1) {
        if (statement[end] === "(") depth += 1;
        else if (statement[end] === ")") {
            depth -= 1;
            if (depth === 0) break;
        }
    }
    return splitTopLevel(statement.slice(open + 1, end))
        .map((entry) =>
            entry
                .replace(/\s+default\s.*$/, "")
                .replace(/\s*=\s.*$/, "")
                .trim(),
        )
        .filter((entry) => entry !== "")
        .join(", ");
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Was frühere Migrationen angelegt haben; `findFindings` schreibt es mit jeder Migration fort. */
export interface Known {
    /** Tabellen, die frühere Migrationen angelegt haben. */
    tables: Set<string>;
    /** Sichten, die frühere Migrationen angelegt haben. */
    views: Set<string>;
    /** Funktionsname -> bekannte Argumentlisten. */
    functions: Map<string, Set<string>>;
}

export function emptyKnown(): Known {
    return { tables: new Set(), views: new Set(), functions: new Map() };
}

/**
 * Was diese Migration dem alten Code wegnimmt. `known` ist, was die früheren Migrationen angelegt haben, und wird mit
 * dem Inhalt dieser fortgeschrieben: Aufrufer reichen es von Datei zu Datei in der Reihenfolge der Nummern weiter.
 */
export function findFindings(sql: string, known: Known): Finding[] {
    const findings: Finding[] = [];
    const tablesBefore = new Set(known.tables);
    const viewsBefore = new Set(known.views);
    /** Funktionen, die diese Migration NEU anlegt: Ihr EXECUTE vergibt erst `db-grants`. */
    const newFunctions = new Set<string>();

    for (const statement of statementsOf(sql)) {
        const add = (rule: RuleId): void => void findings.push({ rule, detail: shorten(statement) });

        if (/^alter\b/.test(statement) && /\brename\b/.test(statement)) add("rename");

        const alter = new RegExp(String.raw`^alter table (?:if exists )?(?:only )?(${NAME})\b(.*)$`).exec(statement);
        if (alter) {
            const table = bare(alter[1] as string);
            const clauses = splitTopLevel(alter[2] as string).map((clause) => clause.trim());
            for (const clause of clauses) {
                // `DROP COLUMN x` und die Kurzform `DROP x`; `DROP CONSTRAINT` und die Spaltenform `ALTER COLUMN x DROP …` nicht.
                if (/^drop column\b/.test(clause) || /^drop (?!constraint\b|column\b)/.test(clause)) add("drop-column");
                if (/^alter (?:column )?\S+ set not null\b/.test(clause)) add("set-not-null");
                const column = /^add (?:column )?(?:if not exists )?(\S+) (.*)$/.exec(clause);
                if (column && !/^(?:constraint|check|unique|primary|foreign|exclude)\b/.test(column[1] as string)) {
                    const definition = column[2] as string;
                    if (
                        /\bnot null\b/.test(definition) &&
                        !/\b(?:default|generated|serial|bigserial|smallserial)\b/.test(definition)
                    ) {
                        add("add-not-null-without-default");
                    }
                }
                if (tablesBefore.has(table) && /^add (?:constraint \S+ )?check\b/.test(clause)) add("add-check");
            }
            continue;
        }

        const dropObject = /^drop (table|view|materialized view)\b/.exec(statement);
        if (dropObject) {
            add("drop-object");
            continue;
        }

        const dropFunction = new RegExp(String.raw`^drop function (?:if exists )?(${NAME})`).exec(statement);
        if (dropFunction) {
            add("function-signature");
            known.functions
                .get(bare(dropFunction[1] as string))
                ?.delete(argumentKey(statement, dropFunction[0].length));
            continue;
        }

        const createTable = new RegExp(String.raw`^create (?:unlogged )?table (?:if not exists )?(${NAME})`).exec(
            statement,
        );
        if (createTable) {
            known.tables.add(bare(createTable[1] as string));
            continue;
        }

        const createFunction = new RegExp(String.raw`^create (?:or replace )?function (${NAME})`).exec(statement);
        if (createFunction) {
            const name = bare(createFunction[1] as string);
            const key = argumentKey(statement, createFunction[0].length);
            const signatures = known.functions.get(name) ?? new Set<string>();
            // Dieselbe Argumentliste ersetzt die Funktion (die Rechte bleiben); jede andere ist eine zweite Funktion.
            if (signatures.size > 0 && !signatures.has(key)) add("function-signature");
            if (!signatures.has(key)) newFunctions.add(name);
            signatures.add(key);
            known.functions.set(name, signatures);
            continue;
        }

        const createView = new RegExp(
            String.raw`^create (?:or replace )?(?:temp(?:orary)? )?(?:recursive )?view (${NAME})\b(.*)$`,
        ).exec(statement);
        if (createView) {
            const view = bare(createView[1] as string);
            // Eine NEUE Sicht liest noch kein altes Release; eine bestehende, die eine neue Funktion aufruft, antwortet
            // bis zu deren EXECUTE-Recht mit einem Fehler (WI-0075, der Fall von Migration 0067).
            if (viewsBefore.has(view)) {
                for (const name of newFunctions) {
                    if (
                        new RegExp(String.raw`(?<![\w.])(?:[a-z_][a-z0-9_]*\.)?${escapeRegExp(name)}\s*\(`).test(
                            createView[2] as string,
                        )
                    ) {
                        findings.push({ rule: "view-calls-new-function", detail: `${view} ruft ${name}() auf` });
                    }
                }
            }
            known.views.add(view);
        }
    }
    return findings;
}

/** Alle Migrationen in der Reihenfolge ihrer Nummern, mit ihren Befunden. */
export function findAll(files: readonly MigrationFile[]): { name: string; findings: Finding[] }[] {
    const known = emptyKnown();
    return [...files]
        .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
        .map((file) => ({ name: file.name, findings: findFindings(file.sql, known) }));
}
