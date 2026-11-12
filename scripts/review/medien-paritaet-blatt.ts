import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { MediaStore } from "../../apps/server/src/media/storage.ts";
import { LEGACY_BEDINGUNG, type GruppenErgebnis, type ParitaetsBericht } from "./medien-paritaet.ts";

/**
 * Das Blatt für den Betreiber (MEDIA-M11): je Klasse EIN Referenzfall nebeneinander — was Legacy zeigt, was wir zeigen,
 * darunter die Paritätsklasse. Hell und dunkel, echte Größe, ein PNG.
 *
 * 🔴 Die linke Spalte ist das PRIVATE Original (byte-gleich Legacys Datei); es hat keine öffentliche Adresse und
 * erscheint nur auf diesem Blatt, auf diesem Rechner. `review/` ist in `.gitignore`: das Blatt wird nie committed.
 *
 * 🔴 Nichts wird abgerufen. Beide Spalten kommen aus `MEDIA_ROOT` auf der Platte.
 */

const KLASSENFARBE: Readonly<Record<string, string>> = {
    IDENTICAL: "--gleich",
    WITHIN_TOLERANCE: "--gleich",
    EXPECTED_CHANGE: "--gewollt",
    UNDECIDED: "--offen",
    UNEXPECTED_DIFFERENCE: "--fehler",
};

/** Eine Datei aus dem Medienspeicher als `data:`-Adresse; `null`, wenn sie fehlt oder zu groß ist. */
async function alsDatenAdresse(store: MediaStore, key: string | null, mime: string | null): Promise<string | null> {
    if (key === null) return null;
    try {
        const bytes = await store.read(key, 8 * 1024 * 1024);
        // Ein SVG bleibt privates Quellartefakt: es wird auf dem Blatt nicht gerendert (media.yaml, kein öffentliches SVG).
        const typ = mime === null || mime === "image/svg+xml" ? null : mime;
        if (typ === null) return null;
        return `data:${typ};base64,${bytes.toString("base64")}`;
    } catch {
        return null;
    }
}

const schutz = (text: string): string =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function bildFeld(adresse: string | null, breite: number | null, hoehe: number | null, leerText: string): string {
    if (adresse === null) return `<div class="leer">${schutz(leerText)}</div>`;
    const masse =
        breite !== null && hoehe !== null ? ` width="${String(breite)}" height="${String(hoehe)}"` : ' class="frei"';
    return `<img src="${adresse}" alt=""${masse}>`;
}

/**
 * Die Zeilen des Blattes: je Klasse EINE, aber eine Klasse mit auseinanderfallenden Gruppen behält ihre Gruppen.
 * Die Kartenvorschau zerfällt genau so (363 widerrufen gegen 4 ohne Regel) — ein zusammengefasster Schnitt verschwiege es.
 */
function blattZeilen(bericht: ParitaetsBericht): GruppenErgebnis[] {
    const zeilen: GruppenErgebnis[] = [];
    const klassen = [...new Set(bericht.gruppen.map((g) => g.media_class))];
    for (const klasse of klassen) {
        const gruppen = bericht.gruppen.filter((g) => g.media_class === klasse);
        if (gruppen.every((g) => g.klasse === "IDENTICAL") && gruppen.length > 1) {
            // Alle Gruppen der Klasse stimmen: EINE Zeile mit der Summe, Referenz die Gruppe mit dem meisten Bestand.
            const groesste = [...gruppen].sort((a, b) => b.legacy_zeigt - a.legacy_zeigt)[0];
            if (groesste === undefined) continue;
            zeilen.push({
                ...groesste,
                schluessel: `${klasse} (alle ${String(gruppen.length)} Herkünfte)`,
                origin: gruppen.map((g) => g.origin).join(", "),
                legacy_rights_code: [...new Set(gruppen.map((g) => g.legacy_rights_code))].join(", "),
                legacy_zeigt: gruppen.reduce((n, g) => n + g.legacy_zeigt, 0),
                wir_zeigen: gruppen.reduce((n, g) => n + g.wir_zeigen, 0),
            });
            continue;
        }
        zeilen.push(...gruppen);
    }
    return zeilen;
}

async function zeile(gruppe: GruppenErgebnis, store: MediaStore): Promise<string> {
    const referenz = gruppe.referenz;
    if (referenz === undefined) return "";
    const unserBild =
        referenz.url === null
            ? null
            : await alsDatenAdresse(store, `published/${referenz.url.replace(/^\/media\//, "")}`, "image/webp");
    // Bei Gleichstand ist unsere Datei dasselbe Werk wie Legacys: EIN Bild sagt alles, zwei wären eine Dopplung.
    // Weicht es ab, zeigt die linke Spalte das private Original — nur so sieht der Betreiber, worüber er entscheidet.
    const legacyBild =
        unserBild !== null ? null : await alsDatenAdresse(store, referenz.quelle_key, referenz.quelle_mime);
    const bedingung = LEGACY_BEDINGUNG[gruppe.media_class];
    const token = KLASSENFARBE[gruppe.klasse] ?? "--offen";

    const paar =
        unserBild !== null
            ? `<figure>
          <figcaption>Legacy zeigt <span class="zahl">${String(gruppe.legacy_zeigt)}</span> · Avesmaps3D zeigt <span class="zahl">${String(gruppe.wir_zeigen)}</span> — dieselbe Datei, echte Größe</figcaption>
          ${bildFeld(unserBild, referenz.breite, referenz.hoehe, "zeigt nichts")}
        </figure>`
            : `<figure>
          <figcaption>Legacy zeigt <span class="zahl">${String(gruppe.legacy_zeigt)}</span> — privates Original</figcaption>
          ${bildFeld(legacyBild, null, null, "kein Bild auf der Platte")}
        </figure>
        <figure>
          <figcaption>Avesmaps3D zeigt <span class="zahl">${String(gruppe.wir_zeigen)}</span></figcaption>
          <div class="leer">zeigt nichts</div>
        </figure>`;

    return `
    <section class="fall">
      <header>
        <h2>${schutz(gruppe.media_class)} <span class="herkunft">${schutz(gruppe.origin)} · ${schutz(gruppe.legacy_rights_code)}</span></h2>
        <p class="referenz">Referenzfall: <strong>${schutz(referenz.name)}</strong></p>
      </header>
      <div class="paar">${paar}</div>
      <p class="klasse" data-token="${token}"><span>${schutz(gruppe.klasse)}</span></p>
      <p class="grund">${schutz(gruppe.grund)}</p>
      ${bedingung ? `<p class="beleg"><em>Legacy:</em> ${schutz(bedingung.satz)}<br><code>${schutz(bedingung.fundstelle)}</code></p>` : ""}
    </section>`;
}

const STIL = `
  :root {
    --grund: #fbfaf7; --schrift: #1c1a17; --leise: #6b6459; --linie: #ddd7cc; --feld: #ffffff;
    --gleich: #2f7a4f; --gewollt: #8a6a1f; --offen: #1f5f8a; --fehler: #9b2c2c;
  }
  .dunkel {
    --grund: #16171a; --schrift: #ece9e3; --leise: #9a948a; --linie: #34363b; --feld: #1f2125;
    --gleich: #6cc08c; --gewollt: #d7b05a; --offen: #74b6e0; --fehler: #e38b8b;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
  .tafel { background: var(--grund); color: var(--schrift); padding: 28px 32px 36px; }
  .kopf { border-bottom: 2px solid var(--linie); padding-bottom: 14px; margin-bottom: 22px; }
  .kopf h1 { margin: 0 0 6px; font-size: 21px; letter-spacing: .01em; }
  .kopf p { margin: 2px 0; color: var(--leise); font-size: 13px; }
  .bilanz { margin: 0 0 22px; font-size: 14px; }
  .bilanz strong { font-variant-numeric: tabular-nums; }
  .fall { border: 1px solid var(--linie); border-radius: 10px; background: var(--feld); padding: 16px 18px; margin-bottom: 16px; }
  .fall header { margin-bottom: 12px; }
  .fall h2 { margin: 0; font-size: 16px; font-weight: 650; }
  .herkunft { color: var(--leise); font-weight: 400; font-size: 13px; }
  .referenz { margin: 4px 0 0; font-size: 13px; color: var(--leise); }
  .paar { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap; }
  .paar figure { margin: 0; }
  .paar figcaption { font-size: 12px; color: var(--leise); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .06em; }
  .zahl { font-variant-numeric: tabular-nums; color: var(--schrift); font-weight: 650; }
  .paar img { display: block; max-width: 760px; height: auto; border: 1px solid var(--linie); border-radius: 4px; background: #00000008; }
  .paar img.frei { max-height: 620px; width: auto; }
  .leer { width: 220px; height: 124px; border: 1px dashed var(--linie); border-radius: 4px; display: flex;
          align-items: center; justify-content: center; color: var(--leise); font-size: 13px; font-style: italic; }
  .klasse { margin: 14px 0 6px; }
  .klasse span { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700;
                 letter-spacing: .05em; color: var(--grund); }
  .klasse[data-token="--gleich"] span { background: var(--gleich); }
  .klasse[data-token="--gewollt"] span { background: var(--gewollt); }
  .klasse[data-token="--offen"] span { background: var(--offen); }
  .klasse[data-token="--fehler"] span { background: var(--fehler); }
  .grund { margin: 0 0 8px; font-size: 14px; max-width: 86ch; }
  .beleg { margin: 0; font-size: 12.5px; color: var(--leise); max-width: 92ch; }
  .beleg code { font-size: 11.5px; }
  .befunde { border-top: 2px solid var(--linie); margin-top: 20px; padding-top: 14px; }
  .befunde h3 { margin: 0 0 8px; font-size: 15px; }
  .befunde li { font-size: 13.5px; margin-bottom: 5px; max-width: 92ch; }
`;

/** Das Blatt bauen und als PNG ablegen. Gibt den Pfad des Blattes zurück. */
export async function baueBlatt(bericht: ParitaetsBericht, mediaRoot: string, ziel: string): Promise<string> {
    const store = new MediaStore(mediaRoot);
    const faelle: string[] = [];
    for (const gruppe of blattZeilen(bericht)) faelle.push(await zeile(gruppe, store));

    const regeln = bericht.regeln
        .map((r) => `${r.rights_basis}/${r.role} ${r.revoked_on === null ? "gilt" : `widerrufen ${r.revoked_on}`}`)
        .join(" · ");
    const befunde =
        bericht.befunde.length === 0
            ? ""
            : `<div class="befunde"><h3>Befunde</h3><ul>${bericht.befunde
                  .map((b) => `<li><strong>${schutz(b.code)}</strong>: ${schutz(b.text)}</li>`)
                  .join("")}</ul></div>`;

    const tafel = (dunkel: boolean): string => `
    <div class="tafel${dunkel ? " dunkel" : ""}">
      <div class="kopf">
        <h1>Medien-Paritätsreview — je Klasse ein Referenzfall${dunkel ? " (dunkel)" : " (hell)"}</h1>
        <p>Satz ${schutz(bericht.media_revision)} · Legacy-Seite: Legacys Export A, ${String(bericht.legacy_eintraege)} gezeigte Medien · eigene Seite: gemessen durch den echten Lesepfad</p>
        <p>Freigaberegeln: ${schutz(regeln)}</p>
      </div>
      <p class="bilanz">Legacy zeigt <strong>${String(bericht.summe.legacy_zeigt)}</strong> Medien, Avesmaps3D zeigt <strong>${String(bericht.summe.wir_zeigen)}</strong>. Die linke Spalte ist das private Original — byte-gleich Legacys Datei, ohne öffentliche Adresse.</p>
      ${faelle.join("")}
      ${befunde}
    </div>`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><style>${STIL}</style></head>
    <body>${tafel(false)}${tafel(true)}</body></html>`;

    const pfad = resolve(ziel);
    await mkdir(dirname(pfad), { recursive: true });
    await writeFile(pfad.replace(/\.png$/, ".html"), html, "utf8");

    const browser = await chromium.launch();
    try {
        const seite = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1.5 });
        // Alle Bilder stecken als `data:`-Adressen im Dokument und die Schrift ist eine des Systems: nach `load`
        // ist nichts mehr unterwegs, es gibt keine Anfrage, auf die zu warten waere.
        await seite.setContent(html, { waitUntil: "load" });
        await seite.screenshot({ path: pfad, fullPage: true });
    } finally {
        await browser.close();
    }
    return pfad;
}
