#!/usr/bin/env node
/**
 * Gewanderte Texte in den Sprachtafeln finden (`npm run i18n:gewandert`).
 *
 * 🔴 **Das Loch, das dieses Werkzeug zeigt:** Der Typ erzwingt, dass jede Tafel jeden SCHLÜSSEL trägt,
 * nicht dass sie dasselbe SAGT. Ändert eine Sitzung den deutschen Text eines Schlüssels, ohne den
 * Schlüssel anzufassen, bleiben die fremden Tafeln stumm stehen und beschriften die Oberfläche falsch.
 * Gefunden am 2026-10-17 von der Sitzung „Dänische und schwedische Sprachtafel“: „Kopfbild“ hieß
 * inzwischen „Titelbild“, französisch stand dort weiter „En-tête“ (behoben in `5e65fd4a6`).
 *
 * **Wie gemessen wird:** Je Tafel der Commit, der sie angelegt hat. Von dort bis `origin/master` wird
 * `de.ts` verglichen; jeder Schlüssel, dessen deutscher Text sich geändert hat, während die fremde Tafel
 * unverändert blieb, ist ein Verdacht. Das setzt nichts voraus außer der Historie und gilt deshalb für
 * jede Tafel, die auf `master` liegt.
 *
 * 🪤 **Ein Verdacht ist kein Fehler.** Zwei Gruppen sind regelmäßig richtig:
 * 1. **Gewollte Abweichung.** Französisch nennt eine Landschaft „région“ (br00n0, Les Ateliers d'Alrik,
 *    2026-10-15); acht Tafeln sagen „Landschaft“, diese eine nicht, und das ist so entschieden.
 * 2. **Deutsche Umformulierung ohne neue Bedeutung.** Aus „Abnahme“ wurde „akzeptieren“; „valider“,
 *    „goedkeuren“, „accettare“, „aceptar“ bleiben richtig. Aus „Territorien“ wurden „Herrschaftsgebiete“;
 *    „Territoires“ bleibt richtig.
 *
 * Deshalb **meldet dieses Werkzeug nur** und hält nichts an (`AGENTS.md`, „Blockierende Prüfungen im
 * Betrieb“): Es nennt die Stellen, entschieden wird von Hand. Wo eine Abweichung gewollt ist, gehört der
 * Grund als Kommentar an die Zeile der Tafel — dann liest ihn die nächste Messung mit.
 *
 * Aufruf:
 *   npm run i18n:gewandert            # alle Tafeln außer der Quelle
 *   npm run i18n:gewandert -- fr nl   # nur diese
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const VERZEICHNIS = "apps/web/src/i18n";
const QUELLE = "de";
const VERGLEICH = "origin/master";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }).trimEnd();

/** Die Tafeln im Verzeichnis: alle `<sprache>.ts` mit zwei Buchstaben, ohne die Quelle. */
function tafeln() {
    const wurzel = resolve(process.cwd(), VERZEICHNIS);
    return readdirSync(wurzel)
        .filter((name) => /^[a-z]{2}\.ts$/u.test(name))
        .map((name) => name.slice(0, 2))
        .filter((sprache) => sprache !== QUELLE)
        .sort();
}

/** Der Commit, der eine Tafel angelegt hat. */
function basisCommit(sprache) {
    const zeilen = git("log", VERGLEICH, "--diff-filter=A", "--format=%H", "--", `${VERZEICHNIS}/${sprache}.ts`);
    return zeilen === "" ? null : zeilen.split("\n").at(-1);
}

/** Schlüssel und Text einer Tafel in einem Stand. Mehrzeilige Werte bleiben außen vor: Sie sind Prosa. */
function tafel(commit, sprache) {
    const quelle = git("show", `${commit}:${VERZEICHNIS}/${sprache}.ts`);
    const karte = new Map();
    for (const treffer of quelle.matchAll(/^\s+"([A-Za-z0-9._]+)":\s*"([^"]*)",$/gmu)) {
        karte.set(treffer[1], treffer[2]);
    }
    return karte;
}

const gewuenscht = process.argv.slice(2);
const liste = gewuenscht.length > 0 ? gewuenscht : tafeln();
const deJetzt = tafel(VERGLEICH, QUELLE);
let summe = 0;

for (const sprache of liste) {
    const basis = basisCommit(sprache);
    if (basis === null) {
        console.log(`\n${sprache}: nicht auf ${VERGLEICH}, übersprungen`);
        continue;
    }
    const deDamals = tafel(basis, QUELLE);
    const damals = tafel(basis, sprache);
    const jetzt = tafel(VERGLEICH, sprache);

    const verdacht = [];
    for (const [schluessel, deutschJetzt] of deJetzt) {
        const deutschDamals = deDamals.get(schluessel);
        const fremdDamals = damals.get(schluessel);
        const fremdJetzt = jetzt.get(schluessel);
        if (deutschDamals === undefined || fremdDamals === undefined || fremdJetzt === undefined) continue;
        if (deutschDamals === deutschJetzt || fremdDamals !== fremdJetzt) continue;
        verdacht.push({ schluessel, deutschDamals, deutschJetzt, fremdJetzt });
    }

    summe += verdacht.length;
    console.log(`\n=== ${sprache} (angelegt in ${basis.slice(0, 8)}): ${verdacht.length} Verdacht ===`);
    for (const eintrag of verdacht) {
        console.log(`  ${eintrag.schluessel}`);
        console.log(`     de war:  ${eintrag.deutschDamals}`);
        console.log(`     de ist:  ${eintrag.deutschJetzt}`);
        console.log(`     ${sprache} ist:  ${eintrag.fremdJetzt}`);
    }
}

console.log(`\n${summe} Verdacht in ${liste.length} Tafeln. Ein Verdacht ist kein Fehler, siehe Kopf dieser Datei.`);
