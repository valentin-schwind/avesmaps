// Ein Ersatz für `scripts/dev/release-abholer.ts` in den Routentests des Release-Tests (WI-0248 L): antwortet aus `zustand.json` neben dieser Datei
// und schreibt jeden Aufruf (Argumente und die NAMEN der Umgebungsvariablen) nach `aufrufe.jsonl`. Es startet nie einen echten Test.
//
// Er steht für den heutigen Starter: Seine Vorprüfung trägt die Zeichen `startvermerk`, `freigabe` (WI-0248) und `volltest` (WI-0264), solange `zustand.trocken` sie nicht
// selbst setzt; `--freigeben` und `--freigabe-beenden` schreiben (`zustand.freigeben`, `zustand.beenden`), `--bericht` liest (`zustand.bericht`).
import { appendFileSync, readFileSync } from "node:fs";
import process from "node:process";
import { setTimeout } from "node:timers";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ordner = dirname(fileURLToPath(import.meta.url));
const argumente = process.argv.slice(2);
appendFileSync(join(ordner, "aufrufe.jsonl"), `${JSON.stringify({ argumente, umgebung: Object.keys(process.env) })}\n`);
const zustand = JSON.parse(readFileSync(join(ordner, "zustand.json"), "utf8"));
const geschrieben = { status: "geschrieben", grund: "Notiz geschrieben", freigabe: true };
const mitZeichen = (wert) =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert)
        ? { startvermerk: true, freigabe: true, volltest: true, ...wert }
        : wert;
const antwort = argumente.includes("--freigeben")
    ? (zustand.freigeben ?? geschrieben)
    : argumente.includes("--freigabe-beenden")
      ? (zustand.beenden ?? geschrieben)
      : argumente.includes("--bericht")
        ? (zustand.bericht ?? { status: "kein-bericht", grund: "Es gibt noch keinen Lauf." })
        : argumente.includes("--kandidat")
          ? zustand.kandidat
          : argumente.includes("--abbrechen")
            ? zustand.abbrechen
            : argumente.includes("--stand")
              ? zustand.stand
              : argumente.includes("--trocken")
                ? mitZeichen(zustand.trocken)
                : zustand.start;
// Der echte Start dauert Minuten; die Verzögerung stellt nach, dass die Route früher antwortet.
const verzoegerung =
    argumente.includes("--commit") && !argumente.includes("--trocken") ? (zustand.startVerzoegerungMs ?? 0) : 0;
setTimeout(() => process.stdout.write(`${JSON.stringify(antwort)}\n`), verzoegerung);
