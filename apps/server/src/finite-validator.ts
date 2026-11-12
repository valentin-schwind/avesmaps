import ajvCompiler from "@fastify/ajv-compiler";
import type { FastifyServerOptions } from "fastify";

/**
 * G4-02 (Sicherheitsprüfung 2026-10-16): Fastifys Ajv wandelt mit `coerceTypes: "array"` die Zeichenketten "Infinity",
 * "-Infinity" und "1e400" in ±Infinity um, und diese bestehen jede Zahlengrenze, auch `integer` mit minimum/maximum
 * (`limit=Infinity` ergab 503 statt 400, ein Kurzlink wurde kaputt gespeichert). JSON-Körper tragen dasselbe als `1e400`.
 *
 * 🔴 Zentral statt je Route: Der Prüfer von Fastify wird umhüllt und sucht nach dem Ajv-Lauf in den (bereits umgewandelten)
 * Daten nach nicht endlichen Zahlen. So entsteht derselbe `FST_ERR_VALIDATION`-Fehler, den der Fehlerhandler (ADR-0018)
 * in den Umschlag übersetzt. `coerceTypes` bleibt an: "5" in der Query muss weiter gehen.
 */

/**
 * Rohkörper eigener Parser (Buffer, ArrayBuffer, Streams) werden nicht durchlaufen: Ein Upload ginge sonst Byte für Byte durch,
 * und ein Stream mit Rückverweisen endete nie. Querystrings kommen als Objekt ohne `Object.prototype` (fast-querystring), JSON als
 * schlichtes Objekt; beide werden durchlaufen.
 */
function durchlaufbar(value: object): boolean {
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
    return typeof (value as { pipe?: unknown }).pipe !== "function";
}

/** Pfad der ersten nicht endlichen Zahl, sonst `undefined`. Schleifenfrei, damit tief verschachtelte Körper keinen Stapel sprengen. */
export function firstNonFinite(data: unknown): string | undefined {
    const stack: { value: unknown; path: string }[] = [{ value: data, path: "" }];
    const gesehen = new WeakSet<object>();
    while (stack.length > 0) {
        const { value, path } = stack.pop() as { value: unknown; path: string };
        if (typeof value === "number") {
            if (!Number.isFinite(value)) return path;
        } else if (value !== null && typeof value === "object" && !gesehen.has(value) && durchlaufbar(value)) {
            gesehen.add(value);
            for (const [key, child] of Object.entries(value)) {
                stack.push({ value: child, path: `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}` });
            }
        }
    }
    return undefined;
}

type Factory = NonNullable<
    NonNullable<NonNullable<FastifyServerOptions["schemaController"]>["compilersFactory"]>["buildValidator"]
>;

export function finiteValidatorFactory(): Factory {
    const base = ajvCompiler() as unknown as (...args: unknown[]) => (...args: unknown[]) => unknown;
    const factory = (externalSchemas: unknown, options: unknown) => {
        const compile = base(externalSchemas, options);
        return (routeSchema: unknown) => {
            const validate = compile(routeSchema) as ((data: unknown) => unknown) & { errors?: unknown };
            const wrapped = (data: unknown): unknown => {
                const result = validate(data);
                wrapped.errors = validate.errors;
                // Nur der Fall `true` (Ajv hat angenommen und umgewandelt); alles andere ist schon eine Absage.
                if (result !== true) return result;
                const path = firstNonFinite(data);
                if (path === undefined) return true;
                wrapped.errors = [
                    {
                        instancePath: path,
                        schemaPath: "#/finite",
                        keyword: "finite",
                        params: {},
                        message: "must be a finite number",
                    },
                ];
                return false;
            };
            wrapped.errors = undefined as unknown;
            return wrapped;
        };
    };
    return factory as unknown as Factory;
}
