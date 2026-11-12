// Das Testpaket für den vollständigen Release-Test eines Kandidaten (WI-0248 R2, WI-0228 D).
//
//   node scripts/dev/release-fixtures.ts --commit <sha40> [--aus <Datenwurzel>] [--neu]
//       [--tiles <Ordner>] [--media <Ordner>] [--ziel <Paketwurzel>] [--werkzeug <Klon>] [--env <Datei>]
//
// Ergebnis: `<Datenwurzel>\release-fixtures\<sha40>\` mit `daten.dump` (pg_dump -Fc der lokalen Entwicklungsdatenbank, Schema UND Daten,
// ohne die Daten der Anmelde- und Sitzungstabellen), `tiles\`, `media\` und, als LETZTE Datei, `manifest.json`. Der Runner
// (`release-runner.ts`) liest das Paket und kopiert es in seinen eigenen Ergebnisordner; hier wird nur gelesen und kopiert, die
// Entwicklungsdatenbank, die Kacheln und die Medien bleiben unverändert.
//
// Der Vertrag (Schema 2) steht im Kopf von `release-testpaket.ts`, das auch der Runner liest und einspielt: vollständiger Dump (Schema, Daten und
// das Migrationsjournal, kein `--data-only`, PostGIS-Eintrag drin; der Runner legt Erweiterungen selbst an und lässt `spatial_ref_sys` aus), und
// `quelle.migrationen` sind die Journal-Schlüssel (`schema_migration.version`, ohne `.sql`).
//
// 🔴 Die Verbindung zur Datenbank kommt aus `DATABASE_URL` (Umgebung, sonst die git-ignorierte `.env` des Hauptcheckouts). Sie wird nie
// ausgegeben, nie ins Paket und nie in eine Kommandozeile geschrieben: Die Kindprozesse bekommen sie als `PG*`-Umgebung, und jede Meldung
// wird vor der Ausgabe von Kennwort und Adresse gereinigt.
import { execFileSync, spawnSync } from "node:child_process";
import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    statfsSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrationenAusBaum } from "./release-testpaket.ts";
import { findePostgres } from "./wegwerf-db.ts";

export const PAKET_SCHEMA = 2;
export const STANDARD_DATEN = "C:/avesmaps3d-data";
export const STANDARD_ENV = "C:/GIT/avesmaps3D/.env";
/** Wie viele Pakete liegen bleiben (die jüngsten, mit dem eben gebauten). */
export const PAKETE_BEHALTEN = 3;

/**
 * Tabellen, deren DATEN nicht ins Paket kommen: Sie tragen Anmelde- und Sitzungsgeheimnisse (Sitzungs- und Einladungs-Token als Hash,
 * Passwort-Hashes, Passkey-Schlüssel, OAuth-Zustand, Einmal-Links, Drosselschlüssel). Das Schema bleibt, die Tabellen sind leer. Alle
 * Tabellen stehen in `apps/server/migrations/0079_auth.sql`; `release-fixtures.test.ts` schlägt fehl, wenn eine Migration eine neue
 * Tabelle im Schema `avesmaps_auth` anlegt, die in keiner der beiden Listen steht.
 */
export const GEHEIME_TABELLEN = [
    "avesmaps_auth.session",
    "avesmaps_auth.passkey_credential",
    "avesmaps_auth.password_login",
    "avesmaps_auth.oauth_flow",
    "avesmaps_auth.invitation",
    "avesmaps_auth.access_link",
    "avesmaps_auth.webauthn_challenge",
    "avesmaps_auth.login_throttle",
    // Hashes der Abzugs-Schlüssel (WI-0251, Migration 0220): trägt Schlüssel-Hashes, geht nie mit.
    "avesmaps_auth.abzug_schluessel",
    // Token-Links und API-Schlüssel der Kartendateien (WI-0280, Migration 0324): trägt ihre Hashes, mit denen der Server die Tickets unterschreibt; geht nie mit.
    // `karten_abruf` (public) zeigt seit 0324 ohne Fremdschlüssel darauf, das Einspielen findet also keine fehlende Zeile.
    "avesmaps_auth.karten_zugang",
    // Sonderrollen, die eine Einladung mitbringt (WI-0279, Migration 0303): trägt kein Geheimnis, hängt aber per Fremdschlüssel an `invitation`, deren Zeilen nie
    // mitgehen; mit Daten fände der Rückspielschritt keine Einladung dazu.
    "avesmaps_auth.invitation_sonderrolle",
] as const;

/** Tabellen im Schema `avesmaps_auth`, die keine Geheimnisse tragen und mitgehen (Personen, Rechte, Protokoll). */
export const UNGEHEIME_AUTH_TABELLEN = [
    "avesmaps_auth.person",
    "avesmaps_auth.person_access",
    "avesmaps_auth.capability_grant",
    "avesmaps_auth.discord_login",
    "avesmaps_auth.security_event",
    "avesmaps_auth.legacy_identity",
    // Vergebene Sonderrollen mit Person, Rolle, Region und Grund (WI-0279, Migration 0303): Rechte wie `capability_grant`, kein Geheimnis.
    "avesmaps_auth.sonderrolle_zuteilung",
] as const;

export interface PaketGroessen {
    readonly "daten.dump": number;
    readonly tiles: { readonly dateien: number; readonly bytes: number };
    readonly media: { readonly dateien: number; readonly bytes: number };
}

export interface PaketManifest {
    readonly schema: number;
    readonly erstellt: string;
    readonly commit: string;
    readonly quelle: { readonly migrationen: readonly string[] };
    readonly groessen: PaketGroessen;
}

/** `KEY=VALUE`-Zeilen einer `.env`, wie `start-martin.mjs` sie liest (Großbuchstaben, Ziffern, Unterstrich; Anführungszeichen entfernt). */
export function leseEnvDatei(inhalt: string): Record<string, string> {
    const werte: Record<string, string> = {};
    for (const zeile of inhalt.split(/\r?\n/)) {
        const treffer = /^([A-Z0-9_]+)=(.*)$/.exec(zeile.trim());
        const name = treffer?.[1];
        if (name === undefined || treffer?.[2] === undefined) continue;
        let wert = treffer[2];
        if (/^(".*"|'.*')$/.test(wert)) wert = wert.slice(1, -1);
        werte[name] = wert;
    }
    return werte;
}

/**
 * Die `PG*`-Umgebung für `pg_dump` und `psql` aus einer Verbindungsadresse. So steht das Kennwort in keiner Kommandozeile (die jeder lokale
 * Prozess sehen kann). Wirft, ohne die Adresse zu nennen, wenn sie nicht lesbar ist.
 */
export function pgUmgebung(adresse: string, basis: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    let url: URL;
    try {
        url = new URL(adresse);
    } catch {
        throw new Error("DATABASE_URL ist keine lesbare Verbindungsadresse");
    }
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
        throw new Error("DATABASE_URL ist keine PostgreSQL-Adresse");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const datenbank = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (host === "" || datenbank === "") throw new Error("DATABASE_URL nennt keinen Host oder keine Datenbank");
    const umgebung: NodeJS.ProcessEnv = { ...basis };
    for (const name of Object.keys(umgebung)) if (/^(PG[A-Z]+|DATABASE_URL)$/.test(name)) delete umgebung[name];
    umgebung["PGHOST"] = host;
    umgebung["PGPORT"] = url.port === "" ? "5432" : url.port;
    umgebung["PGDATABASE"] = datenbank;
    if (url.username !== "") umgebung["PGUSER"] = decodeURIComponent(url.username);
    if (url.password !== "") umgebung["PGPASSWORD"] = decodeURIComponent(url.password);
    const ssl = url.searchParams.get("sslmode");
    if (ssl !== null && /^[a-z-]+$/.test(ssl)) umgebung["PGSSLMODE"] = ssl;
    return umgebung;
}

/** Entfernt Adresse und Kennwort aus einem Text, bevor er ausgegeben wird. */
export function reinige(text: string, adresse: string): string {
    let sauber = text;
    const geheim = [adresse];
    try {
        const url = new URL(adresse);
        if (url.password !== "") geheim.push(url.password, decodeURIComponent(url.password));
    } catch {
        /* Eine unlesbare Adresse hat keine Teile zum Schwärzen. */
    }
    for (const g of geheim) if (g !== "") sauber = sauber.split(g).join("***");
    return sauber;
}

/** Die Migrationen, die die Quelle kennt und der Kandidat nicht (Dateinamen). Leer: Der Kandidat kennt alles. */
export function fehlendeMigrationen(quelle: readonly string[], kandidat: readonly string[]): string[] {
    const bekannt = new Set(kandidat);
    return quelle.filter((name) => !bekannt.has(name));
}

/** Ein Paket mit dem Zeitpunkt, an dem es entstand, für die Aufräumregel. */
export interface PaketEintrag {
    readonly name: string;
    readonly erstellt: number;
}

/** Welche Pakete wegfallen: alle bis auf die jüngsten `behalten`; `neu` zählt immer zu den behaltenen. */
export function zuLoeschendePakete(pakete: readonly PaketEintrag[], behalten: number, neu?: string): string[] {
    const jung = [...pakete].sort((a, b) => b.erstellt - a.erstellt || (a.name < b.name ? 1 : -1));
    const bleiben = new Set(neu === undefined ? [] : [neu]);
    for (const p of jung) if (bleiben.size < behalten) bleiben.add(p.name);
    return jung.filter((p) => !bleiben.has(p.name)).map((p) => p.name);
}

/** Das Manifest eines Pakets, wenn die Datei lesbar ist und ein `schema` als Zahl trägt; sonst `undefined`. */
export function leseManifest(ordner: string): PaketManifest | undefined {
    try {
        const roh: unknown = JSON.parse(readFileSync(join(ordner, "manifest.json"), "utf8"));
        if (typeof roh !== "object" || roh === null) return undefined;
        const m = roh as { schema?: unknown };
        return typeof m.schema === "number" ? (roh as PaketManifest) : undefined;
    } catch {
        return undefined;
    }
}

/** Ein vollständiges Paket für genau diesen Commit: Manifest (zuletzt geschrieben) passt und alle drei Teile sind da. */
export function istPaketFuer(ordner: string, sha: string): boolean {
    const m = leseManifest(ordner);
    return (
        m?.schema === PAKET_SCHEMA &&
        m.commit === sha &&
        existsSync(join(ordner, "daten.dump")) &&
        existsSync(join(ordner, "tiles")) &&
        existsSync(join(ordner, "media"))
    );
}

/** Zählt Dateien und Bytes eines Ordners und wirft bei einem Verweis (Symlink, Junction): Der Runner lehnt sie ab. */
export function messeOrdner(ordner: string): { dateien: number; bytes: number } {
    let dateien = 0;
    let bytes = 0;
    const lauf = (pfad: string): void => {
        const s = lstatSync(pfad);
        if (s.isSymbolicLink()) throw new Error(`Verweis im Testpaket-Quellordner nicht zulässig: ${pfad}`);
        if (s.isDirectory()) {
            for (const name of readdirSync(pfad)) lauf(join(pfad, name));
        } else if (s.isFile()) {
            dateien += 1;
            bytes += s.size;
        }
    };
    lauf(ordner);
    return { dateien, bytes };
}

export interface FixtureOptionen {
    readonly commit: string;
    /** Die Datenwurzel; daraus: `tiles\aventuria`, `media`, `release-fixtures`. */
    readonly daten: string;
    readonly tiles: string;
    readonly media: string;
    /** Wo die Pakete liegen (je SHA ein Ordner). */
    readonly ziel: string;
    /** Der Werkzeugklon: kennt die Migrationen des Kandidaten. */
    readonly werkzeug: string;
    readonly envDatei: string;
    /** Die Umgebung, aus der `DATABASE_URL` und der Suchpfad kommen; Vorgabe `process.env` (nur Tests setzen sie). */
    readonly umgebung?: NodeJS.ProcessEnv;
    /** Ein vorhandenes, vollständiges Paket ersetzen. */
    readonly neu: boolean;
    readonly protokoll: (zeile: string) => void;
}

export function standardOptionen(
    argv: readonly string[],
    protokoll: (zeile: string) => void,
    env: NodeJS.ProcessEnv = process.env,
): FixtureOptionen {
    const wert = (name: string): string | undefined => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const commit = wert("--commit") ?? "";
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("--commit benötigt eine vollständige SHA (40 Hexziffern)");
    const daten = resolve(wert("--aus") ?? env["AVESMAPS_DATEN"] ?? STANDARD_DATEN);
    return {
        commit,
        daten,
        tiles: resolve(wert("--tiles") ?? join(daten, "tiles", "aventuria")),
        media: resolve(wert("--media") ?? join(daten, "media")),
        ziel: resolve(wert("--ziel") ?? join(daten, "release-fixtures")),
        werkzeug: resolve(wert("--werkzeug") ?? fileURLToPath(new URL("../../", import.meta.url))),
        envDatei: resolve(wert("--env") ?? env["AVESMAPS_ENV_DATEI"] ?? STANDARD_ENV),
        neu: argv.includes("--neu"),
        protokoll,
    };
}

/** `DATABASE_URL` aus der Umgebung, sonst aus der `.env`; wirft ohne Wert und ohne Pfad zu verraten, was darin steht. */
export function datenbankAdresse(envDatei: string, env: NodeJS.ProcessEnv = process.env): string {
    const ausUmgebung = env["DATABASE_URL"];
    if (ausUmgebung !== undefined && ausUmgebung !== "") return ausUmgebung;
    if (existsSync(envDatei)) {
        const wert = leseEnvDatei(readFileSync(envDatei, "utf8"))["DATABASE_URL"];
        if (wert !== undefined && wert !== "") return wert;
    }
    throw new Error("DATABASE_URL fehlt (weder in der Umgebung noch in der .env des Hauptcheckouts)");
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Baut das Paket und gibt dessen Ordner zurück. Ein vollständiges Paket für denselben Commit bleibt (ohne `neu`) unberührt. */
export function baueTestpaket(o: FixtureOptionen): string {
    const beginn = Date.now();
    const schritt = (text: string): void =>
        o.protokoll(`[+${String(Math.round((Date.now() - beginn) / 1000))} s] ${text}`);
    const fertig = join(o.ziel, o.commit);
    if (!o.neu && istPaketFuer(fertig, o.commit)) {
        schritt(`Testpaket für ${o.commit} liegt schon vollständig vor; unverändert.`);
        return fertig;
    }
    const bin = findePostgres();
    if (bin === undefined) throw new Error("PostgreSQL-Programme (pg_dump, psql) nicht gefunden");
    const exe = process.platform === "win32" ? ".exe" : "";
    const umgebung = o.umgebung ?? process.env;
    const adresse = datenbankAdresse(o.envDatei, umgebung);
    const pgEnv = pgUmgebung(adresse, umgebung);
    const psql = (sql: string): string => {
        const lauf = spawnSync(join(bin, `psql${exe}`), ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
            env: pgEnv,
            encoding: "utf8",
            timeout: 120_000,
            windowsHide: true,
        });
        if (lauf.status !== 0)
            throw new Error(
                `psql scheiterte: ${reinige(`${lauf.stderr}${lauf.error?.message ?? ""}`, adresse)
                    .trim()
                    .split(/\r?\n/)
                    .slice(-3)
                    .join(" | ")}`,
            );
        return lauf.stdout.trim();
    };

    // 1. Vorab prüfen, ehe etwas Teures entsteht: kennt der Kandidat jede Migration, die die Quelle schon eingespielt hat?
    const quelle = psql("SELECT version FROM schema_migration ORDER BY version")
        .split(/\r?\n/)
        .filter((z) => z !== "");
    let baum: string;
    try {
        baum = execFileSync("git", ["-C", o.werkzeug, "ls-tree", "--name-only", o.commit, "apps/server/migrations/"], {
            encoding: "utf8",
            timeout: 60_000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch {
        throw new Error(`Der Kandidat ${o.commit} ist im Werkzeugklon unbekannt (git fetch fehlt?)`);
    }
    const kandidat = migrationenAusBaum(baum);
    const fehlend = fehlendeMigrationen(quelle, kandidat);
    if (fehlend.length > 0)
        throw new Error(
            `Die Quelldatenbank hat ${String(fehlend.length)} Migration(en), die der Kandidat nicht kennt (${fehlend.slice(0, 3).join(", ")}${fehlend.length > 3 ? ", …" : ""}); kein Testpaket`,
        );
    schritt(
        `Migrationen der Quelle (${String(quelle.length)}) sind dem Kandidaten bekannt (${String(kandidat.length)}).`,
    );

    // 2. Quellen messen (und Verweise ablehnen), Platz prüfen.
    for (const [name, pfad] of [
        ["tiles", o.tiles],
        ["media", o.media],
    ] as const)
        if (!existsSync(pfad) || !statSync(pfad).isDirectory()) throw new Error(`Quellordner ${name} fehlt: ${pfad}`);
    const tiles = messeOrdner(o.tiles);
    const media = messeOrdner(o.media);
    const dbBytes = Number(psql("SELECT pg_database_size(current_database())"));
    mkdirSync(o.ziel, { recursive: true });
    const frei = statfsSync(o.ziel);
    const verfuegbar = frei.bavail * frei.bsize;
    const bedarf = tiles.bytes + media.bytes + dbBytes + 2 * GIB;
    schritt(
        `Quellen: Datenbank ${String(Math.round(dbBytes / MIB))} MiB, Kacheln ${String(tiles.dateien)} Dateien ${String(Math.round(tiles.bytes / MIB))} MiB, Medien ${String(media.dateien)} Dateien ${String(Math.round(media.bytes / MIB))} MiB; frei ${String(Math.round(verfuegbar / MIB))} MiB.`,
    );
    if (verfuegbar < bedarf)
        throw new Error(
            `Zu wenig freier Platz für das Testpaket: ${String(Math.round(verfuegbar / MIB))} MiB frei, mindestens ${String(Math.round(bedarf / MIB))} MiB nötig`,
        );

    // 3. Bauen in einen Nebenordner; erst das fertige Paket bekommt seinen Namen (das Manifest zuletzt).
    aufraeumenReste(o.ziel);
    const bau = join(o.ziel, `.bau-${o.commit.slice(0, 12)}-${String(process.pid)}`);
    rmSync(bau, { recursive: true, force: true });
    mkdirSync(bau, { recursive: true });
    writeFileSync(join(bau, ".release-fixtures-bau"), `${new Date().toISOString()}\n`);
    try {
        const dump = join(bau, "daten.dump");
        const ausschluss = GEHEIME_TABELLEN.map((t) => `--exclude-table-data=${t}`);
        const lauf = spawnSync(
            join(bin, `pg_dump${exe}`),
            ["--format=custom", "--no-owner", "--no-privileges", ...ausschluss, `--file=${dump}`],
            { env: pgEnv, encoding: "utf8", timeout: 20 * 60_000, windowsHide: true, maxBuffer: 16 * MIB },
        );
        if (lauf.status !== 0)
            throw new Error(
                `pg_dump scheiterte: ${reinige(`${lauf.stderr}${lauf.error?.message ?? ""}`, adresse)
                    .trim()
                    .split(/\r?\n/)
                    .slice(-4)
                    .join(" | ")}`,
            );
        const dumpBytes = statSync(dump).size;
        schritt(`daten.dump geschrieben (${String(Math.round(dumpBytes / MIB))} MiB).`);
        cpSync(o.tiles, join(bau, "tiles"), { recursive: true, errorOnExist: true, force: false });
        schritt("tiles kopiert.");
        cpSync(o.media, join(bau, "media"), { recursive: true, errorOnExist: true, force: false });
        schritt("media kopiert.");
        const manifest: PaketManifest = {
            schema: PAKET_SCHEMA,
            erstellt: new Date().toISOString(),
            commit: o.commit,
            quelle: { migrationen: quelle },
            groessen: { "daten.dump": dumpBytes, tiles, media },
        };
        writeFileSync(join(bau, "manifest.json.tmp"), `${JSON.stringify(manifest, null, 2)}\n`);
        renameSync(join(bau, "manifest.json.tmp"), join(bau, "manifest.json"));
        rmSync(join(bau, ".release-fixtures-bau"), { force: true });
        if (existsSync(fertig)) {
            // Nur ein erkennbares Paket wird ersetzt, nie ein fremder Ordner.
            if (leseManifest(fertig) === undefined) throw new Error(`${fertig} existiert und ist kein Testpaket`);
            rmSync(fertig, { recursive: true, force: true });
        }
        renameSync(bau, fertig);
    } catch (fehler) {
        rmSync(bau, { recursive: true, force: true });
        throw fehler;
    }
    schritt(`Testpaket ${fertig} fertig.`);

    // 4. Nur die jüngsten Pakete behalten.
    const pakete: PaketEintrag[] = [];
    for (const name of readdirSync(o.ziel)) {
        if (!/^[0-9a-f]{40}$/.test(name)) continue;
        const ordner = join(o.ziel, name);
        const m = leseManifest(ordner);
        if (m === undefined || !statSync(ordner).isDirectory()) continue;
        const erstellt = Date.parse(m.erstellt);
        pakete.push({ name, erstellt: Number.isFinite(erstellt) ? erstellt : statSync(ordner).mtimeMs });
    }
    for (const name of zuLoeschendePakete(pakete, PAKETE_BEHALTEN, o.commit)) {
        rmSync(join(o.ziel, name), { recursive: true, force: true });
        schritt(`Älteres Testpaket ${name} entfernt.`);
    }
    return fertig;
}

/** Reste eines abgebrochenen Baus (Nebenordner mit unserer Markierung, älter als 12 Stunden). Fremdes bleibt. */
function aufraeumenReste(ziel: string): void {
    if (!existsSync(ziel)) return;
    for (const name of readdirSync(ziel)) {
        if (!name.startsWith(".bau-")) continue;
        const ordner = join(ziel, name);
        const marke = join(ordner, ".release-fixtures-bau");
        if (existsSync(marke) && Date.now() - statSync(marke).mtimeMs > 12 * 3600_000)
            rmSync(ordner, { recursive: true, force: true });
    }
}

function istHauptprogramm(): boolean {
    const datei = process.argv[1];
    return datei !== undefined && pathToFileURL(resolve(datei)).href === import.meta.url;
}

if (istHauptprogramm()) {
    const ausgabe = (zeile: string): void => {
        process.stdout.write(`${zeile}\n`);
    };
    try {
        const o = standardOptionen(process.argv.slice(2), ausgabe);
        baueTestpaket(o);
    } catch (fehler) {
        process.stderr.write(`Fehler: ${fehler instanceof Error ? fehler.message : "Testpaket fehlgeschlagen"}\n`);
        process.exitCode = 1;
    }
}
