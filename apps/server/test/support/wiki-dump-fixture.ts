import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Ein kleiner MediaWiki-Export für die Tests des Wiki-Dumps (WI-0253 B-1): im Aufbau des echten Exports (`<siteinfo>` mit Namensräumen,
 * `<page>` mit `<title>`, `<ns>`, `<id>`, `<redirect/>`, `<revision>`), mit erfundenen Seiten. Kein Abruf, nichts aus dem echten Dump.
 */

export interface FixtureSeite {
    titel: string;
    ns: number;
    id?: number;
    weiterleitung?: string;
    text?: string;
    zeit?: string;
}

const KOPF = `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="de">
  <siteinfo>
    <sitename>Testwiki</sitename>
    <dbname>testwiki</dbname>
    <base>https://wiki.invalid/wiki/Hauptseite</base>
    <generator>MediaWiki 1.43</generator>
    <case>first-letter</case>
    <namespaces>
      <namespace key="0" case="first-letter" />
      <namespace key="14" case="first-letter">Kategorie</namespace>
      <namespace key="218" case="first-letter">DSK</namespace>
      <namespace key="222" case="first-letter">Inoffiziell</namespace>
    </namespaces>
  </siteinfo>
`;

export function escape(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function baueSeite(seite: FixtureSeite, index: number): string {
    const redirect =
        seite.weiterleitung === undefined ? "" : `    <redirect title="${escape(seite.weiterleitung)}" />\n`;
    const text = seite.weiterleitung === undefined ? (seite.text ?? "") : `#WEITERLEITUNG [[${seite.weiterleitung}]]`;
    return `  <page>
    <title>${escape(seite.titel)}</title>
    <ns>${String(seite.ns)}</ns>
    <id>${String(seite.id ?? 1000 + index)}</id>
${redirect}    <revision>
      <id>${String(5000 + index)}</id>
      <timestamp>${seite.zeit ?? "2026-09-30T12:00:00Z"}</timestamp>
      <contributor><username>Tester</username><id>7</id></contributor>
      <model>wikitext</model>
      <format>text/x-wiki</format>
      <text bytes="${String(Buffer.byteLength(text))}" xml:space="preserve">${escape(text)}</text>
      <sha1>abc</sha1>
    </revision>
  </page>
`;
}

/** Der ganze Export; `abgeschnitten` lässt `</mediawiki>` und die zweite Hälfte der letzten Seite weg. */
export function baueDump(seiten: readonly FixtureSeite[], optionen: { abgeschnitten?: boolean } = {}): string {
    const rumpf = seiten.map(baueSeite).join("");
    if (optionen.abgeschnitten === true) return `${KOPF}${rumpf.slice(0, Math.max(0, rumpf.length - 60))}`;
    return `${KOPF}${rumpf}</mediawiki>\n`;
}

/** Wo `bzip2` zu finden ist: Vorgabe im Suchpfad, sonst das von Git für Windows. `null`: nicht da, dann überspringen die Tests den Fall. */
export function findeBzip2(): string | null {
    const kandidaten = [process.env["WIKI_BZIP2_PFAD"], "bzip2", "C:/Program Files/Git/usr/bin/bzip2.exe"];
    for (const kandidat of kandidaten) {
        if (kandidat === undefined || kandidat === "") continue;
        if (kandidat.includes("/") && !existsSync(kandidat)) continue;
        const lauf = spawnSync(kandidat, ["--help"], { encoding: "utf8", windowsHide: true });
        if (lauf.error === undefined) return kandidat;
    }
    return null;
}

/** Packt eine Datei mit `bzip2 -c` (Quelle bleibt stehen). */
export async function packeBz2(bzip2: string, quelle: string, ziel: string): Promise<void> {
    const lauf = spawnSync(bzip2, ["-c", "--", quelle], { maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    if (lauf.status !== 0) throw new Error("bzip2 konnte die Fixture nicht packen");
    await writeFile(ziel, lauf.stdout);
}

// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// dump_categorylinks.sql.gz (WI-0294)
// ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Eine Zeile der Tabelle `categorylinks`, wie der Test sie vorgibt. `nach` mit Unterstrichen; ohne Sortierschlüssel gilt der Name in Großbuchstaben (Sortierung `uppercase`). */
export interface FixtureKategorienZeile {
    von: number;
    nach: string;
    art?: "page" | "subcat" | "file";
    sortierschluessel?: string;
}

/** Ein Text als MySQL-Zeichenfolge in einfachen Anführungszeichen, wie `mysqldump` ihn schreibt (`\\`, `\'`, `\n`, `\r`, `\0`, Strg-Z). */
export function maskiereSql(text: string): string {
    const maskiert = text
        .replaceAll("\\", "\\\\")
        .replaceAll("'", "\\'")
        .replaceAll("\n", "\\n")
        .replaceAll("\r", "\\r")
        .replaceAll("\0", "\\0")
        .replaceAll("\x1a", "\\Z");
    return `'${maskiert}'`;
}

const KOPF_KATEGORIEN_SQL = `/*M!999999\\- enable the sandbox mode */
-- MariaDB dump 10.19  Distrib 10.11.14-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: localhost    Database: testwiki
-- ------------------------------------------------------

/*!40101 SET NAMES binary */;
/*!40103 SET TIME_ZONE='+00:00' */;

DROP TABLE IF EXISTS \`categorylinks\`;
CREATE TABLE \`categorylinks\` (
  \`cl_from\` int(10) unsigned NOT NULL DEFAULT 0,
  \`cl_to\` varbinary(255) NOT NULL DEFAULT '',
  \`cl_sortkey\` varbinary(230) NOT NULL DEFAULT '',
  \`cl_timestamp\` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  \`cl_sortkey_prefix\` varbinary(255) NOT NULL DEFAULT '',
  \`cl_collation\` varbinary(32) NOT NULL DEFAULT '',
  \`cl_type\` enum('page','subcat','file') NOT NULL DEFAULT 'page',
  PRIMARY KEY (\`cl_from\`,\`cl_to\`),
  KEY \`cl_timestamp\` (\`cl_to\`,\`cl_timestamp\`),
  KEY \`cl_sortkey\` (\`cl_to\`,\`cl_type\`,\`cl_sortkey\`,\`cl_from\`)
) ENGINE=InnoDB DEFAULT CHARSET=binary;

LOCK TABLES \`categorylinks\` WRITE;
`;

/**
 * Der Text einer Datei `dump_categorylinks.sql` im Aufbau des echten Auszugs (MariaDB 10.11, Spalten `cl_from` bis `cl_type`). `ohneEnde` lässt die Endzeile weg (eine abgeschnittene Datei),
 * `eineZeile` schreibt alle Tupel in eine Zeile, `ohneZeilen` lässt die INSERT-Anweisung ganz weg, `spaltenOhneType` baut das Schema um (eine andere Fassung des Wikis).
 */
export function baueKategorienSql(
    zeilen: readonly FixtureKategorienZeile[],
    optionen: { ohneEnde?: boolean; eineZeile?: boolean; stand?: string; spaltenOhneType?: boolean } = {},
): string {
    const tupel = zeilen.map((zeile) => {
        const schluessel = zeile.sortierschluessel ?? zeile.nach.replaceAll("_", " ").toUpperCase();
        return `(${String(zeile.von)},${maskiereSql(zeile.nach)},${maskiereSql(schluessel)},'2026-01-01 00:00:00','','uppercase','${zeile.art ?? "page"}')`;
    });
    let sql =
        optionen.spaltenOhneType === true
            ? KOPF_KATEGORIEN_SQL.replace("  `cl_type` enum('page','subcat','file') NOT NULL DEFAULT 'page',\n", "")
            : KOPF_KATEGORIEN_SQL;
    if (tupel.length > 0) {
        sql +=
            optionen.eineZeile === true
                ? `INSERT INTO \`categorylinks\` VALUES ${tupel.join(",")};\n`
                : `INSERT INTO \`categorylinks\` VALUES\n${tupel.map((eintrag, index) => `${eintrag}${index === tupel.length - 1 ? ";" : ","}\n`).join("")}`;
    }
    sql += "UNLOCK TABLES;\n\n";
    if (optionen.ohneEnde !== true) sql += `-- Dump completed on ${optionen.stand ?? "2026-11-09  4:13:37"}\n`;
    return sql;
}

/** Schreibt eine Kategorien-Datei gepackt (`gzip`). `abschneiden` kürzt die gepackte Datei um die letzten Bytes, wie ein Abbruch der Übertragung. */
export async function schreibeKategorienDatei(
    pfad: string,
    sql: string,
    optionen: { abschneiden?: number } = {},
): Promise<void> {
    const gepackt = gzipSync(Buffer.from(sql, "utf8"));
    await writeFile(
        pfad,
        optionen.abschneiden === undefined ? gepackt : gepackt.subarray(0, gepackt.length - optionen.abschneiden),
    );
}

export async function neuerOrdner(vorsilbe: string): Promise<{ pfad: string; weg(): Promise<void> }> {
    const pfad = await mkdtemp(join(tmpdir(), `${vorsilbe}-`));
    return { pfad, weg: () => rm(pfad, { recursive: true, force: true }) };
}
