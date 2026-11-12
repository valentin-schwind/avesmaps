/**
 * Die Jobart der Herrschaftsgebiete (WI-0209 B3): eingereiht von der Schreibnaht (`editor/map-operation.ts`), gerechnet in
 * `jobs/gebietsableitung-job.ts`. Eine eigene kleine Datei, damit die Schreibnaht die Rechnung nicht mitlädt.
 */
export const TERRITORY_DERIVE_JOB_KIND = "territory_derive";

/**
 * Unter diesem Schlüssel steht die Dauer der Teilläufe, in der Geschichte und im Profil (WI-0283): Sie brauchen Sekunden, ein voller Lauf rund eine Minute. Unter
 * `territory_derive` stehen alle übrigen Läufe, auch die von vor dem Teillauf; die rechneten ebenso die ganze Domäne.
 */
export const GEBIETS_TEILLAUF_DAUER = "territory_derive:teil";

/**
 * Gleitend gesammelt (WI-0229, Migration 0203 `job_sammeln`; Hauptorchestrierung 2026-10-19 „A, gleitend wie beim Gelände“, Claudio
 * 2026-10-19 „120 s bleiben die Obergrenze, Ruhe 10 s“): Jede Speicherung schiebt den Start auf jetzt + Ruhe, höchstens auf die Obergrenze
 * ab der ersten Speicherung. Vorher fest 120 s ab der ersten (Claudio 2026-10-17); eine einzelne Speicherung stand so erst nach drei Minuten
 * auf der Karte (Betreiberfund 2026-10-19).
 */
export const GEBIETSABLEITUNG_RUHE_S = 10;
export const GEBIETSABLEITUNG_HOECHSTENS_S = 120;
