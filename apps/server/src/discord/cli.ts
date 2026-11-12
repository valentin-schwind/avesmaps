import { readFileSync } from "node:fs";
import { setTimeout as warte } from "node:timers/promises";
import { DISCORD_ZEITPLAN, sendefenster, type DiscordLaufErgebnis } from "@avesmaps3d/shared";
import { createDatabase } from "../database.ts";
import { archiv, leseRoutine } from "./ablage.ts";
import { OHNE_DATENBANK, befehlOhneDatenbank, type BefehlOhneDatenbank } from "./befehle.ts";
import { anwendungsKennung, discordKonfiguration, sendeSperre, wirksam, zielKanal } from "./konfig.ts";
import { discordRest } from "./rest.ts";
import { berichtstag } from "./zeit.ts";
import { entwirf, tagesbericht, type ZustellDeps } from "./zustellung.ts";

/**
 * Die Kommandozeile des Discord-Berichts (WI-0255), aus der Wurzel eines Release:
 *
 *     node apps/server/src/discord/cli.ts tagesbericht [--fenster-ignorieren]   der EINE Aufruf von Claudios Timer (alle 15 Minuten)
 *     node apps/server/src/discord/cli.ts vorschau [--modell]                   alle Nachrichten mit Zeichenzahl je Nachricht, Prüfung und Fakten; sendet und speichert nichts.
 *                                                                               Ohne `--modell` die feste Vorlage, mit `--modell` der Text des Formulierers (ein Aufruf des Modells)
 *     node apps/server/src/discord/cli.ts status                                Routine und die letzten Zustellungen
 *     node apps/server/src/discord/cli.ts befehle-registrieren [--server <id>]  /hilfe, /bug, /idee, /frage bei Discord anmelden (Paket 2)
 *     node apps/server/src/discord/cli.ts befehle-lesen [--server <id>]         was bei Discord angemeldet ist, global oder im Server; liest nur
 *     node apps/server/src/discord/cli.ts befehle-server-leeren --server <id>   die Liste eines Servers leeren (doppelte Befehle, OPS-000076); global bleibt
 *     node apps/server/src/discord/cli.ts discord-nachricht --datei <pfad> [--kanal <id>]   einen Text in den Berichtskanal stellen (Begrüßung)
 *     node apps/server/src/discord/cli.ts kanal-pruefen --kanal <id>            darf der Bot in diesem Kanal sehen und schreiben? Nur lesend, sendet nichts
 *
 * Die fünf letzten brauchen `DISCORD_BOT_TOKEN` und `DISCORD_APPLICATION_ID` (Vorgabe: die ID von Avesmaps); Claudio führt sie aus, weil nur er den
 * Bot-Schlüssel hat (`befehle.ts`). 🔴 `discord-nachricht` sendet nur in den Berichtskanal: den aus dem Reiter, wenn `DATABASE_URL` da ist und dort
 * einer steht, sonst `DISCORD_BERICHT_KANAL`; ein `--kanal` muss derselbe sein, sonst geht nichts hinaus. Exitcode 0 bei Erfolg, 1 wenn Discord
 * ablehnt oder der Berichtskanal nicht lesbar ist, 2 bei falschem Aufruf oder fehlendem Berichtskanal. `kanal-pruefen` ruft nur `pruefeKanal` (vier
 * `GET`) und gilt für jeden Kanal, auch die von `/bug` und `/idee`: Exitcode 0 nur bei „erlaubt“, 1 bei verboten, unbekannt oder nicht prüfbar.
 *
 * Verbindung `DATABASE_URL` (die App-Rolle aus der `.env` der Umgebung), Konfiguration `DISCORD_*` und `RELEASE_ID` aus der Umgebung
 * (`konfig.ts`). `--fenster-ignorieren` lässt nur das Sendefenster außer Acht, in den Berichtskanal und bei eingeschalteter Routine (Claudios Probe,
 * die ohne Testkanal öffentlich postet und nur mit Valis ausdrücklichem Wort läuft: `discord-einrichten.sh --probe`).
 *
 * Der Timer fragt alle 15 Minuten (WI-0255); ob jetzt gesendet wird, entscheidet die App aus Uhrzeit und Kanal, die die Betreiber im Reiter
 * gespeichert haben (Sendefenster: die Uhrzeit bis vier Stunden danach, höchstens bis Mitternacht). Ein Lauf vor oder nach dem Fenster endet mit
 * Exitcode 0 und sendet nichts; einmal je Tag und Kanal hält die Zustelltafel.
 *
 * Exitcode: 0, wenn zugestellt oder bewusst nicht gesendet (aus, nicht die Stage, Routine aus, außerhalb des Fensters, schon zugestellt,
 * läuft schon); 1, wenn etwas schiefging, das jemand ansehen muss (fehlgeschlagen, unklar, Prüfung rot, Konfiguration unvollständig); 2 bei
 * falschem Aufruf. 🔴 Keine Ausgabe trägt den Bot-Schlüssel.
 */

const ROT: readonly DiscordLaufErgebnis[] = [
    "fehlgeschlagen",
    "unklar",
    "pruefung_rot",
    "ohne_schluessel",
    "ohne_kanal",
];

/**
 * Der Berichtskanal, der gilt: der aus dem Reiter, wenn `DATABASE_URL` da ist, sonst der aus der Umgebung. Die Datenbank bleibt hier optional (die
 * Befehle laufen auch ohne), aber ist sie gesetzt und nicht lesbar, wirft es: Dann geht nichts hinaus, statt still einen anderen Kanal zu nehmen.
 */
async function berichtsKanalDerUmgebung(): Promise<string | undefined> {
    const konfig = discordKonfiguration(process.env);
    const verbindung = process.env["DATABASE_URL"];
    if (verbindung === undefined || verbindung === "") return konfig.berichtKanal;
    const db = createDatabase(verbindung, { max: 1 });
    try {
        return wirksam(konfig, await leseRoutine(db)).berichtKanal;
    } finally {
        await db.end({ timeout: 5 });
    }
}

const [befehl, ...rest] = process.argv.slice(2);
// Die Befehle (WI-0255 Paket 2): anmelden und einen Text senden, nur mit dem Bot-Schlüssel aus der Umgebung (die Datenbank nur für den Berichtskanal).
if ((OHNE_DATENBANK as readonly string[]).includes(befehl ?? "")) {
    const ausgang = await befehlOhneDatenbank(
        befehl as BefehlOhneDatenbank,
        rest,
        process.env,
        anwendungsKennung(process.env),
        {
            out: (zeile) => void process.stdout.write(`${zeile}\n`),
            err: (zeile) => void process.stderr.write(`${zeile}\n`),
            lies: (pfad) => readFileSync(pfad, "utf8"),
            berichtsKanal: berichtsKanalDerUmgebung,
        },
    );
    process.exit(ausgang);
}
if (befehl !== "tagesbericht" && befehl !== "vorschau" && befehl !== "status") {
    process.stderr.write(
        "Aufruf: cli.ts tagesbericht [--fenster-ignorieren] | vorschau [--modell] | status | befehle-registrieren [--server <id>] | befehle-lesen [--server <id>] | befehle-server-leeren --server <id> | " +
            "discord-nachricht --datei <pfad> [--kanal <berichtskanal-id>] | kanal-pruefen --kanal <kanal-id>\n",
    );
    process.exit(2);
}
const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
    process.stderr.write("DATABASE_URL fehlt\n");
    process.exit(2);
}

const konfig = discordKonfiguration(process.env);
const database = createDatabase(url, { max: 2 });
const deps: ZustellDeps = {
    db: database,
    konfig,
    rest: konfig.botToken === undefined ? undefined : discordRest(konfig.botToken),
    jetzt: () => new Date(),
    warte: async (ms) => {
        await warte(ms);
    },
};
const out = (zeile: string): void => void process.stdout.write(`${zeile}\n`);

let code = 0;
try {
    if (befehl === "tagesbericht") {
        const ergebnis = await tagesbericht(deps, { fensterIgnorieren: rest.includes("--fenster-ignorieren") });
        out(`discord tagesbericht: ${ergebnis.ergebnis}${ergebnis.detail === null ? "" : ` (${ergebnis.detail})`}`);
        code = ROT.includes(ergebnis.ergebnis) ? 1 : 0;
    } else if (befehl === "vorschau") {
        const tag = berichtstag(new Date());
        const eff = wirksam(konfig, await leseRoutine(database));
        // Ohne `--modell` zeigt die Vorschau die feste Vorlage und ruft keinen Formulierer (wie der Reiter „Discord“); der gesendete Bericht ist aber der des
        // Modells, wo ein Formulierer eingerichtet ist und sein Text die Prüfung besteht. Mit `--modell` läuft das Programm hinter `DISCORD_BERICHT_FORMULIERER`
        // (bis 90 s, ein Aufruf des Modells), sonst nichts anders: Es wird weder gesendet noch gespeichert.
        const mitModell = rest.includes("--modell");
        const entwurf = await entwirf(
            { ...deps, konfig: eff },
            tag,
            zielKanal(eff) ?? eff.berichtKanal ?? null,
            mitModell,
        );
        // Jede Nachricht für sich, mit ihrer Länge (Vali 2026-11-02: der Bericht darf aus mehreren bestehen); bei einer wie bisher der Text allein.
        const mehrere = entwurf.teile.length > 1;
        entwurf.teile.forEach((teil, index) => {
            if (mehrere) {
                out(
                    `──── Nachricht ${String(index + 1)} von ${String(entwurf.teile.length)} (${String(teil.length)} Zeichen) ────`,
                );
            }
            out(teil);
            out("");
        });
        const laengen = entwurf.teile.map((teil) => String(teil.length));
        out(
            `Prüfung: ${entwurf.pruefung.ok ? "grün" : `rot (${entwurf.pruefung.fehler.join(", ")})`}, ` +
                (mehrere
                    ? `${String(laengen.length)} Nachrichten zu ${laengen.join(" / ")} Zeichen`
                    : `${laengen.join("")} Zeichen`),
        );
        // Woher der Text stammt: Ohne diese Zeile sah niemand, dass die Vorschau die Vorlage zeigt und nicht den Text des Modells.
        out(
            `Formulierung: ${entwurf.formulierung === "modell" ? "Modell" : "Vorlage"}` +
                (entwurf.hinweis === null ? "" : ` (${entwurf.hinweis})`) +
                (!mitModell
                    ? "; ohne --modell ruft die Vorschau keinen Formulierer, der gesendete Bericht schon"
                    : eff.formulierer === undefined
                      ? "; kein Formulierer eingerichtet (DISCORD_BERICHT_FORMULIERER fehlt)"
                      : ""),
        );
        out(
            `Fakten: Production ${entwurf.fakten.production.vergleich} (${String(entwurf.fakten.production.neu.length)} neu), ` +
                `Werkstatt ${entwurf.fakten.werkstatt.vergleich} (${String(entwurf.fakten.werkstatt.neu.length)} neu, Prüfung ${entwurf.fakten.werkstatt.pruefung}), ` +
                `Community ${String(entwurf.fakten.community.bearbeitungen)}/${String(entwurf.fakten.community.medien)}/${String(entwurf.fakten.community.bewertungen)}`,
        );
        code = entwurf.pruefung.ok ? 0 : 1;
    } else {
        const routine = await leseRoutine(database);
        const sperre = sendeSperre(wirksam(konfig, routine));
        out(
            `Umgebung ${konfig.umgebung}, Modus ${konfig.modus}, ${sperre === null ? "sendet" : `sendet nicht (${sperre})`}`,
        );
        const fenster = sendefenster(routine.uhrzeit);
        out(
            `Uhrzeit ${fenster.von} (${DISCORD_ZEITPLAN.zone}), gesendet wird bis ${fenster.bis}; Prompt ${routine.prompt === null ? "Vorgabe" : "eigener"}`,
        );
        out(
            `Routine ${routine.aktiv ? "an" : "aus"}; letzter Lauf ${routine.letzter_lauf_at?.toISOString() ?? "nie"}: ${routine.letzter_lauf ?? "-"}`,
        );
        for (const zeile of await archiv(database, 7)) {
            out(
                `${zeile.berichtstag} ${zeile.kanal} ${zeile.status} ${zeile.message_id ?? "-"} Versuche ${String(zeile.versuche)}${zeile.fehler === null ? "" : ` ${zeile.fehler}`}`,
            );
        }
    }
} catch (fehler) {
    process.stderr.write(`discord ${befehl}: ${fehler instanceof Error ? fehler.message : String(fehler)}\n`);
    code = 1;
} finally {
    await database.end({ timeout: 5 });
}
process.exit(code);
