/**
 * Gegenlese-Blätter der Sprachtafeln (WI-0165 R2, Betreiber 2026-10-15: „ich würde das mal übersetzen, ihm (und den
 * anderen, die nachgefragt haben) die .ts files der sprachen und schicken und frage ob das so passt“).
 *
 *   node scripts/dev/sprachtafel-blatt-cli.ts [--out ordner] [--sprachen en,fr,nl,it,es]
 *
 * 🔴 **Eine `.ts`-Datei geht hin, aber nicht zurück.** Wer gegenliest, ist Muttersprachler, nicht Entwickler: Er
 * arbeitet in einer Tabelle, nicht in TypeScript. Käme die Tafel als Quelltext zurück, brächte sie gebrochene
 * Syntax, verlorene Platzhalter und zerschossene Typografie mit, und niemand sähe, WELCHE Zeile er geändert hat.
 * Darum geht je Sprache ein Blatt hinaus, das zurückkommen kann:
 *
 *   Schlüssel ; Deutsch ; English ; <Sprache> ; Vorschlag ; Anmerkung
 *
 * Die ersten vier Spalten sind der Stand, die letzten beiden sind leer - sie sind das, was zurückkommt. Der
 * Schlüssel in Spalte 1 bindet jede Zeile an ihren Platz in der Tafel; damit lässt sich eine Antwort einspielen,
 * egal in welcher Reihenfolge sie zurückkommt und ob Zeilen fehlen.
 *
 * 🪤 **Die Tafeln werden GELESEN, nicht importiert.** `apps/web` löst Module wie ein Bundler auf und schreibt
 * `from "./de"` ohne Endung; das `tsconfig.tools.json` dieser Skripte löst wie Node auf (`node16`) und verlangt
 * eine. Ein `import` von hier aus macht darum drei fremde Tafeln rot, und der einzige Weg, es zu beheben, wäre,
 * `apps/web` an das Werkzeug anzupassen - falsch herum. Der Parser hier kostet zwanzig Zeilen und hält das
 * Werkzeug ganz aus dem Modulsystem der Web-App heraus.
 *
 * 🪤 **Tabelle und UTF-8.** Ohne Byte Order Mark liest ein Tabellenprogramm die Datei auf einem deutschen Windows
 * als Latin-1, und aus „Aventurië“ wird „AventuriÃ«“ - im Blatt eines Lektors ist das kein Schönheitsfehler,
 * sondern eine Zeile, die er für einen Fehler hält und „berichtigt“. Die Datei trägt deshalb ein BOM, Semikolon
 * als Trenner und CRLF am Zeilenende.
 *
 * 🪤 **Zeilenumbrüche in einem Text.** 23 Sätze tragen echte Umbrüche (die Aufzählungen der Erklärkästen). In einer
 * Zelle überleben sie das Hin und Her nicht zuverlässig; sie stehen deshalb als `\n` in zwei Zeichen da, und das
 * Begleitblatt sagt es.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const TAFELN = "apps/web/src/i18n";
const NAMEN: Record<string, string> = {
    de: "Deutsch",
    en: "English",
    fr: "Français",
    nl: "Nederlands",
    it: "Italiano",
    es: "Español",
    pl: "Polski",
    da: "Dansk",
    sv: "Svenska",
};

/** Das Byte Order Mark, als Code statt als unsichtbares Zeichen im Quelltext - siehe den Kasten oben. */
const BOM = String.fromCharCode(0xfeff);

/**
 * Ein Schlüssel-Wert-Paar je Zeile, auch wo Prettier den Wert auf die nächste Zeile umgebrochen hat.
 * Dieselbe Form prüft `apps/web/test/i18n.test.ts` - die Tafeln sind Objektliterale aus doppelt gequoteten
 * Zeichenketten, nichts darin wird gerechnet.
 *
 * 💣 **Der Schlüsselteil ist `[^"]+`, nicht `[A-Za-z0-9._]+`.** Elf Schlüssel tragen einen Bindestrich
 * (`display.check.uphill-rivers`, `admin.content.license.cc-by-sa`, `admin.tab.protokoll-system` und acht
 * weitere), und ein engeres Muster übergeht sie STILL: Das Blatt käme elf Zeilen zu kurz beim Gegenleser an,
 * und niemand sähe, welche fehlen. Dieselbe Regex hat beim Bau von `nl.ts` sieben deutsche Sätze in der
 * niederländischen Tafel stehen lassen (WI-0165 R4). `apps/web/test/i18n.test.ts` prüft die Zahl der so
 * gefundenen Schlüssel jetzt gegen die Zahl im Objekt, damit das kein zweites Mal still passiert.
 */
const ZEILE = /^[ \t]+"([^"]+)":[ ]*(?:\r?\n[ \t]+)?("(?:[^"\\]|\\.)*")(?:,?)[ ]*$/gm;

function lies(code: string): Map<string, string> {
    const quelle = readFileSync(join(TAFELN, `${code}.ts`), "utf8");
    const tafel = new Map<string, string>();
    for (const treffer of quelle.matchAll(ZEILE)) {
        tafel.set(treffer[1] as string, JSON.parse(treffer[2] as string) as string);
    }
    if (tafel.size === 0) throw new Error(`${code}.ts: keine Zeile gelesen - hat sich die Form der Tafel geändert?`);
    return tafel;
}

/**
 * Ein Feld für eine Tabelle mit Semikolon: Anführungszeichen verdoppeln, Umbrüche sichtbar machen.
 *
 * 💣 **Was mit `-`, `+`, `=` oder `@` beginnt, liest ein Tabellenprogramm als FORMEL**, auch in Anführungszeichen.
 * In dieser Tafel trifft das zwölf Schlüssel - neun Erklärkästen, deren Aufzählungen mit `- ` anfangen
 * (`transportInfo.riverNote`, `.seaNote`, `.rest`, die vier Flugregeln, `.mountain.rule.carriage`,
 * `planner.optionsInfo.optimize.body`) und drei Zeiten und Knöpfe mit `+` (`planner.profile.summary.hours`,
 * `planner.air.extra`, `catalog.citymaps.addSource`). Ohne das führende Apostroph unten kommen sie beim
 * Gegenleser als `#NAME?` an - und ausgerechnet die langen Kästen sind das, wozu er am meisten sagen kann.
 *
 * 🪤 Das Apostroph ist ein **Zeichen des Transports, kein Teil des Textes**. Ein Tabellenprogramm zeigt es nicht
 * an und schreibt es beim Speichern nicht mit; wer die Datei als reinen Text einliest, sieht es und schneidet es
 * ab. Das Begleitblatt sagt es, und ein Einlese-Werkzeug muss es wissen.
 *
 * (Eine automatische Sicherheitsprüfung nennt das „CSV-Formel-Injektion“. Als Angriffsweg trägt das hier nicht:
 * Die Texte stehen versioniert im Repository, und wer sie ändern kann, schreibt ohnehin Code in die App. Behoben
 * ist es, weil es die Lieferung kaputt macht.)
 */
const FORMELZEICHEN = /^[=+\-@\t\r]/;

function feld(text: string): string {
    const flach = text.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\r", "\\r");
    const sicher = FORMELZEICHEN.test(flach) ? `'${flach}` : flach;
    return `"${sicher.replaceAll('"', '""')}"`;
}

function blatt(code: string, de: Map<string, string>, en: Map<string, string>): string {
    const tafel = lies(code);
    const kopf = ["Schluessel", "Deutsch", "English", NAMEN[code] ?? code, "Vorschlag", "Anmerkung"];
    const zeilen = [kopf.map(feld).join(";")];
    for (const [key, deutsch] of de) {
        const spalten = [key, deutsch, en.get(key) ?? "", tafel.get(key) ?? "", "", ""];
        zeilen.push(spalten.map(feld).join(";"));
    }
    return `${BOM}${zeilen.join("\r\n")}\r\n`;
}

/** Was ein Gegenleser wissen muss, bevor er die erste Zeile anfasst. */
function begleitblatt(codes: readonly string[], zeilen: number): string {
    const liste = codes.map((c) => `\`avesmaps-${c}.csv\` (${NAMEN[c] ?? c})`).join(", ");
    const niederlaendisch = codes.includes("nl")
        ? `
Für **Niederländisch** ist die Ausgabe *Het Oog des Meesters* seit langem vergriffen, und wir hatten sie beim
Übersetzen nicht vorliegen. Diese Begriffe sind deshalb von uns gesetzt — **genau hier hilft die Gegenlesung am
meisten:**

| Deutsch | unser Niederländisch |
|---|---|
| Reichsstraße · Straße · Weg · Pfad | Rijksweg · Straatweg · Weg · Pad |
| Gebirgspass · Wüstenpfad · Flussweg · Seeweg | Bergpas · Woestijnpad · Rivierweg · Zeeweg |
| Unwegsames Gelände · „querfeldein“ im Satz | Ruw terrein · buiten de wegen |
| Reisetag · Etappe · Rast · Eiltempo | reisdag · Etappe · rust · Spoedtempo |
| Meile · Schritt · Stunde (Zeichen) | mijl · passen · u |
| Wegpunkt · politisches Gebiet · Stätte | routepunt · politiek gebied · locatie |
| Flugmittel · Betreiber · Konto · Sitzung | vliegmiddel · beheerder · account · sessie |

Der deutsche „See“ ist ein Binnensee und heißt *Meer*; das deutsche „Meer“ heißt *Zee*.
`
        : "";
    const italienisch = codes.includes("it")
        ? `
Für **Italienisch** gibt es die Ausgabe *Uno Sguardo nel Buio*, aber wir hatten sie beim Übersetzen nicht vorliegen.
Auch diese Begriffe sind von uns gesetzt — **auch hier hilft die Gegenlesung am meisten:**

| Deutsch | unser Italienisch |
|---|---|
| Reichsstraße · Straße · Weg · Pfad | Strada imperiale · Strada · Via · Sentiero |
| Gebirgspass · Wüstenpfad · Flussweg · Seeweg | Passo montano · Pista del deserto · Via fluviale · Via marittima |
| Unwegsames Gelände · „querfeldein“ im Satz | Terreno impervio · fuori strada |
| Reisetag · Etappe · Rast · Eiltempo | giornata di viaggio · Tappa · Sosta · Passo forzato |
| Meile · Schritt · Stunde (Zeichen) | miglia · passi · h |
| Wegpunkt · politisches Gebiet · Stätte | punto di percorso · territorio politico · sito |
| Flugmittel · Betreiber · Konto · Sitzung | mezzo di volo · gestore · account · sessione |

Der deutsche „See“ ist ein Binnensee und heißt *Lago*; das deutsche „Meer“ heißt *Mare*.
`
        : "";
    const spanisch = codes.includes("es")
        ? `
Für **Spanisch** erscheint die Ausgabe als *El Ojo Oscuro* (Ediciones Epicismo unter Lizenz von Ulisses Spiele); der
Titel steht so in der Tafel, die Ausgabe selbst hatten wir beim Übersetzen nicht vorliegen. Auch diese Begriffe sind
von uns gesetzt — **auch hier hilft die Gegenlesung am meisten:**

| Deutsch | unser Spanisch |
|---|---|
| Reichsstraße · Straße · Weg · Pfad | Calzada imperial · Calzada · Camino · Senda |
| Gebirgspass · Wüstenpfad · Flussweg · Seeweg | Paso de montaña · Pista del desierto · Vía fluvial · Vía marítima |
| Unwegsames Gelände · „querfeldein“ im Satz | Terreno abrupto · a campo través |
| Reisetag · Etappe · Rast · Eiltempo | jornada de viaje · Etapa · Descanso · Paso forzado |
| Meile · Schritt · Stunde (Zeichen) | millas · pasos · h |
| Wegpunkt · politisches Gebiet · Stätte | punto de ruta · territorio político · sitio |
| Flugmittel · Betreiber · Konto · Sitzung | medio de vuelo · operador · cuenta · sesión |

Der deutsche „See“ ist ein Binnensee und heißt *Lago*; das deutsche „Meer“ heißt *Mar*.
`
        : "";
    return `# Avesmaps — die Texte der Oberfläche zur Gegenlesung

Avesmaps ist ein nicht-kommerzieller Fan-Routenplaner für Aventurien. Seine Oberfläche ist vollständig übersetzt:
Deutsch ist die Quelle, die anderen Sprachen sind vollständige Tafeln darüber. Jede Zeile, die ein Mensch zu sehen
bekommt, steht hier — auch die Beschriftungen, die nur ein Vorleseprogramm ausspricht.

Beiliegend: ${liste}, je ${zeilen} Zeilen.

## So lesen sich die Spalten

| Spalte | |
|---|---|
| **Schluessel** | Der Platz in der Oberfläche. Nie ändern — er bindet die Zeile an ihren Ort. |
| **Deutsch** | Der Originaltext. |
| **English** | Als zweite Lesart, wo das Deutsche knapp ist. |
| *(Sprachspalte)* | Unsere Übersetzung. Zum Lesen, nicht zum Überschreiben. |
| **Vorschlag** | **Hier steht, was besser wäre.** Leer heißt: passt. |
| **Anmerkung** | Warum, wenn es der Rede wert ist. |

Zurück kommt dieselbe Datei. Zeilen ohne Eintrag in *Vorschlag* bleiben, wie sie sind.

## Vier Dinge, die nicht übersetzt werden

1. **Platzhalter in geschweiften Klammern** — \`{n}\`, \`{name}\`, \`{from}\`. Sie stehen wörtlich so da, wie sie
   dastehen, und vollzählig; die Oberfläche setzt dort Zahlen und Namen ein. Ihre Stelle im Satz darf sich ändern,
   ihre Schreibweise nicht.
2. **Namen** — Orte, Wege, Kartenserien, die aventurischen Monate (Praios … Rahja), die Währungen (Dukat,
   Silbertaler, Heller) und die Werktitel (Geographia Aventurica, Wege des Entdeckers, Kodex der Helden).
3. **\`\\n\`** — zwei Zeichen, die für einen Zeilenumbruch stehen. Sie bleiben, wo sie sind.
   Steht vor einer Zeile ein **Apostroph** (\`'- Stromab gilt …\`), gehört er nicht zum Text: Er hindert das
   Tabellenprogramm daran, die Zeile für eine Rechenformel zu halten. Die meisten Programme zeigen ihn gar nicht
   erst an. Er darf stehen bleiben.
4. **Markierungen wie \`**fett**\`, \`*kursiv*\` und \`[Text](Adresse)\`** — Sternchen und Klammern bleiben, der Text
   darin wird übersetzt, die Adresse nicht.

## Wie die Texte klingen sollen

- **Niemand wird angesprochen.** Kein „du“, kein „Sie“, kein „je“, kein „u“, kein „vous“. Die Oberfläche sagt, was
  ist und was geschieht, nicht was man tun soll.
- **Aufschriften im Infinitiv:** „Öffnen“, nicht „Öffne“ oder „Klicken Sie hier“.
- **Kurze gesprochene Sätze**, keine langen Gedankenstriche.
- **Begriffe durchgehend gleich.** Wer eine Wegart anders nennen will, nennt sie überall anders.
- **Platz ist knapp.** Viele Texte stehen in schmalen Feldern und auf Telefonen. Wo es zwei richtige Wörter gibt,
  gewinnt das kürzere.

## Die DSA-Begriffe

Für **Englisch** folgen sie der Ausgabe *The Dark Eye*, für **Französisch** *L’Œil Noir*.
${niederlaendisch}${italienisch}${spanisch}
## Typografie

| | |
|---|---|
| Englisch | “ … ”, Apostroph ’ |
| Französisch | « … », Apostroph ’ |
| Niederländisch | “ … ”, Apostroph ’ |
| Italienisch | « … », Apostroph ’ |

Nie die geraden Tastenzeichen \`'\` und \`"\`.
`;
}

const { values } = parseArgs({ options: { out: { type: "string" }, sprachen: { type: "string" } } });
const ziel = values.out ?? "review/sprachtafeln";
const codes = (values.sprachen ?? "en,fr,nl,it,es").split(",").filter((code) => code !== "" && code !== "de");

const de = lies("de");
const en = lies("en");
mkdirSync(ziel, { recursive: true });
for (const code of codes) {
    const pfad = join(ziel, `avesmaps-${code}.csv`);
    writeFileSync(pfad, blatt(code, de, en), "utf8");
    console.log(`${pfad}: ${de.size} Zeilen (${NAMEN[code] ?? code})`);
}
const begleit = join(ziel, "zur-gegenlesung.md");
writeFileSync(begleit, begleitblatt(codes, de.size), "utf8");
console.log(begleit);
