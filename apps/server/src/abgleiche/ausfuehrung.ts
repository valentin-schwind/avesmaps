import {
    ABGLEICH_AUSFUEHRUNGEN,
    ABGLEICH_JOBARTEN,
    ABGLEICH_KATEGORIE,
    ABGLEICH_KATEGORIE_QUELLE,
    ABGLEICH_QUELLEN,
    LEGACY_ZUG_KATEGORIEN,
    abgleichNimmtAuftraege,
    istLegacyZugKategorie,
    type LegacyZugKategorie,
    type AbgleichAusfuehrung,
    type AbgleichAusfuehrungen,
    type AbgleichQuelle,
} from "@avesmaps3d/shared";

/**
 * Wie diese Instanz Aufträge der Abgleiche ausführt (`ABGLEICHE`, WI-0127 SYS-14 §13.4 Nr. 6, Stage-Anbindung SYS-14b):
 *
 * - `worker`: der Worker der Warteschlange rechnet den Auftrag gegen die eigene Datenbank (Vorgabe auf dem Entwicklungsrechner).
 * - `korridor`: Claudios Abholer übernimmt ihn über `job_sync_claim` (Migration 0098) und spielt über den Korridor ein, wie „zieh mal“;
 *   der Worker lässt ihn liegen und schreibt „wartet auf Abholung“ (Claudio 2026-10-10, `handovers/2026-10-10-abgleiche-stage-antwort.md`,
 *   Option A).
 * - `kategorien`: nur für `legacy` (Production, WI-0141): Die Gesamtzeile steht `aus`, die drei Kategoriezeilen gehen — lokal über
 *   den Worker, mit einem Release über den Korridor. Betreiber 2026-10-13: „jede kategorie einzeln (also unterkategorien ohne
 *   dass man alles ziehen darf)“.
 * - `aus`: niemand nimmt ihn an, der Knopf steht gesperrt mit Satz.
 * - `verborgen` (WI-0144): wie `aus`, und die Zeile steht gar nicht in der Liste.
 *
 * Ein Wert gilt für alle Quellen (`ABGLEICHE=korridor`), oder je Quelle (`ABGLEICHE=legacy:kategorien,medien:aus`; eine nicht genannte
 * Quelle ist `aus`). 🔴 Ohne Wert `aus`, außer auf dem Entwicklungsrechner (`RELEASE_ID` fehlt oder ist `dev`, wie `MAP_EDITING` und die
 * Statusseite). Ein anderer Wert hält den Start an wie ein ungültiger `PORT`.
 *
 * 🪤 **Die drei Kategoriezeilen nennt der Wert nie selbst.** Sie hängen allein an `legacy:kategorien`; jeder andere Wert lässt sie
 * `aus`. So gibt es genau EINEN Schalter für den Zug, Stage bleibt mit `legacy:korridor` unverändert (ganzer Zug, dazu der
 * Ortseditor in der Testwelt), und nur die Umgebung, die der Betreiber dafür schaltet, trägt die drei Knöpfe.
 *
 * 🪤 **`production` ist verborgen, solange der Wert sie nicht nennt** (WI-0144) — anders als jede andere Quelle, die ungenannt
 * `aus` ist und damit gesperrt DASTEHT. Der Betreiber hat am 2026-10-14 entschieden: „Und in Production lassen wir das mal so wie
 * jetzt.“ Wäre die Vorgabe `aus`, trüge Production mit diesem Release sofort eine neue gesperrte Zeile — genau die Änderung, die
 * ausgeschlossen ist. So braucht **keine** bestehende Umgebung einen neuen Wert; die Zeile erscheint allein dort, wo sie
 * ausdrücklich gewollt ist.
 */
export function abgleicheModes(environment: NodeJS.ProcessEnv): AbgleichAusfuehrungen {
    const lokal = (environment["RELEASE_ID"] ?? "dev") === "dev";
    const value = (environment["ABGLEICHE"] ?? "").trim();
    if (value === "") return abgeleitet(alle(lokal ? "worker" : "aus"), null, lokal, false);
    if (!value.includes(":")) return abgeleitet(alle(modus(value, value, null)), null, lokal, false);
    const modes: Record<AbgleichQuelle, AbgleichAusfuehrung> = { ...alle("aus") };
    let offen: readonly LegacyZugKategorie[] | null = null;
    let productionGenannt = false;
    for (const part of value.split(",")) {
        const [quelle, mode] = part.split(":").map((entry) => entry.trim());
        if (quelle === undefined || !(ABGLEICH_QUELLEN as readonly string[]).includes(quelle) || mode === undefined) {
            throw new Error(`ABGLEICHE: "${part}" ist keine Angabe <quelle>:<modus> (${ABGLEICH_QUELLEN.join(", ")})`);
        }
        const [wert, liste] = mode.split("=").map((entry) => entry.trim());
        modes[quelle as AbgleichQuelle] = modus(wert ?? "", value, quelle as AbgleichQuelle);
        if (quelle === "production") productionGenannt = true;
        if (liste !== undefined) offen = kategorienListe(liste, wert ?? "", value);
    }
    return abgeleitet(modes, offen, lokal, productionGenannt);
}

/**
 * Die Kategorien hinter `kategorien=…`, mit `+` getrennt: `kategorien=wege+orte`. Eine leere oder unbekannte Angabe hält den
 * Start an — ein Tippfehler darf keinen Knopf still sperren, den der Betreiber offen haben wollte.
 */
function kategorienListe(liste: string, wert: string, whole: string): readonly LegacyZugKategorie[] {
    if (wert !== "kategorien") {
        throw new Error(
            `ABGLEICHE: eine Kategorieliste gibt es nur bei "kategorien" (ABGLEICHE=legacy:kategorien=wege+orte): ${whole}`,
        );
    }
    const namen = liste
        .split("+")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
    if (namen.length === 0) {
        throw new Error(
            `ABGLEICHE: "kategorien=" ohne Kategorie; nenne sie mit + getrennt (${LEGACY_ZUG_KATEGORIEN.join(", ")}): ${whole}`,
        );
    }
    for (const name of namen) {
        if (!istLegacyZugKategorie(name)) {
            throw new Error(
                `ABGLEICHE: "${name}" ist keine Kategorie des Zugs (${LEGACY_ZUG_KATEGORIEN.join(", ")}): ${whole}`,
            );
        }
    }
    return namen as LegacyZugKategorie[];
}

function alle(mode: AbgleichAusfuehrung): AbgleichAusfuehrungen {
    return Object.fromEntries(ABGLEICH_QUELLEN.map((quelle) => [quelle, mode])) as AbgleichAusfuehrungen;
}

/**
 * Die abgeleiteten Zeilen setzen: die drei Kategorien aus `legacy`, und wo der Production-Zug steht.
 *
 * **Kategorien.** 🔴 Sie gehen NUR mit `legacy:kategorien`, und dann steht die Gesamtzeile `aus`: Genau das heißt „jede kategorie
 * einzeln, ohne dass man alles ziehen darf“ (Betreiber 2026-10-13). Jeder andere Wert lässt die drei Zeilen `aus` — auch
 * `korridor`. So bleibt Stage, was es ist (ein ganzer Zug über den Korridor, dazu der Ortseditor in der Testwelt), und nur die
 * Umgebung, die der Betreiber dafür schaltet, trägt die drei Knöpfe.
 *
 * Wer sie ausführt, ist dieselbe Frage wie überall: lokal der Worker, mit einem Release Claudios Abholer.
 *
 * `offen` nennt die Kategorien, deren Weg ganz steht (`kategorien=wege+orte`). Eine ungenannte bekommt `noch_nicht`: Ihr Knopf
 * steht gesperrt mit eigenem Satz da, statt gedrückt zu werden und erst dann „geht nicht“ zu antworten (Betreiberregel
 * 2026-10-13, Claudios Befund vom ersten Knopfdruck um 20:27). `null` heißt: alle drei, wie bisher.
 *
 * **Production-Zug** (WI-0144, Betreiber 2026-10-14). Zwei Ableitungen:
 *
 * 1. Nennt der Wert die Quelle nicht (`productionGenannt === false`, also auch ein Gesamtwert wie `ABGLEICHE=korridor` und der
 *    leere Wert lokal), ist sie `verborgen`. Keine bestehende Umgebung ändert sich dadurch.
 * 2. Zieht eine Umgebung von Production (`production:korridor`), sind Legacy, die drei Kategorien und die Medien dort
 *    **verborgen** — „für die stage ist production die einzige wahrheit“. Das ist derselbe Satz des Betreibers, nur im Code statt
 *    in drei Umgebungswerten, die auseinanderlaufen können. Claudio setzt auf der Stage deshalb nur `ABGLEICHE=production:korridor`.
 */
function abgeleitet(
    modes: AbgleichAusfuehrungen,
    offen: readonly LegacyZugKategorie[] | null,
    lokal: boolean,
    productionGenannt: boolean,
): AbgleichAusfuehrungen {
    const ganz = modes.legacy;
    const laeuft: AbgleichAusfuehrung = lokal ? "worker" : "korridor";
    const resolved: Record<AbgleichQuelle, AbgleichAusfuehrung> = {
        ...modes,
        legacy: ganz === "kategorien" ? "aus" : ganz,
        production: productionGenannt ? modes.production : "verborgen",
    };
    for (const kategorie of LEGACY_ZUG_KATEGORIEN) {
        const quelle = ABGLEICH_KATEGORIE_QUELLE[kategorie];
        if (ganz !== "kategorien") resolved[quelle] = "aus";
        else resolved[quelle] = offen === null || offen.includes(kategorie) ? laeuft : "noch_nicht";
    }
    if (abgleichNimmtAuftraege(resolved.production)) {
        for (const quelle of ABGLEICH_QUELLEN) {
            if (quelle !== "production") resolved[quelle] = "verborgen";
        }
    }
    return resolved;
}

function modus(value: string, whole: string, quelle: AbgleichQuelle | null): AbgleichAusfuehrung {
    if (!(ABGLEICH_AUSFUEHRUNGEN as readonly string[]).includes(value)) {
        throw new Error(`ABGLEICHE must be ${ABGLEICH_AUSFUEHRUNGEN.map((mode) => `"${mode}"`).join(", ")}: ${whole}`);
    }
    // `noch_nicht` entsteht nur aus einer Kategorieliste; niemand schreibt es in die Umgebung.
    if (value === "noch_nicht") {
        throw new Error(
            `ABGLEICHE: "noch_nicht" wird nicht gesetzt, es entsteht aus einer Kategorieliste (ABGLEICHE=legacy:kategorien=wege+orte): ${whole}`,
        );
    }
    // `kategorien` ist eine Aussage über den Zug, nicht über die Medien und nicht über alle Quellen zugleich.
    if (value === "kategorien" && quelle !== "legacy") {
        throw new Error(
            `ABGLEICHE: "kategorien" gilt nur für die Quelle legacy (ABGLEICHE=legacy:kategorien): ${whole}`,
        );
    }
    // 🔴 Den Production-Zug kann kein Worker rechnen: Er liest Production über den Korridor, und dafür gibt es in der
    //    Anwendung keinen Weg (`production_pull` hat bewusst keinen Handler). Ein `worker` hier wäre ein Knopf, der nichts
    //    hält — der Start sagt es, statt ihn anzubieten.
    if (quelle === "production" && value === "worker") {
        throw new Error(
            `ABGLEICHE: "production" läuft nur über den Korridor (production:korridor) — ein Worker kann Production nicht lesen: ${whole}`,
        );
    }
    if (quelle !== null && ABGLEICH_KATEGORIE[quelle] !== null) {
        throw new Error(
            `ABGLEICHE: "${quelle}" wird nicht einzeln gesetzt, es folgt der Quelle legacy (ABGLEICHE=legacy:kategorien): ${whole}`,
        );
    }
    return value as AbgleichAusfuehrung;
}

/**
 * Die Ausführung einer Quelle; ein einzelner Wert (Tests, ältere Konfiguration) gilt für alle, ohne Angabe `aus`.
 *
 * 🔴 Ausgenommen `production` (WI-0144): Der Production-Zug geht NUR an, wo die Umgebung ihn namentlich nennt — dieselbe Regel
 * wie in `abgleicheModes`. Ein pauschaler Wert (`ABGLEICHE=worker`, `abgleiche: "korridor"` in einem Test) soll ihn nicht
 * nebenbei öffnen; dort gibt es kein Production zum Lesen.
 */
export function ausfuehrungFuer(
    setting: AbgleichAusfuehrung | AbgleichAusfuehrungen | undefined,
    quelle: AbgleichQuelle,
): AbgleichAusfuehrung {
    if (setting === undefined) return "aus";
    if (typeof setting !== "string") return setting[quelle];
    return quelle === "production" ? "verborgen" : setting;
}

const kinds = (modes: AbgleichAusfuehrungen, test: (mode: AbgleichAusfuehrung) => boolean): ReadonlySet<string> =>
    new Set(ABGLEICH_QUELLEN.filter((quelle) => test(modes[quelle])).map((quelle) => ABGLEICH_JOBARTEN[quelle]));

/**
 * Die Jobarten, die ein Worker bei dieser Ausführung NICHT annimmt: Er lässt ihre Zeilen unberührt wie eine Art, die er nicht kennt
 * (JOBS-0001 4.4). So holt auf Stage kein Worker einen Zug ab, den er nicht schreiben darf.
 */
export function skippedJobKinds(modes: AbgleichAusfuehrungen): ReadonlySet<string> {
    return kinds(modes, (mode) => mode !== "worker");
}

/** Die Jobarten, die Claudios Abholer übernimmt: Der Worker schreibt ihnen den Wartegrund `waits_pickup`. */
export function pickupJobKinds(modes: AbgleichAusfuehrungen): ReadonlySet<string> {
    return kinds(modes, (mode) => mode === "korridor");
}
