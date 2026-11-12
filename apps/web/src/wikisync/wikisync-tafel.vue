<script setup lang="ts">
/**
 * Die Tafel der Bereiche und der EINE Knopf „WikiSync starten“ (WI-0253 §20, „Variante A“; Entwurf `review/wi-0253/wikisync-ablauf-mockup.html`, Vali 2026-10-26: „ich finde den workflow etwas
 * kompliziert. erst hol ich die vorschau, dann den bericht, im bericht stell ich von legacy auf wiki sync um, wikisync starten geht net gleich …“). Seit dem Cutoff 2026-11-02 gibt es die Quelle nicht mehr:
 * Jeder Bereich mit angeschlossener Übernahme gehört fest dem WikiSync (Betreiber: „die spalte fällt weg, es gibt keinen schalter mehr“).
 *
 * - **Eine Tafel, ein Ort für alles:** je Bereich das Häkchen, der Stand der letzten Übernahme und der Ablauf. Der Knopf liest den
 *   Dump und, für Orte, Herrschaftsgebiete und Derographie, die Kategorien-Datei daneben (die Vorschau) und übernimmt, in dieser Reihenfolge und nach EINER Bestätigung (WI-0294: Es gibt keinen Wiki-Teil
 *   im 20-Sekunden-Takt mehr). Fehlt die Kategorien-Datei, warten diese drei Bereiche, die übrigen laufen normal; liegen Dump und Kategorien-Datei mehr als 14 Tage auseinander, steht ein Hinweis
 *   da (kein Halt). Den Rest verkettet der Server aus den vorhandenen Aufträgen (`POST …/uebernehmen` mit `ablauf`).
 * - **Der Ablauf einer Zeile** kommt aus dem, was die Seite ohnehin liest (`wikisync-ablauf.ts`): im Plan zwei wartende Schritte (Dump, Übernahme), im Lauf der Fortschritt, danach das Ergebnis.
 * - **Ein Bereich ohne angeschlossene Übernahme** ist nicht wählbar; die Zeile sagt, dass es für ihn noch keine Übernahme gibt.
 * - **Rechte** (Vali 2026-10-25): einzelne Bereiche ab Editor, „Alle“ nur Admins, beides mit Passkey; jedes gesperrte Element nennt seinen Grund.
 */
import { computed, ref, watch } from "vue";
import {
    WIKISYNC_BEREICHE,
    type WikisyncBereich,
    type WikisyncBereichStand,
    type WikisyncStand,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import type { Wikisync } from "./wikisync";
import {
    frageSatz,
    laufAktiv,
    laufLage,
    laufSchritte,
    planHinweise,
    planSatz,
    planSchritte,
    bereichImLauf,
    quellenStand,
    standSpalte,
    startPlan,
    type AblaufDaten,
    type Schritt,
} from "./wikisync-ablauf";
import WikisyncInfo from "./wikisync-info.vue";
import { bereichName, umgebungKurz } from "./wikisync-text";

export interface TafelRechte {
    bereiche: boolean;
    alle: boolean;
}

const props = defineProps<{
    wikisync: Wikisync;
    stand: WikisyncStand;
    jetzt: Date;
    telefon: boolean;
    umgebung: string;
    darf: TafelRechte;
    rechtSatz: (recht: string) => string;
}>();

const ws = props.wikisync;

const daten = computed((): AblaufDaten | null =>
    ws.bereiche.value === null ? null : { stand: props.stand, bereiche: ws.bereiche.value },
);
const aktiv = computed(() => daten.value !== null && laufAktiv(daten.value));
const lage = computed(() => (daten.value === null ? null : laufLage(daten.value, props.jetzt)));

// ── Die Wahl ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Wählbar ist, was dem WikiSync gehört: jeder Bereich, dessen Übernahme angeschlossen ist. */
const waehlbar = computed((): WikisyncBereich[] =>
    (ws.bereiche.value?.bereiche ?? []).filter((stand) => stand.angeschlossen).map((stand) => stand.bereich),
);

/** Die Wahl: vorausgewählt alle wählbaren; neu wählbare kommen dazu, nicht mehr wählbare fallen heraus. */
const gewaehlt = ref(new Set<WikisyncBereich>());
const bekannt = new Set<WikisyncBereich>();
watch(
    waehlbar,
    (liste) => {
        const jetztWaehlbar = new Set(liste);
        const neu = new Set([...gewaehlt.value].filter((bereich) => jetztWaehlbar.has(bereich)));
        for (const bereich of jetztWaehlbar) {
            if (!bekannt.has(bereich)) neu.add(bereich);
            bekannt.add(bereich);
        }
        gewaehlt.value = neu;
    },
    { immediate: true },
);
const alleGewaehlt = computed(() => waehlbar.value.length > 0 && waehlbar.value.every((b) => gewaehlt.value.has(b)));
const unbestimmt = computed(() => gewaehlt.value.size > 0 && !alleGewaehlt.value);

/** Solange die Wahl nicht verändert wurde, zeigen die Zeilen den Stand des Laufs; wer wählt, sieht wieder den Plan. */
const zeigeLauf = ref(true);

function waehle(bereich: WikisyncBereich, an: boolean): void {
    const neu = new Set(gewaehlt.value);
    if (an) neu.add(bereich);
    else neu.delete(bereich);
    gewaehlt.value = neu;
    zeigeLauf.value = false;
    frage.value = null;
}

function waehleAlle(an: boolean): void {
    gewaehlt.value = an ? new Set(waehlbar.value) : new Set();
    zeigeLauf.value = false;
    frage.value = null;
}

const plan = computed(() => (daten.value === null ? null : startPlan(daten.value, gewaehlt.value)));
/** Die Stände von Dump und Kategorien-Datei, aus denen der nächste Lauf liest. */
const quellen = computed(() => (daten.value === null ? null : quellenStand(daten.value)));
/** Die Hinweise unter der Plan-Zeile: Kategorien-Datei fehlt, oder Dump und Kategorien liegen weit auseinander. Beides hält den Knopf nicht auf. */
const hinweise = computed(() =>
    plan.value === null || quellen.value === null ? [] : planHinweise(plan.value, quellen.value),
);

// ── Sperren ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const laeuftSatz = (): string => t("admin.wikisync.tafel.sperre.laeuft");

function kastenSperre(stand: WikisyncBereichStand): string | undefined {
    if (!stand.angeschlossen) return t("admin.wikisync.wahl.grund.nichtAngeschlossen");
    if (!props.darf.bereiche) return props.rechtSatz("run_wikisync_areas");
    if (aktiv.value || ws.busy.value !== null) return laeuftSatz();
    return undefined;
}

const alleSperre = computed((): string | undefined => {
    if (waehlbar.value.length === 0) return t("admin.wikisync.wahl.keinerWaehlbar");
    if (!props.darf.alle) return props.rechtSatz("run_wikisync_all");
    if (aktiv.value || ws.busy.value !== null) return laeuftSatz();
    return undefined;
});

function startSperre(): string | undefined {
    if (!props.darf.bereiche) return props.rechtSatz("run_wikisync_areas");
    if (aktiv.value) return "";
    if (props.stand.dump.datei === null) return t("admin.wikisync.sperre.keinDump");
    if (plan.value === null || plan.value.bereiche.length === 0)
        return t(
            waehlbar.value.length === 0 ? "admin.wikisync.wahl.keinerWaehlbar" : "admin.wikisync.sperre.keinBereich",
        );
    // Auch ohne Kategorien-Datei läuft der Start: Die Bereiche mit Kategorien warten, die übrigen laufen normal (WI-0294).
    return undefined;
}

// ── Starten ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const frage = ref<"start" | null>(null);
const sendetAlle = computed(() => props.darf.alle && alleGewaehlt.value);
const produktion = computed(() => props.umgebung === "production");

const startFolge = computed(() => {
    if (plan.value === null || quellen.value === null) return "";
    const satz = frageSatz(plan.value, quellen.value, umgebungKurz(props.umgebung));
    return produktion.value ? `${satz} ${t("admin.wikisync.start.folgeProduction")}` : satz;
});

async function starten(): Promise<void> {
    frage.value = null;
    zeigeLauf.value = true;
    const bereiche = WIKISYNC_BEREICHE.filter((bereich) => gewaehlt.value.has(bereich));
    await ws.starten(sendetAlle.value ? { alle: true, ablauf: "ganz" } : { bereiche, ablauf: "ganz" });
}

const meldung = computed(() => {
    const e = ws.ergebnis.value;
    return e !== null && e.wo === "start" ? e.result : undefined;
});

// ── Die Zeilen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface ZeileAnsicht {
    stand: WikisyncBereichStand;
    name: string;
    gewaehlt: boolean;
    kastenSperre: string | undefined;
    aus: boolean;
    spalte: { oben: string; unten: string };
    /** `null`: ein Satz statt der Schritte. */
    schritte: Schritt[] | null;
    satz: string | undefined;
}

const zeilen = computed((): ZeileAnsicht[] => {
    const d = daten.value;
    if (d === null) return [];
    return d.bereiche.bereiche.map((stand) => {
        const bereich = stand.bereich;
        const gehoertWikisync = stand.angeschlossen;
        const an = gehoertWikisync && gewaehlt.value.has(bereich);
        const imLauf = gehoertWikisync && zeigeLauf.value && bereichImLauf(d, bereich);
        let schritte: Schritt[] | null = null;
        let satz: string | undefined;
        if (!gehoertWikisync) {
            satz = t("admin.wikisync.wahl.grund.nichtAngeschlossen");
        } else if (imLauf) {
            schritte = laufSchritte(d, bereich);
        } else if (an) {
            schritte = planSchritte(d, bereich);
        } else {
            satz = t("admin.wikisync.tafel.ablauf.nichtGewaehlt");
        }
        return {
            stand,
            name: bereichName(bereich),
            gewaehlt: an,
            kastenSperre: kastenSperre(stand),
            aus: !an && !imLauf,
            spalte: standSpalte(stand, props.jetzt),
            schritte,
            satz,
        };
    });
});

const gewaehltZahl = computed(() => waehlbar.value.filter((bereich) => gewaehlt.value.has(bereich)).length);
</script>

<template>
    <div v-if="daten !== null && plan !== null && lage !== null" class="tafel" data-testid="wsync-tafel">
        <div class="tafel__raster tafel__kopf">
            <span class="tafel__alle">
                <AvmKaestchen
                    art="checkbox"
                    :checked="alleGewaehlt"
                    :unbestimmt="unbestimmt"
                    :gesperrt="alleSperre"
                    :hinweis="t('admin.wikisync.tafel.alleName')"
                    testid="wsync-wahl-alle"
                    @change="waehleAlle"
                    >{{ t("admin.wikisync.wahl.alle") }}</AvmKaestchen
                >
            </span>
            <span class="tafel__spaltenname">{{ t("admin.wikisync.tafel.kopf.stand") }}</span>
            <span class="tafel__spaltenname">{{ t("admin.wikisync.tafel.kopf.ablauf") }}</span>
        </div>

        <ul class="tafel__liste" :aria-label="t('admin.wikisync.tafel.liste')">
            <li
                v-for="zeile in zeilen"
                :key="zeile.stand.bereich"
                class="tafel__raster tafel__zeile"
                :class="{ 'tafel__zeile--aus': zeile.aus }"
                :data-bereich="zeile.stand.bereich"
                :data-testid="`wsync-zeile-${zeile.stand.bereich}`"
            >
                <span class="tafel__wahl">
                    <AvmKaestchen
                        art="checkbox"
                        :checked="zeile.gewaehlt"
                        :gesperrt="zeile.kastenSperre"
                        :hinweis="t('admin.wikisync.tafel.waehlen', { bereich: zeile.name })"
                        :testid="`wsync-wahl-${zeile.stand.bereich}`"
                        @change="(an: boolean) => waehle(zeile.stand.bereich, an)"
                        ><span class="tafel__name">{{ zeile.name }}</span></AvmKaestchen
                    >
                </span>
                <span class="tafel__stand">
                    <span class="tafel__etikett">{{ t("admin.wikisync.tafel.kopf.stand") }}</span>
                    <span>{{ zeile.spalte.oben }}</span>
                    <small>{{ zeile.spalte.unten }}</small>
                </span>
                <span class="tafel__ablauf">
                    <span class="tafel__etikett">{{ t("admin.wikisync.tafel.kopf.ablauf") }}</span>
                    <span class="ablauf">
                        <span v-if="zeile.schritte !== null" class="ablauf__schritte">
                            <span
                                v-for="schritt in zeile.schritte"
                                :key="schritt.art"
                                class="schritt"
                                :class="`schritt--${schritt.status}`"
                                :data-testid="`wsync-schritt-${zeile.stand.bereich}-${schritt.art}`"
                            >
                                <span v-if="schritt.status === 'fertig'" class="schritt__haken" aria-hidden="true"
                                    >✓</span
                                >
                                <AvmKreis
                                    v-else
                                    :fuellung="schritt.status === 'laeuft' ? 'halb' : 'leer'"
                                    :name="schritt.text"
                                />
                                <span>{{ schritt.text }}</span>
                            </span>
                        </span>
                        <span v-else>{{ zeile.satz }}</span>
                    </span>
                </span>
            </li>
        </ul>

        <div v-if="frage === 'start'" class="tafel__frage">
            <AvmBestaetigung
                :frage="t(produktion ? 'admin.wikisync.start.frageProduction' : 'admin.wikisync.start.frage')"
                :folge="startFolge"
                :bestaetigen="t('admin.wikisync.start.bestaetigen')"
                :gesperrt="ws.busy.value === null ? undefined : ''"
                testid="wsync-start-frage"
                @bestaetigen="starten()"
                @abbrechen="frage = null"
            />
        </div>
        <VerwaltungMeldung :ergebnis="meldung" testid="wsync-start-meldung" />

        <div class="tafel__fuss">
            <div class="tafel__fuss-text" aria-live="polite" data-testid="wsync-fuss">
                <template v-if="aktiv">
                    <p v-if="lage.phase === 'wartet'" class="tafel__fuss-satz">
                        <strong>{{ lage.satz }}</strong>
                    </p>
                    <p v-else class="tafel__fuss-satz">
                        <strong>{{ t("admin.wikisync.tafel.fuss.laeuft") }}</strong
                        >: {{ lage.satz }}
                    </p>
                    <p v-if="lage.leise !== null" class="tafel__fuss-satz tafel__fuss-satz--leise">{{ lage.leise }}</p>
                </template>
                <template v-else>
                    <p
                        v-if="lage.satz !== null"
                        class="tafel__fuss-satz"
                        :class="lage.ton === 'fehler' ? 'tafel__fuss-satz--fehler' : undefined"
                        data-testid="wsync-lage"
                    >
                        {{ lage.satz }}
                    </p>
                    <p class="tafel__fuss-satz">
                        <strong>{{
                            waehlbar.length === 0
                                ? t("admin.wikisync.wahl.keinerWaehlbar")
                                : t("admin.wikisync.wahl.stand", { n: gewaehltZahl, m: waehlbar.length })
                        }}</strong>
                    </p>
                    <p class="tafel__fuss-satz tafel__fuss-satz--leise" data-testid="wsync-plan">
                        {{
                            plan.bereiche.length === 0 || quellen === null
                                ? t("admin.wikisync.tafel.fuss.keinBereich")
                                : planSatz(plan, quellen)
                        }}<WikisyncInfo
                            v-if="plan.bereiche.length > 0"
                            :text="t('admin.wikisync.tafel.fuss.erklaerung')"
                        />
                    </p>
                    <p
                        v-for="hinweis in hinweise"
                        :key="hinweis"
                        class="tafel__fuss-satz tafel__fuss-satz--warnung"
                        data-testid="wsync-plan-hinweis"
                    >
                        {{ hinweis }}
                    </p>
                </template>
            </div>
            <div class="tafel__fuss-aktion">
                <AvmKnopf v-if="aktiv" art="gefuellt" gesperrt="" :breit="telefon" testid="wsync-start-knopf"
                    ><span aria-hidden="true">⇄ </span>{{ t("admin.wikisync.tafel.laeuft") }}</AvmKnopf
                >
                <AvmKnopf
                    v-else
                    art="gefuellt"
                    :gesperrt="frage === 'start' ? undefined : startSperre()"
                    :breit="telefon"
                    :aria-expanded="frage === 'start'"
                    testid="wsync-start-knopf"
                    @click="frage = frage === 'start' ? null : 'start'"
                    ><span aria-hidden="true">⇄ </span>{{ t("admin.wikisync.start.knopf") }}</AvmKnopf
                >
            </div>
        </div>
    </div>
</template>

<style scoped>
/* Die Tafel der Bereiche: ein Raster, keine <table> (Guide §13.15) */
.tafel {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.tafel__liste {
    margin: 0;
    padding: 0;
    list-style: none;
}

.tafel__raster {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(0, 180px) minmax(0, 150px) minmax(0, 1fr);
    column-gap: var(--space-10);
    align-items: center;
    padding: var(--space-6) var(--space-10);
}

.tafel__kopf {
    padding-block: var(--space-4);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.tafel__kopf :deep(.kaestchen) {
    color: var(--color-text);
    font-size: var(--font-size-small);
    letter-spacing: 0;
    text-transform: none;
}

.tafel__zeile {
    border-bottom: 1px solid var(--color-divider);
    font-variant-numeric: tabular-nums;
}

.tafel__zeile:last-child {
    border-bottom: 0;
}

.tafel__zeile > * {
    min-width: 0;
}

.tafel__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.tafel__zeile--aus .tafel__name {
    color: var(--color-text-muted);
}

.tafel__etikett {
    display: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.tafel__stand {
    display: flex;
    flex-direction: column;
    gap: 1px;
    color: var(--color-text);
}

.tafel__stand small {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.tafel__zeile--aus .tafel__stand {
    color: var(--color-text-muted);
}

.tafel__ablauf {
    color: var(--color-text-muted);
}

/* Der Ablauf einer Zeile: Plan vor dem Start, Fortschritt im Lauf, Ergebnis danach. Eine Spalte statt vier Orte. */
.ablauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
}

.ablauf__schritte {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
}

.schritt {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
}

.schritt--laeuft {
    color: var(--color-text-strong);
}

.schritt--fertig {
    color: var(--color-success-soft-text);
}

.schritt--fehler {
    color: var(--color-danger-soft-text);
}

.schritt__haken {
    display: inline-block;
    width: var(--avm-kreis);
    color: var(--color-success);
    line-height: 1;
    text-align: center;
}

.tafel__fuss {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-6) var(--space-10);
    padding: var(--space-6) var(--space-10);
    border-top: 1px solid var(--color-divider);
}

.tafel__fuss-text {
    display: flex;
    flex: 1 1 22em;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.tafel__fuss-satz {
    margin: 0;
    color: var(--color-text);
}

.tafel__fuss-satz--leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.tafel__fuss-satz--fehler {
    color: var(--color-danger-soft-text);
}

.tafel__fuss-satz--warnung {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.tafel__fuss-satz strong {
    color: var(--color-text-strong);
    font-weight: var(--font-weight-regular);
}

.tafel__fuss-aktion {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-4) var(--space-8);
}

.tafel__frage {
    padding: var(--space-6) var(--space-10) 0;
    border-top: 1px solid var(--color-divider);
}

/* Schmaler Rumpf: jede Zeile wird eine Karte; die Spaltenköpfe entfallen, die Angaben tragen ihren Namen selbst */
@container wsync (max-width: 720px) {
    .tafel__kopf .tafel__spaltenname {
        display: none;
    }

    .tafel__kopf {
        grid-template-columns: minmax(0, 1fr);
    }

    .tafel__raster {
        grid-template-columns: minmax(0, 1fr);
        row-gap: var(--space-4);
        padding-block: var(--space-8);
    }

    .tafel__stand {
        flex-direction: row;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--space-2) var(--space-6);
    }

    .tafel__stand .tafel__etikett {
        display: inline;
    }

    .tafel__stand .tafel__etikett::after {
        content: ":";
    }

    .tafel__fuss-aktion {
        flex: 1 1 100%;
        justify-content: stretch;
    }
}
</style>
