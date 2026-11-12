import {
    WAIT_REASONS,
    wirksamePause,
    type JobsConfig,
    type WaitReason,
    type WarteschlangePause,
    type WarteschlangeUmgebung,
} from "@avesmaps3d/shared";
import { compareCandidates, decideAdmission, type AdmissionCandidate, type AdmissionRunning } from "../admission.ts";
import { isEditorJob } from "../editor-freeze.ts";
import { JOB_KIND_CATALOG, claimsSlot, expectedMemoryMb, threadsFor } from "../kinds.ts";
import type { JobRow } from "../rows.ts";

/**
 * Die Planung des Dirigenten (WI-0163 §1, §5.3): ALLE Schlangen des Hosts zusammen in EINE Entscheidung. Reine Funktion, ohne
 * Datenbank und ohne Uhr; was sie braucht, kommt als Eingabe (`quelle.ts` liest, `dirigent.ts` startet).
 *
 * Die Zulassung selbst bleibt `decideAdmission` (`admission.ts`), dieselbe Rechnung wie im Worker bis WI-0163. Hier wird nur
 * zusammengeführt:
 *
 * - **Kennungen** sind nur mit der Umgebung eindeutig (Stage und Production zählen je ab 1). Die Zulassung bekommt synthetische
 *   Kennungen, nach Umgebung und Nummer vergeben, damit der letzte Gleichstand (`compareCandidates`) von Takt zu Takt derselbe ist.
 * - 🔴 **Bereichssperren gelten je Umgebung.** Dieselbe Kartendomäne in Stage und Production ist nicht derselbe Bereich: Die
 *   Domäne wird mit der Umgebung qualifiziert (`staging:aventuria`), und `scopesOverlap` trennt sie von selbst.
 * - 🔴 **Speicher, Threads, Parallelität und die Marke `rollout` gelten für den Host**: Es ist EIN Rechner, ein Profil
 *   (`JOBS_PROFILE`, auf dem VPS `staging`). Ein Rollout in einer Umgebung bremst alle.
 * - **Ein Schwerer zur Zeit** (`istSchwer`, §1.5): von den schweren Aufträgen läuft auf dem Host höchstens einer.
 * - **Halt der Editor-Jobs je Umgebung**: unter Kartensperre oder im eingeschränkten Betrieb warten nur die Editor-Jobs DIESER
 *   Umgebung (`editorJobsHeld` gilt für alle, deshalb trägt nur ein Kandidat aus einer haltenden Umgebung `editor: true`).
 * - **Pause**: wirksam ist die jüngste Anweisung über alle Umgebungen (`wirksamePause`). Pausiert startet nichts, und jeder
 *   wartende Auftrag wartet mit `waits_queue_paused`; Laufendes läuft zu Ende.
 * - **Gestartet, aber noch nicht als `RUNNING` gelesen**, zählt als laufend: Sonst startete der nächste Takt ihn doppelt, und ein
 *   zweiter Schwerer käme an ihm vorbei.
 * - **Zurückgestellt** (der Ausführer lehnte ab: Exit 3 `waits_executor`, Exit 75 `waits_domain_lock`): Der Auftrag wartet bis zum
 *   Ablauf und behält dabei seinen Platz im Bereich. Er geht als Kandidat mit `notBefore` = Ablauf in die Zulassung, damit ein
 *   späterer Auftrag im selben Bereich ihn nicht überholt; der Grund im Stand ist der der Rückstellung.
 *
 * Eine Umgebung, in der dieser Dirigent die Planersperre nicht hält (`planer: false`, etwa solange ein alter Worker sie hat),
 * wird nicht geplant: Ihre wartenden Aufträge stehen mit dem Grund aus ihrer Tafel in der Reihe, ihre laufenden zählen auf dem
 * Host mit. Eine nicht erreichbare Umgebung trägt nur ihre letzte Pause-Anweisung und die Aufträge bei, die dieser Dirigent dort
 * selbst gestartet hat und die noch laufen.
 */

/**
 * Die leichten Arten (WI-0163 §1.5; der Betreiber hat „Kleine nebenher“ am 2026-10-15 mit dem Plan abgenommen: „Ja, bau die
 * gemeinsame Warteschlange wie vorgeschlagen.“). Sie dürfen neben einem schweren Auftrag laufen, solange Speicher, Threads und
 * Parallelität des Profils es zulassen. Sonst wartete eine hochgeladene Bildvorschau hinter einem Legacy-Zug von 20 Minuten.
 *
 * - `media_derive`, `media_settle`, `kanal_bild`: ein Bild rendern (rund 100 bis 500 MB, ein Thread);
 * - `media_quarantine`: Umbenennungen im Dateisystem, kein Rendern;
 * - `routing_reload`: beobachtet nur, ob der Routenrechner neu geladen hat;
 * - `probe`: das Messwerkzeug der Warteschlange;
 * - `community_mail_versand`: eine ausgehende Mail der Community senden (WI-0268 C6a);
 * - `community_mail_abruf`: das Postfach der Community lesend abholen (WI-0268 C6b);
 * - `social_senden`: einen Beitrag des Social Hubs an einen fremden Kanal senden oder dort zurücknehmen (WI-0268 C12a).
 * - `benachrichtigung`: eine Meldung verschicken (etwa „Neu auf Production“; Betreiberentscheidung, sie läuft über die
 *   Warteschlange). Ein kurzer Versand ohne Rechnen; hinter einem Legacy-Zug zu warten, hieße eine verspätete Meldung.
 * - `path_label_runs`, `path_profile`: die Folgen einer Wege-Operation (WI-0177; Claudio 2026-10-18, gemessen auf der Stage: 136 und
 *   346 MB, unter 1 und 4 s, je ein Thread). Hinter dem Gelände (jede Flächenspeicherung, 4 bis 5 min) zeigte ein umbenannter Weg sonst
 *   minutenlang den alten Namen. Neben einem Gelände mit drei Threads trägt sie das CPU-Budget der Stage (4, Claudio 2026-10-19
 *   Weg A); eine zweite leichte Ein-Thread-Art wartet dann (3 + 1 + 1 > 4).
 * - `territory_derive`: die Ableitung der Herrschaftsgebiete (WI-0229; Claudio 2026-10-19, gemessen auf der Stage: 46 bis 51 s, 120 MB,
 *   1 s CPU im Jobprozess, die Rechnung liegt in PostgreSQL). Leicht unter zwei Bedingungen: Die Ableitung rechnet ohne parallele Worker
 *   (`max_parallel_workers_per_gather = 0` in ihrer Transaktion, sonst belegte eine Abfrage bis zu drei Kerne), und sie läuft nie neben
 *   der Kopie von Production oder dem vollen Import, die die Gebietstafeln neu schreiben (`exclusivePairs` im Profil).
 *
 * - `wiki_dump_einlesen`, `wiki_vorschau`: das lesende Fundament des WikiSync (WI-0253 B-1, C). Sie streamen eine Datei im Dump-Ordner und
 *   rechnen ohne Netz; die Vorschau liest dazu die Zuordnungen und Felder der Karte (ein paar Abfragen, keine Sperre) und legt ihren Lauf ab
 *   (zwei eigene Protokolltafeln, keine Fachtafel). Gemessen an einem synthetischen Dump (250.000 Seiten, 287 MB entpackt): rund 3 s und 75 MB mehr
 *   Arbeitsspeicher für das Lesen; die Messung des echten Dumps samt `bzip2` liefert Claudio nach.
 *
 * - `wiki_artikel`: der Vergleich eines einzelnen Artikels (WI-0253 D-2): genau eine Anfrage im Takt, ein Plan über eine Handvoll Objekte, ein Satz in einer eigenen Tafel; er wartet fast nur.
 *
 * - `sprache_treffer`: die Treffer der Sprachen (WI-0261 S4; Claudio 2026-10-30 §3). Leicht, weil der übliche Lauf eine Sprache (nach dem Speichern
 *   einer Sprachfläche) oder eine Handvoll Objekte (nach einer Operation an der Karte) rechnet, in Millisekunden bis wenigen Sekunden, und die Rechnung
 *   in PostgreSQL liegt (der Jobprozess hält keine Geometrie, ohne parallele Worker wie `territory_derive`). Auch der volle Lauf nach einem Import
 *   bleibt lokal unter 10 s. Nie neben der Kopie von Production und dem vollen Import (`exclusivePairs` im Profil), die Orte, Wege und Flächen neu
 *   schreiben.
 *
 * - `land_smooth`, `label_runs`: die Folgen einer gespeicherten Landschaft (WI-0283; Claudio 2026-11-06, gemessen in Production: rechnen 3 und 1 s, warteten
 *   aber im Median 6,5 und 11 Minuten hinter der Geländekette). Sie schreiben nur `region_area_smooth` und `landscape_label_run`, die das Gelände nicht liest.
 *
 * - **Schwer bleiben `wiki_uebernehmen` und `wiki_zuruecknehmen`** (WI-0253 D-1): Sie schreiben die Fachtafeln eines Bereichs (Orte, Wege, Gebiete, Landschaften, Kraftlinien) und
 *   die Operation an der Karte; `exclusivePairs` im Profil hält sie auch von der leichten Gebietsableitung fern.
 *
 * 🔴 **Alles andere ist schwer**, ausdrücklich auch eine Art, die dieses Release nicht kennt („die Queue rät nie“), und
 * aufgezeichnete Abläufe wie `import` (der tägliche Zug, `legacy:update`): Sie laufen auf dem Host einer nach dem anderen, über
 * alle Umgebungen. Dies ist die einzige Liste; die Stand-Datei trägt das Ergebnis als `schwer`.
 */
export const LEICHTE_ARTEN: ReadonlySet<string> = new Set([
    "media_derive",
    "media_settle",
    // „Vorschau erzeugen“ (WI-0287 Punkt 5): ein Bild der Rasterpipeline wie der Abgleich, danach eine Zeile und ein eingereihter Abgleich. Hinter einem Legacy-Zug zu
    // warten, hieße eine Vorschau, die erst nach Minuten erscheint. Der Wrapper `avesmaps3d-auftrag` muss sie in `leicht()` und `app_art()` kennen (Handover an Claudio).
    "citymap_preview_generate",
    "kanal_bild",
    "media_quarantine",
    // Der Sammellauf der Duplikate: nur kurze Transaktionen, keine Rasterarbeit (Claudio 2026-10-17).
    "media_merge_all",
    "routing_reload",
    "probe",
    "benachrichtigung",
    // Eine ausgehende Mail der Community (WI-0268 C6a): ein Aufruf des Mailservers und ein paar Zeilen in der Datenbank, kein Rechnen. Hinter einem Legacy-Zug zu warten, hieße eine Antwort, die erst nach
    // Minuten hinausgeht.
    "community_mail_versand",
    // Der Abruf des Postfachs (WI-0268 C6b): ein Aufruf des Mailservers, höchstens 50 Mails (eine zur Zeit im Speicher) und ein paar Zeilen in der Datenbank. Kein Rechnen auf der Karte; hinter einem Legacy-Zug zu warten,
    // hieße, dass eine neue Anfrage erst nach Minuten im Eingang steht.
    "community_mail_abruf",
    // Das Senden an einen fremden Kanal (WI-0268 C12a): ein bis zwei Aufrufe der Instanz, ein Bild zum Lesen und ein paar Zeilen in der Datenbank. Kein Rechnen; hinter einem Legacy-Zug zu warten, hieße einen Beitrag, der
    // erst nach Minuten erscheint.
    "social_senden",
    "path_label_runs",
    "path_profile",
    "territory_derive",
    "wiki_dump_einlesen",
    "wiki_vorschau",
    "wiki_artikel",
    "sprache_treffer",
    "land_smooth",
    "label_runs",
]);

export function istSchwer(kind: string): boolean {
    return !LEICHTE_ARTEN.has(kind);
}

/** Die letzte Pause-Anweisung EINER Umgebung, wie `wirksamePause` sie nimmt. */
export type PauseAnweisung = Omit<WarteschlangePause, "umgebung">;

/** Was `quelle.ts` in einem Takt aus einer Umgebung liest. */
export interface QuelleLage {
    umgebung: WarteschlangeUmgebung;
    /** Konnte die Umgebung in diesem Takt gelesen werden? Sonst sind die Listen leer. */
    erreichbar: boolean;
    /** Hält dieser Dirigent ihre Planersperre? Nur dann startet er dort etwas. */
    planer: boolean;
    queued: readonly JobRow[];
    running: readonly JobRow[];
    /** Wartende Aufträge, deren Vorgänger noch nicht `SUCCEEDED` sind. */
    offeneAbhaengigkeiten: ReadonlySet<number>;
    /** p95 der Spitze RSS der letzten Läufe je Art (MB), für die Arten, die aus dem Verlauf lernen. */
    rssVerlauf: Readonly<Record<string, number>>;
    rolloutAktiv: boolean;
    /** Warten die Editor-Jobs dieser Umgebung (Kartensperre, eingeschränkter Betrieb, Zustand unbekannt)? */
    editorHalt: boolean;
    /** Die letzte Anweisung dieser Umgebung; `null`: keine (nie geschaltet, oder die Spalten fehlen). */
    pause: PauseAnweisung | null;
    /**
     * Die Anzeigenamen der Personen, die die Aufträge dieser Umgebung ausgelöst haben (`person.id` klein geschrieben, WI-0293). Leer
     * oder fehlend, wenn die Leserolle sie nicht lesen darf.
     */
    namen?: ReadonlyMap<string, string>;
    /** Warum sie nicht lesbar war (nur fürs Log). */
    fehler?: unknown;
}

/** Ein Auftrag, den dieser Dirigent gestartet hat und dessen Ausführer noch läuft: Er zählt als laufend. */
export interface Gestartet {
    umgebung: WarteschlangeUmgebung;
    id: number;
    publicId: string;
    kind: string;
    mapDomainId: string;
    scopeKind: "domain" | "tiles";
    scopeTiles: readonly number[];
    memExpectedMb: number | null;
    threads: number | null;
    /** Der Versuch beim Start: Steht die Zeile danach unverändert da, hat der Ausführer sie nicht übernommen. */
    attempt: number;
}

export type RueckstellGrund = Extract<WaitReason, "waits_executor" | "waits_domain_lock" | "waits_memory">;

/** Ein Auftrag, den der Ausführer zuletzt abgelehnt hat: Er wartet bis `bisMs`, dann versucht der Dirigent es neu. */
export interface Rueckstellung {
    umgebung: WarteschlangeUmgebung;
    id: number;
    grund: RueckstellGrund;
    bisMs: number;
}

export interface PlanEingabe {
    nowMs: number;
    /** Das Profil des HOSTS (`JOBS_PROFILE`). */
    config: JobsConfig;
    /** `MemAvailable` des Hosts (MB); `null`: kein Messwert. */
    memAvailableMb: number | null;
    quellen: readonly QuelleLage[];
    gestartet: readonly Gestartet[];
    rueckstellungen: readonly Rueckstellung[];
    /**
     * Nur mit dem Ausführer `lokal` (`ABGLEICHE`, `abgleiche/ausfuehrung.ts`): Arten, die der Dirigent nicht startet. Eine Art aus
     * `abholung` wartet mit `waits_pickup` (Claudios Abholer holt sie), jede andere mit `waits_no_worker`.
     */
    uebersprungen?: ReadonlySet<string>;
    abholung?: ReadonlySet<string>;
    /**
     * Nur mit dem Ausführer `lokal`: Kennt der eigene Katalog Art und Fassung (`knowsKind`)? Der lokale Ausführer ist derselbe
     * Stand, er könnte eine fremde Art nicht ausführen; sie wartet mit `waits_no_worker`. 🔴 Mit `sudo` fehlt die Prüfung: Der Wrapper
     * und der Ausführer der Umgebung kennen eine Art vielleicht, die dieser Stand nicht kennt (die Stage ist neuer als Production,
     * der Dirigent läuft aus dem Stage-Stand). Im Plan gilt eine unbekannte Art als schwer und läuft allein.
     */
    kenntArt?: (kind: string, version: number) => boolean;
}

/** Ein Auftrag in der gemeinsamen Reihe, wie `stand.ts` ihn in die Datei schreibt. */
export interface ReiheEintrag {
    umgebung: WarteschlangeUmgebung;
    job: JobRow;
    /** Platz unter den wartenden (1 = als Nächstes dran); `null` für laufende. */
    platz: number | null;
    /** `null` bei laufenden und bei denen, die gerade gestartet werden. */
    wartegrund: WaitReason | null;
    schwer: boolean;
}

export interface Plan {
    pause: WarteschlangePause;
    /** In der Reihenfolge, in der sie starten. */
    starts: Gestartet[];
    /** Laufende zuerst (nach Beginn), dann die wartenden nach `platz`. */
    reihe: ReiheEintrag[];
}

const schluessel = (umgebung: WarteschlangeUmgebung, id: number): string => `${umgebung}#${String(id)}`;

/** Die Kartendomäne, mit der Umgebung qualifiziert: Bereichssperren gelten je Umgebung. */
const bereich = (umgebung: WarteschlangeUmgebung, mapDomainId: string): string => `${umgebung}:${mapDomainId}`;

const BEKANNTE_GRUENDE: ReadonlySet<string> = new Set(WAIT_REASONS);

/** Der Grund aus der Tafel einer Umgebung, die ein anderer plant; einen Freitext (`stage_rollout`) trägt der Stand nicht. */
function bekannterGrund(reason: string | null): WaitReason | null {
    return reason !== null && BEKANNTE_GRUENDE.has(reason) ? (reason as WaitReason) : null;
}

export function plane(eingabe: PlanEingabe): Plan {
    const { config, nowMs } = eingabe;
    const uebersprungen = eingabe.uebersprungen ?? new Set<string>();
    const abholung = eingabe.abholung ?? new Set<string>();
    const kenntArt = eingabe.kenntArt ?? (() => true);
    const erreichbar = eingabe.quellen.filter((quelle) => quelle.erreichbar);
    const pause = wirksamePause(
        eingabe.quellen.flatMap((quelle) =>
            quelle.pause === null ? [] : [{ ...quelle.pause, umgebung: quelle.umgebung }],
        ),
    );

    // Synthetische Kennungen, nach Umgebung (in der Reihenfolge der Konfiguration) und Nummer vergeben.
    const rang = new Map(eingabe.quellen.map((quelle, index) => [quelle.umgebung, index]));
    const alle: { umgebung: WarteschlangeUmgebung; id: number }[] = [];
    for (const quelle of erreichbar) {
        for (const job of [...quelle.queued, ...quelle.running]) alle.push({ umgebung: quelle.umgebung, id: job.id });
    }
    for (const eintrag of eingabe.gestartet) alle.push({ umgebung: eintrag.umgebung, id: eintrag.id });
    alle.sort((a, b) => (rang.get(a.umgebung) ?? 0) - (rang.get(b.umgebung) ?? 0) || a.id - b.id);
    const kennungen = new Map<string, number>();
    for (const eintrag of alle) {
        const key = schluessel(eintrag.umgebung, eintrag.id);
        if (!kennungen.has(key)) kennungen.set(key, kennungen.size + 1);
    }
    const kennung = (umgebung: WarteschlangeUmgebung, id: number): number =>
        kennungen.get(schluessel(umgebung, id)) ?? 0;

    // Was läuft, auf dem ganzen Host: die gelesenen `RUNNING` aller Umgebungen (nur mit Bedarf, `claimsSlot`, wie im Worker)
    // und was dieser Dirigent gestartet hat, aber noch nicht als `RUNNING` gelesen ist.
    const running: AdmissionRunning[] = [];
    const alsLaufendGelesen = new Set<string>();
    for (const quelle of erreichbar) {
        for (const job of quelle.running) {
            alsLaufendGelesen.add(schluessel(quelle.umgebung, job.id));
            if (!claimsSlot(job.kind)) continue;
            const spec = JOB_KIND_CATALOG[job.kind];
            running.push({
                id: kennung(quelle.umgebung, job.id),
                kind: job.kind,
                mapDomainId: bereich(quelle.umgebung, job.mapDomainId),
                scopeKind: job.scopeKind,
                scopeTiles: job.scopeTiles,
                memExpectedMb:
                    job.memExpectedMb ?? (spec ? expectedMemoryMb(spec, job.inputRef, job.phase, config, null) : null),
                threads: spec ? threadsFor(spec, config) : null,
            });
        }
    }
    const gestartet = new Set<string>();
    for (const eintrag of eingabe.gestartet) {
        const key = schluessel(eintrag.umgebung, eintrag.id);
        gestartet.add(key);
        if (alsLaufendGelesen.has(key)) continue;
        running.push({
            id: kennung(eintrag.umgebung, eintrag.id),
            kind: eintrag.kind,
            mapDomainId: bereich(eintrag.umgebung, eintrag.mapDomainId),
            scopeKind: eintrag.scopeKind,
            scopeTiles: eintrag.scopeTiles,
            memExpectedMb: eintrag.memExpectedMb,
            threads: eintrag.threads,
        });
    }

    const zurueckgestellt = new Map<string, Rueckstellung>();
    for (const rueckstellung of eingabe.rueckstellungen) {
        if (rueckstellung.bisMs > nowMs)
            zurueckgestellt.set(schluessel(rueckstellung.umgebung, rueckstellung.id), rueckstellung);
    }

    // Die wartenden aller erreichbaren Umgebungen; Kandidaten der Zulassung nur, wo dieser Dirigent plant.
    const wartende = new Map<number, { quelle: QuelleLage; job: JobRow }>();
    const kandidaten: AdmissionCandidate[] = [];
    const planbar = (quelle: QuelleLage, job: JobRow): boolean =>
        quelle.planer &&
        job.origin === "queued" &&
        !gestartet.has(schluessel(quelle.umgebung, job.id)) &&
        !uebersprungen.has(job.kind) &&
        kenntArt(job.kind, job.kindVersion);
    for (const quelle of erreichbar) {
        for (const job of quelle.queued) {
            const id = kennung(quelle.umgebung, job.id);
            wartende.set(id, { quelle, job });
            if (!planbar(quelle, job)) continue;
            const spec = JOB_KIND_CATALOG[job.kind];
            const bis = zurueckgestellt.get(schluessel(quelle.umgebung, job.id))?.bisMs ?? null;
            const notBefore = job.notBefore?.getTime() ?? null;
            kandidaten.push({
                id,
                kind: job.kind,
                mapDomainId: bereich(quelle.umgebung, job.mapDomainId),
                scopeKind: job.scopeKind,
                scopeTiles: job.scopeTiles,
                priority: job.priority,
                queuedAtMs: job.queuedAt.getTime(),
                notBeforeMs: notBefore === null ? bis : bis === null ? notBefore : Math.max(notBefore, bis),
                memExpectedMb: spec
                    ? expectedMemoryMb(spec, job.inputRef, null, config, quelle.rssVerlauf[job.kind] ?? null)
                    : null,
                threads: spec ? threadsFor(spec, config) : null,
                dependenciesDone: !quelle.offeneAbhaengigkeiten.has(job.id),
                editor: quelle.editorHalt && isEditorJob(job.actorRef, job.kind),
            });
        }
    }

    const entscheidung = pause.paused
        ? null
        : decideAdmission({
              nowMs,
              queued: kandidaten,
              running,
              config,
              memAvailableMb: eingabe.memAvailableMb,
              rolloutActive: erreichbar.some((quelle) => quelle.rolloutAktiv),
              // Der Halt gilt je Umgebung: Nur Kandidaten einer haltenden Umgebung tragen `editor: true` (oben).
              editorJobsHeld: true,
              isHeavy: istSchwer,
          });

    const starts: Gestartet[] = [];
    for (const kandidat of entscheidung?.admitted ?? []) {
        const zeile = wartende.get(kandidat.id);
        if (zeile === undefined) continue;
        const { quelle, job } = zeile;
        starts.push({
            umgebung: quelle.umgebung,
            id: job.id,
            publicId: job.publicId,
            kind: job.kind,
            mapDomainId: job.mapDomainId,
            scopeKind: job.scopeKind,
            scopeTiles: job.scopeTiles,
            memExpectedMb: kandidat.memExpectedMb,
            threads: kandidat.threads,
            attempt: job.attempt,
        });
    }
    const startend = new Set(starts.map((eintrag) => schluessel(eintrag.umgebung, eintrag.id)));

    const wartegrund = (id: number, quelle: QuelleLage, job: JobRow): WaitReason | null => {
        const key = schluessel(quelle.umgebung, job.id);
        // Eine Umgebung, die ein anderer plant: der Grund, den er geschrieben hat.
        if (!quelle.planer || job.origin !== "queued") return bekannterGrund(job.waitReason);
        if (gestartet.has(key) || startend.has(key)) return null;
        if (pause.paused) return "waits_queue_paused";
        if (abholung.has(job.kind)) return "waits_pickup";
        if (uebersprungen.has(job.kind) || !kenntArt(job.kind, job.kindVersion)) return "waits_no_worker";
        const entschieden = entscheidung?.waiting.get(id) ?? null;
        // Ein gehaltener Editor-Job sagt das, auch wenn der Ausführer ihn eben zurückgegeben hat (Rückstellung „unverändert“).
        if (entschieden === "waits_system_lock") return entschieden;
        const rueckstellung = zurueckgestellt.get(key);
        if (rueckstellung !== undefined) return rueckstellung.grund;
        return entschieden;
    };

    const laufend: ReiheEintrag[] = erreichbar
        .flatMap((quelle) =>
            quelle.running.map((job) => ({
                umgebung: quelle.umgebung,
                job,
                platz: null,
                wartegrund: null,
                schwer: istSchwer(job.kind),
            })),
        )
        .sort(
            (a, b) =>
                (a.job.startedAt?.getTime() ?? Number.POSITIVE_INFINITY) -
                    (b.job.startedAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
                kennung(a.umgebung, a.job.id) - kennung(b.umgebung, b.job.id),
        );
    // Ein angekündigter Lauf (Herkunft `recorded`, noch `QUEUED`: die Production-Freigabe vor der Abholung, WI-0248) steht in der Reihe, belegt
    // aber keinen Platz: Ihn startet nicht der Dirigent, und er hält niemanden auf. Er kommt nach den Wartenden, ohne Platz.
    let platz = 0;
    const reihe = [...wartende.entries()]
        .map(([id, zeile]) => ({ id, priority: zeile.job.priority, queuedAtMs: zeile.job.queuedAt.getTime(), zeile }))
        .sort(
            (a, b) =>
                Number(a.zeile.job.origin !== "queued") - Number(b.zeile.job.origin !== "queued") ||
                compareCandidates(a, b),
        )
        .map((eintrag): ReiheEintrag => ({
            umgebung: eintrag.zeile.quelle.umgebung,
            job: eintrag.zeile.job,
            platz: eintrag.zeile.job.origin === "queued" ? (platz += 1) : null,
            wartegrund: wartegrund(eintrag.id, eintrag.zeile.quelle, eintrag.zeile.job),
            schwer: istSchwer(eintrag.zeile.job.kind),
        }));
    return { pause, starts, reihe: [...laufend, ...reihe] };
}
