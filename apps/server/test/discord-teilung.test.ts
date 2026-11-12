import { describe, expect, it } from "vitest";
import {
    DISCORD_BERICHT_MAX,
    DISCORD_BERICHT_TEILE_MAX,
    DISCORD_INHALT_MAX,
    DISCORD_SCHLUSS,
} from "@avesmaps3d/shared";
import { endetAlsSatz, ersteSaetze, nutzerText, saetzeVon, satzKuerze } from "../src/discord/muster.ts";
import { pruefeTeile } from "../src/discord/pruefung.ts";
import { NACHRICHTEN_TRENNER, teileBericht } from "../src/discord/teilung.ts";

/**
 * Der Bericht in mehreren Nachrichten (WI-0255; Vali 2026-11-02: „wenn A geht“): Teilen nur an Punktgrenzen, die Überschriften in jeder Nachricht wieder, der Gruß
 * nur in der ersten, Link, Dank und Unterschrift nur in der letzten, jede Nachricht unter der Grenze und alle Punkte da.
 */

const TITEL = "🚀 **Tagesbericht** · 25.10.2026";
const GRUSS = "Guten Morgen. Wir waren wieder fleißig für euch.";
const DANK = [
    "**Dank an unsere fleißigen Editoren und die Community:**",
    "• 14 Bearbeitungen an der Karte im Editor seit gestern von 3 Leuten",
    "Danke an alle, die mitmachen!",
];
const punkt = (i: number, laenge = 150): string =>
    `• Neuerung Nummer ${String(i)} ${"mit erklärenden Worten ".repeat(Math.ceil(laenge / 23)).trim()}.`;

/** Ein Bericht im Aufbau der Vorlage: Kopf, zwei Teile mit Bereichen, Community mit Gruppen, Link, Dank, Unterschrift. */
function bericht(opts: {
    neu: number;
    fehler: number;
    entwicklung: number;
    bugs: number;
    ideen: number;
    dank: boolean;
}): string {
    const zeilen = [TITEL, GRUSS, "", "✨ **Was ist neu?** (auf avesmaps.de)", "🗺️ **Karte**"];
    for (let i = 0; i < opts.neu; i += 1) zeilen.push(punkt(i));
    if (opts.fehler > 0) zeilen.push("🐞 **Fehler behoben**");
    for (let i = 0; i < opts.fehler; i += 1) zeilen.push(punkt(100 + i));
    zeilen.push("", "🔨 **Was ist in Entwicklung?** (noch nicht auf avesmaps.de)");
    if (opts.entwicklung === 0)
        zeilen.push("Seit dem letzten Bericht ist in der Entwicklung nichts Neues dazugekommen.");
    else {
        zeilen.push("🛠️ **Editor und Werkzeuge**");
        for (let i = 0; i < opts.entwicklung; i += 1) zeilen.push(punkt(200 + i));
    }
    if (opts.bugs + opts.ideen > 0) {
        zeilen.push("", "💬 **Aus der Community**");
        if (opts.bugs > 0) zeilen.push("🐞 **Bugs**");
        for (let i = 0; i < opts.bugs; i += 1)
            zeilen.push(`• #${String(300 + i)} „Fehler Nummer ${String(i)} im Editor“ (Thomas)`);
        if (opts.ideen > 0) zeilen.push(`💡 **Ideen (${String(opts.ideen)})**`);
        for (let i = 0; i < opts.ideen; i += 1) zeilen.push(`• #${String(400 + i)} „Idee Nummer ${String(i)}“ (Lena)`);
    }
    zeilen.push("", "https://avesmaps.de", "");
    if (opts.dank) zeilen.push(...DANK);
    zeilen.push(DISCORD_SCHLUSS);
    return zeilen.join("\n");
}

const punktzeilen = (text: string): string[] => text.split("\n").filter((z) => z.startsWith("• "));

describe("Discord-Bericht: Teilen in Nachrichten", () => {
    it("🔴 passt der Text in eine Nachricht, bleibt er unverändert eine", () => {
        const kurz = bericht({ neu: 2, fehler: 1, entwicklung: 1, bugs: 1, ideen: 1, dank: true });
        expect(kurz.length).toBeLessThanOrEqual(DISCORD_BERICHT_MAX);
        expect(teileBericht(kurz)).toEqual([kurz]);
        // Auch ein Text mit einem seltsamen Aufbau, der passt, bleibt wie er ist.
        const seltsam = `${TITEL}\n• Punkt im Kopf\n${DISCORD_SCHLUSS}`;
        expect(teileBericht(seltsam)).toEqual([seltsam]);
    });

    it("🔴 viele Punkte: mehrere Nachrichten, jede unter der Grenze, jeder Punkt genau einmal und ganz, in der Reihenfolge", () => {
        const text = bericht({ neu: 14, fehler: 6, entwicklung: 9, bugs: 8, ideen: 12, dank: true });
        expect(text.length).toBeGreaterThan(DISCORD_BERICHT_MAX * 2);
        const teile = teileBericht(text)!;
        expect(teile.length).toBeGreaterThan(2);
        expect(teile.length).toBeLessThanOrEqual(DISCORD_BERICHT_TEILE_MAX);
        for (const teil of teile) expect(teil.length).toBeLessThanOrEqual(DISCORD_BERICHT_MAX);
        // Nichts geht verloren, nichts wird doppelt, nichts bricht mitten im Punkt ab.
        expect(teile.flatMap(punktzeilen)).toEqual(punktzeilen(text));
        expect(pruefeTeile(teile, "2026-10-25")).toEqual({ ok: true, fehler: [] });
    });

    it("🔴 die Überschriften stehen in jeder Nachricht wieder über ihren Punkten, und keine steht ohne Punkt darunter", () => {
        const teile = teileBericht(bericht({ neu: 14, fehler: 6, entwicklung: 9, bugs: 8, ideen: 12, dank: true }))!;
        const ueberschrift = /^(?:🗺️|🛠️|🐞|✨|🔨|💬|💡) \*\*/u;
        for (const teil of teile) {
            const zeilen = teil.split("\n");
            zeilen.forEach((zeile, i) => {
                if (!ueberschrift.test(zeile) || zeile.startsWith("🚀")) return;
                const naechste = zeilen[i + 1] ?? "";
                expect(ueberschrift.test(naechste) || naechste.startsWith("• ") || naechste.startsWith("Seit ")).toBe(
                    true,
                );
            });
            // Jeder Punkt steht unter dem Teil, zu dem er gehört: Neuerungen von Production unter „Was ist neu?“ usw.
            const ersterPunkt = teil.split("\n").findIndex((z) => z.startsWith("• Neuerung Nummer "));
            if (ersterPunkt < 0) continue;
            const davor = teil.split("\n").slice(0, ersterPunkt).join("\n");
            const nummer = Number(/Nummer (\d+)/u.exec(teil.split("\n")[ersterPunkt]!)![1]);
            if (nummer < 100)
                expect(davor).toMatch(/✨ \*\*Was ist neu\?\*\* \(auf avesmaps\.de\)\n🗺️ \*\*Karte\*\*$/u);
            else if (nummer < 200)
                expect(davor).toMatch(/✨ \*\*Was ist neu\?\*\* \(auf avesmaps\.de\)\n🐞 \*\*Fehler behoben\*\*$/u);
            else
                expect(davor).toMatch(
                    /🔨 \*\*Was ist in Entwicklung\?\*\* \(noch nicht auf avesmaps\.de\)\n🛠️ \*\*Editor und Werkzeuge\*\*$/u,
                );
        }
        // Die Gruppen der Community: Bugs und Ideen tragen den Kopf „Aus der Community“ in jeder Nachricht, die ihre Punkte hat.
        let gruppen = 0;
        for (const teil of teile) {
            const zeilen = teil.split("\n");
            zeilen.forEach((zeile, i) => {
                const vorige = zeilen[i - 1] ?? "";
                if (zeile.startsWith("• #3")) {
                    expect(vorige.startsWith("• #3") || vorige === "🐞 **Bugs**").toBe(true);
                    if (vorige === "🐞 **Bugs**") {
                        gruppen += 1;
                        expect(zeilen[i - 2]).toBe("💬 **Aus der Community**");
                    }
                }
                if (zeile.startsWith("• #4")) {
                    expect(vorige.startsWith("• #4") || vorige === "💡 **Ideen (12)**").toBe(true);
                    if (vorige === "💡 **Ideen (12)**") {
                        gruppen += 1;
                        // Beginnt die Gruppe nicht gleich nach dem Kopf, steht der Kopf der Community vor ihr, in jeder Nachricht.
                        expect(zeilen.includes("💬 **Aus der Community**")).toBe(true);
                    }
                }
            });
        }
        // Mindestens: die Bugs und die Ideen je einmal; durch das Teilen kommt mancher Kopf in einer weiteren Nachricht wieder vor.
        expect(gruppen).toBeGreaterThanOrEqual(2);
    });

    it("🔴 der Gruß nur in der ersten Nachricht; Link, Dank und Unterschrift nur in der letzten", () => {
        const teile = teileBericht(bericht({ neu: 14, fehler: 6, entwicklung: 9, bugs: 8, ideen: 12, dank: true }))!;
        expect(teile[0]!.startsWith(`${TITEL}\n${GRUSS}\n\n✨ `)).toBe(true);
        expect(teile.slice(1).join("\n")).not.toContain(GRUSS);
        expect(teile.slice(1).join("\n")).not.toContain(TITEL);
        const letzte = teile.at(-1)!;
        expect(letzte.endsWith(`https://avesmaps.de\n\n${DANK.join("\n")}\n${DISCORD_SCHLUSS}`)).toBe(true);
        const davor = teile.slice(0, -1).join("\n");
        for (const nur of ["https://avesmaps.de", "Dank an unsere", "Danke an alle", DISCORD_SCHLUSS]) {
            expect(davor).not.toContain(nur);
        }
        // Ohne Dank: Link und Unterschrift in der letzten.
        const ohneDank = teileBericht(bericht({ neu: 20, fehler: 0, entwicklung: 0, bugs: 0, ideen: 0, dank: false }))!;
        expect(ohneDank.at(-1)!.endsWith(`https://avesmaps.de\n\n${DISCORD_SCHLUSS}`)).toBe(true);
        expect(ohneDank.slice(0, -1).join("\n")).not.toContain(DISCORD_SCHLUSS);
    });

    it("Absätze ohne Punkte bleiben zusammen; die Nachricht füllt sich bis zur Grenze (keine unnötig kurzen)", () => {
        const teile = teileBericht(bericht({ neu: 30, fehler: 0, entwicklung: 0, bugs: 0, ideen: 0, dank: true }))!;
        expect(teile.length).toBeGreaterThan(1);
        // Alle außer der letzten sind so voll, dass der nächste Punkt (rund 170 Zeichen samt Zeilenumbruch) nicht mehr hineinpasste.
        for (const teil of teile.slice(0, -1)) expect(teil.length).toBeGreaterThan(DISCORD_BERICHT_MAX - 400);
        // Der Satz zum leeren Teil steht ganz in der Nachricht, in der sein Teil beginnt.
        const mitLeersatz = teile.filter((teil) => teil.includes("🔨 **Was ist in Entwicklung?**"));
        expect(mitLeersatz).toHaveLength(1);
        expect(mitLeersatz[0]).toContain(
            "🔨 **Was ist in Entwicklung?** (noch nicht auf avesmaps.de)\nSeit dem letzten Bericht ist in der Entwicklung nichts Neues dazugekommen.",
        );
    });

    it("🔴 der Aufbau eines Modells: Teilüberschrift, Punkte ohne Bereich; mit eigener Grenze", () => {
        const zeilen = [TITEL, "Guten Morgen.", "", "✨ **Was ist neu?**"];
        for (let i = 0; i < 12; i += 1) zeilen.push(punkt(i, 90));
        zeilen.push("", "🔨 **Was ist in Entwicklung?**");
        for (let i = 0; i < 12; i += 1) zeilen.push(punkt(200 + i, 90));
        zeilen.push("", DISCORD_SCHLUSS);
        const text = zeilen.join("\n");
        const teile = teileBericht(text, 700)!;
        expect(teile.length).toBeGreaterThan(3);
        for (const teil of teile) expect(teil.length).toBeLessThanOrEqual(700);
        expect(teile.flatMap(punktzeilen)).toEqual(punktzeilen(text));
        for (const teil of teile.slice(1)) {
            const erste = teil.split("\n")[0]!;
            expect(["✨ **Was ist neu?**", "🔨 **Was ist in Entwicklung?**"]).toContain(erste);
        }
        expect(teile.at(-1)!.endsWith(DISCORD_SCHLUSS)).toBe(true);
    });

    it("ein einzelner Punkt, der allein nicht passt, wird an Satzgrenzen gekürzt, nie mitten im Satz", () => {
        const satz = "Dieser Satz ist ganz.";
        const zuLang = `• ${Array.from({ length: 12 }, () => satz).join(" ")}`;
        const text = [TITEL, GRUSS, "", "✨ **Was ist neu?**", zuLang, "", DISCORD_SCHLUSS].join("\n");
        const teile = teileBericht(text, 120)!;
        for (const teil of teile) expect(teil.length).toBeLessThanOrEqual(120);
        const kurz = punktzeilen(teile.join("\n"))[0]!;
        expect(kurz.endsWith(satz)).toBe(true);
        expect(kurz.length).toBeLessThan(zuLang.length);
    });

    it("🔴 nicht teilbar ist `null`: Punkte schon im Kopfabsatz, ein Kopf über der Grenze, ein Absatz ohne Punkte über der Grenze", () => {
        const lang = bericht({ neu: 30, fehler: 0, entwicklung: 0, bugs: 0, ideen: 0, dank: true });
        const imKopf = lang.replace(`${GRUSS}\n\n✨`, `${GRUSS}\n✨`);
        expect(teileBericht(imKopf)).toBeNull();
        const langerKopf = lang.replace(GRUSS, `${GRUSS} ${"Sehr lang. ".repeat(250)}`);
        expect(teileBericht(langerKopf)).toBeNull();
        const langerBlock = lang.replace(
            "🔨 **Was ist in Entwicklung?** (noch nicht auf avesmaps.de)\nSeit",
            `🔨 **Was ist in Entwicklung?**\n${"Ein langer Satz ohne Punkt. ".repeat(100)}\nSeit`,
        );
        expect(teileBericht(langerBlock)).toBeNull();
    });

    it("🔴 Zufallsberichte (fester Samen): in jeder Form und Größe bleibt jeder Punkt einmal und ganz, in der Reihenfolge; jede Nachricht hält die Grenze; keine endet auf eine Überschrift", () => {
        let zustand = 12345;
        const zufall = (n: number): number => {
            zustand = (zustand * 1103515245 + 12345) % 2147483648;
            return zustand % n;
        };
        const ueberschrift = /^(?:🗺️|🛠️|🐞|✨|🔨|💬|💡) \*\*/u;
        for (let lauf = 0; lauf < 150; lauf += 1) {
            const zeilen = [TITEL, GRUSS, ""];
            const teile = 1 + zufall(3);
            for (let t = 0; t < teile; t += 1) {
                zeilen.push(`✨ **Teil ${String(t)}**`);
                const bereiche = 1 + zufall(3);
                for (let b = 0; b < bereiche; b += 1) {
                    if (zufall(4) > 0) zeilen.push(`🗺️ **Bereich ${String(b)}**`);
                    const punkte = 1 + zufall(14);
                    for (let p = 0; p < punkte; p += 1) {
                        zeilen.push(punkt(t * 1000 + b * 100 + p, 20 + zufall(260)));
                    }
                }
                if (zufall(3) === 0) zeilen.push("Ein Satz hinter den Punkten.");
                zeilen.push("");
            }
            zeilen.push("https://avesmaps.de", "", ...(zufall(2) === 0 ? DANK : []), DISCORD_SCHLUSS);
            const text = zeilen.join("\n");
            const grenze = 400 + zufall(1600);
            const geteilt = teileBericht(text, grenze);
            // Passt ein einzelner Punkt samt Überschriften nie in die Grenze, ist `null` oder gekürzt erlaubt; sonst gilt alles andere.
            if (geteilt === null) continue;
            for (const nachricht of geteilt) expect(nachricht.length).toBeLessThanOrEqual(grenze);
            const punkteVorher = punktzeilen(text);
            const punkteNachher = geteilt.flatMap(punktzeilen);
            if (punkteNachher.length === punkteVorher.length && punkteNachher.every((z, i) => z === punkteVorher[i])) {
                // Alles ganz: dann stimmt auch die Folge der Nachrichten.
            } else {
                // Nur ein einzelner, zu langer Punkt darf gekürzt sein (an einer Satzgrenze, er endet als Satz).
                expect(punkteNachher).toHaveLength(punkteVorher.length);
                punkteNachher.forEach((z, i) => {
                    if (z !== punkteVorher[i])
                        expect(punkteVorher[i]!.startsWith(z.replace(/…$/u, "").trimEnd())).toBe(true);
                });
            }
            expect(geteilt[0]!.startsWith(`${TITEL}\n${GRUSS}`)).toBe(true);
            expect(geteilt.at(-1)!.endsWith(DISCORD_SCHLUSS)).toBe(true);
            expect(geteilt.slice(0, -1).join("\n")).not.toContain(DISCORD_SCHLUSS);
            for (const nachricht of geteilt) {
                const nz = nachricht.split("\n");
                // Eine Nachricht endet nie auf eine Überschrift, und keine beginnt mit einer Leerzeile.
                expect(ueberschrift.test(nz.at(-1)!) && !nz.at(-1)!.startsWith("🚀")).toBe(false);
                expect(nz[0]).not.toBe("");
            }
        }
    });

    it("die Vorschau trennt die Nachrichten sichtbar", () => {
        expect(["a", "b"].join(NACHRICHTEN_TRENNER)).toBe("a\n\n— nächste Nachricht —\n\nb");
    });
});

describe("Discord-Bericht: Prüfung der Nachrichten", () => {
    const ok = (teile: string[]) => pruefeTeile(teile, "2026-10-25", "geheim.SCHLUESSEL.abcdefghijklmnop");
    const erste = `${TITEL}\n${GRUSS}\n\n✨ **Was ist neu?**\n• Wege zeigen ihre Steigung.`;
    const mitte = "✨ **Was ist neu?**\n• Orte zeigen ihr Wappen.";
    const letzte = `✨ **Was ist neu?**\n• Die Suche findet Flüsse.\n\nhttps://avesmaps.de\n\n${DISCORD_SCHLUSS}`;

    it("🔴 drei Nachrichten mit Kopf vorn und Schluss hinten bestehen; eine einzelne wie bisher", () => {
        expect(ok([erste, mitte, letzte])).toEqual({ ok: true, fehler: [] });
        expect(ok([`${TITEL}\nHallo.\n\n${DISCORD_SCHLUSS}`]).ok).toBe(true);
    });

    it("🔴 jede Nachricht für sich: Länge, Ping, Kennung, Commit, fremder Verweis und Schlüssel in einer MITTLEREN Nachricht fallen auf", () => {
        const zuLang = `${mitte}\n${"x".repeat(DISCORD_INHALT_MAX)}`;
        expect(ok([erste, zuLang, letzte]).fehler).toEqual([
            `zu lang: Nachricht 2: ${String(zuLang.length)} von ${String(DISCORD_INHALT_MAX)} Zeichen`,
        ]);
        expect(ok([erste, `${mitte}\n<@123456789012345678>`, letzte]).fehler).toEqual([
            "Nachricht 2: Erwähnung (Ping) im Text",
        ]);
        expect(ok([erste, `${mitte}\naus WI-0128`, letzte]).fehler).toEqual(["Nachricht 2: interne Kennung im Text"]);
        expect(ok([erste, `${mitte}\nStand 3ab71b9`, letzte]).fehler).toEqual(["Nachricht 2: Commit-Kennung im Text"]);
        expect(ok([erste, `${mitte}\nhttps://stage.avesmaps.de/x`, letzte]).ok).toBe(false);
        expect(ok([erste, `${mitte}\ngeheim.SCHLUESSEL.abcdefghijklmnop`, letzte]).fehler).toEqual([
            "Nachricht 2: Geheimnis im Text",
        ]);
    });

    it("🔴 der Kopf gehört in die erste, der Schluss in die letzte Nachricht; mehr als die Höchstzahl ist rot", () => {
        expect(ok([mitte, letzte]).fehler).toEqual(["Kopf mit dem Berichtstag fehlt"]);
        expect(ok([erste, mitte]).fehler).toEqual([`Schluss „${DISCORD_SCHLUSS}“ fehlt`]);
        const viele = [erste, ...Array.from({ length: DISCORD_BERICHT_TEILE_MAX - 1 }, () => mitte), letzte];
        expect(viele).toHaveLength(DISCORD_BERICHT_TEILE_MAX + 1);
        expect(ok(viele).fehler).toEqual([
            `zu viele Nachrichten: ${String(DISCORD_BERICHT_TEILE_MAX + 1)} von ${String(DISCORD_BERICHT_TEILE_MAX)}`,
        ]);
        expect(ok([]).fehler).toContain("kein Text");
    });
});

describe("Discord-Bericht: ganze Sätze und Texte von Nutzern", () => {
    it("Sätze erkennen: Kürzel, Ordnungszahlen und Zahlen beenden keinen Satz", () => {
        expect(saetzeVon("Das geht z. B. so. Und dann? Ja! Am 3. Oktober gilt es ca. 5 Tage. Ende")).toEqual([
            "Das geht z. B. so.",
            "Und dann?",
            "Ja!",
            "Am 3. Oktober gilt es ca. 5 Tage.",
            "Ende",
        ]);
        expect(saetzeVon("Ohne Satzzeichen")).toEqual(["Ohne Satzzeichen"]);
        expect(saetzeVon("")).toEqual([]);
    });

    it("Satzende: ein Abbruch auf „…“, „...“, Komma oder Wort ist keines", () => {
        for (const ganz of [
            "Es geht.",
            "Geht es?",
            "Es geht!",
            "Er sagt „es geht.“",
            "Es geht (endlich).",
            "Es geht. 🛠️",
        ]) {
            expect(endetAlsSatz(ganz)).toBe(true);
        }
        for (const bruch of ["Es geht und lassen sich…", "Es geht ...", "Es geht,", "Es geht und", "", "Es geht:"]) {
            expect(endetAlsSatz(bruch)).toBe(false);
        }
    });

    it("🔴 `satzKuerze` kürzt nur auf ganze Sätze und gibt nichts zurück, wenn schon der erste nicht passt", () => {
        const text = "Der erste Satz ist kurz. Der zweite Satz ist ein wenig länger. Der dritte Satz endet hier.";
        expect(satzKuerze(text, 200)).toBe(text);
        expect(satzKuerze(text, 70)).toBe("Der erste Satz ist kurz. Der zweite Satz ist ein wenig länger.");
        expect(satzKuerze(text, 30)).toBe("Der erste Satz ist kurz.");
        expect(satzKuerze(text, 10)).toBe("");
        expect(satzKuerze("Ein Satz ohne Ende, der zu lang ist für die Grenze hier", 20)).toBe("");
    });

    it("`ersteSaetze` nimmt höchstens zwei ganze Sätze; passt der erste nicht, wird er am Wortende gekürzt", () => {
        const text = "Erster Satz. Zweiter Satz. Dritter Satz.";
        expect(ersteSaetze(text, 2, 280)).toBe("Erster Satz. Zweiter Satz.");
        expect(ersteSaetze(text, 1, 280)).toBe("Erster Satz.");
        expect(ersteSaetze(text, 2, 14)).toBe("Erster Satz.");
        expect(ersteSaetze("Ein sehr langer erster Satz ohne Ende hier", 2, 20)).toBe("Ein sehr langer…");
    });

    it("🔴 `nutzerText` macht Text von Nutzern öffentlich unschädlich: keine Erwähnung, kein Markdown, kein Verweis, eine Zeile, begrenzt", () => {
        const heikel =
            "# Gross **fett** __unter__ ~~weg~~ `code` ||Spoiler|| @everyone @here <@123456789012345678> <@&987654321098765432> <#111111111111111111> " +
            "[Klick](https://boese.de) discord.gg/abc www.beispiel.de <:emoji:123456789012345678>\nZweite\tZeile‮";
        const rein = nutzerText(heikel, 400);
        expect(rein).not.toMatch(/[*_~`|>@\n\t‮]|<|https?:|\.de|discord\.gg|everyone|here\b/iu);
        expect(rein).toContain("Gross");
        expect(rein).toContain("fett");
        expect(rein).toContain("Klick");
        expect(rein).toContain("Zweite Zeile");
        expect(nutzerText("x".repeat(500), 100).length).toBeLessThanOrEqual(100);
        // Die Platzhalter, die beim Speichern an die Stelle einer Erwähnung treten, fallen im öffentlichen Post weg.
        expect(nutzerText("Der Weg @Person nach #Kanal fehlt, sagt @Rolle", 100)).toBe("Der Weg nach fehlt, sagt");
        // Am Zeilenanfang würde Discord daraus eine Überschrift oder Liste machen.
        expect(nutzerText("# Titel", 100)).toBe("Titel");
        expect(nutzerText("- Eintrag", 100)).toBe("Eintrag");
        expect(nutzerText("1. Eintrag", 100)).toBe("Eintrag");
        // Die Umlaute der Person bleiben, wie sie sie schrieb.
        expect(nutzerText("Flaechen oeffnen Übergänge", 100)).toBe("Flaechen oeffnen Übergänge");
    });
});
