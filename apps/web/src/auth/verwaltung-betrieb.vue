<script setup lang="ts">
/**
 * Der Eintrag „Betriebszustand“ unter „System & Betrieb“ (WI-0127 SYS-5; SYS-0001 §6.2, §6.8; Blatt WI-0119 Fassung 2, A1 am Rechner,
 * A4 am Telefon, Z1 Zustände, Z2 eingestellt gegen wirksam, Z6 Bestätigung). Was die Oberfläche rechnet, steht in
 * `betriebszustand.ts`; hier steht nur, wie es aussieht.
 *
 * - **Betrieb im Moment** (`verwaltung-betrieb-kurzstatus.vue`): vier Statuspunkte, Release, Alter des Stands, Statusseite ↗.
 * - **Hauptschalter** Normal · Eingeschränkt · Wartung. 🔴 „Wartung“ ist nur Anzeige (die root-Datei auf dem Server, Claudio) und
 *   steht gesperrt mit dem Satz daneben; das Fenster zeigt sie nie als gewählt. Ein Druck auf ein Segment schaltet nicht, er öffnet
 *   die Bestätigung im Moment; gewählt bleibt, was eingestellt ist, bis der Server es bestätigt.
 * - **Eingestellt gegen wirksam** in zwei Zeilen, vier Urteile (`wirkung`). 🔴 „Unbekannt“ steht nie als Normal da, auch nicht als
 *   gewähltes Segment.
 * - **Kartensperre und Systemsperre** je als Karte (`verwaltung-betrieb-sperre.vue`), daneben die **Warteschlange**
 *   (`verwaltung-betrieb-warteschlange.vue`, WI-0160: Pausieren und Fortsetzen; seit WI-0163 die wirksame Pause über alle
 *   Umgebungen und die gemeinsame Reihe), darunter der Rückweg über die Kommandozeile.
 * - **Rechte:** sehen mit `view_operations` (sonst fehlt der Eintrag), umschalten nur mit `manage_system_settings`; ohne das Recht
 *   stehen alle Segmente gesperrt mit Satz, und es gibt keine Bestätigung.
 * - **Telefon** (Blatt A4): Hauptschalter zuerst und gestapelt, die Bedeutungen fallen weg, Kurzstatus, Sperren und Rückweg darunter.
 *   Die Reihenfolge wechselt im Baum, nicht über CSS `order`: Vorleser und Tab folgen dem Baum.
 */
import { computed, onMounted, onUnmounted, ref, useId } from "vue";
import type { SystemMode } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSperrgrund from "../controls/avm-sperrgrund.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterMauer from "../fenster/fenster-mauer.vue";
import { t } from "../i18n/i18n";
import {
    dauerText,
    grundPflicht,
    inhaberText,
    modeName,
    modeTon,
    rueckwegBefehle,
    schutzProblem,
    seitText,
    vorText,
    wirkung,
    wirkungTon,
    type Operations,
} from "./betriebszustand";
import { authState } from "./session-state";
import VerwaltungBetriebFrage from "./verwaltung-betrieb-frage.vue";
import VerwaltungBetriebKurzstatus from "./verwaltung-betrieb-kurzstatus.vue";
import VerwaltungBetriebSperre from "./verwaltung-betrieb-sperre.vue";
import VerwaltungBetriebWarteschlange from "./verwaltung-betrieb-warteschlange.vue";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { warteschlangePausiert } from "./warteschlange-reihe";

const props = defineProps<{
    betrieb: Operations;
    telefon: boolean;
}>();

const session = authState.value;
const darfSchalten = session.capabilities.includes("manage_system_settings");
const wartungId = useId();
const sperrId = useId();

/** Die Uhr für „vor … s“: tickt nur, solange der Eintrag zu sehen ist. */
const jetzt = ref(Date.now());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = Date.now()), 1000);
    props.betrieb.follow(true);
    void props.betrieb.load();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    props.betrieb.follow(false);
    props.betrieb.cancel();
});

const stand = computed(() => props.betrieb.overview.value);
const urteil = computed(() => (stand.value === null ? null : wirkung(stand.value)));
/** Was seit der Antwort vergangen ist, an der Uhr des Browsers. */
const seitAntwort = computed(() => Math.max(0, jetzt.value - props.betrieb.receivedAt.value));
const bekannt = computed(() => urteil.value !== null && urteil.value.art !== "unbekannt");
const eingestellt = computed(() => stand.value?.configured ?? null);
/** Die Warteschlange, wie Karte und Kurzstatus sie zeigen: die wirksame Pause über alle Umgebungen, sonst die eigene Zeile (WI-0163). */
const warteschlangePause = computed(() =>
    stand.value === null ? null : warteschlangePausiert(stand.value, bekannt.value),
);

/** Warum sich gerade nichts umschalten lässt; sperrt alle Segmente mit diesem Satz. */
const sperrSatz = computed((): string | undefined => {
    if (!darfSchalten) return t("admin.system.switch.readOnly", { recht: t("auth.capability.manage_system_settings") });
    if (!bekannt.value) return t("admin.system.switch.unknown");
    if (urteil.value?.unprovisioned === true || eingestellt.value === null)
        return t("admin.system.switch.unprovisioned");
    return undefined;
});

/** Gewählt ist, was eingestellt ist; bei unbekanntem Zustand nichts (nie Normal). */
const modeWert = computed(() => (bekannt.value && eingestellt.value !== null ? eingestellt.value.mode.mode : ""));
const modeOptionen = computed(() => {
    const zu = sperrSatz.value !== undefined || props.betrieb.busy.value;
    const beschrieben = sperrSatz.value === undefined ? undefined : sperrId;
    return [
        { value: "normal", label: t("admin.system.mode.normal"), gesperrt: zu, beschrieben },
        { value: "restricted", label: t("admin.system.mode.restricted"), gesperrt: zu, beschrieben },
        { value: "maintenance", label: t("admin.system.mode.maintenance"), gesperrt: true, beschrieben: wartungId },
    ];
});

function waehlen(value: string): void {
    if (value !== "normal" && value !== "restricted") return;
    if (eingestellt.value === null || eingestellt.value.mode.mode === value) return;
    props.betrieb.ask({ art: "mode", ziel: value as SystemMode });
}

const modeFrage = computed(() => {
    const frage = props.betrieb.frage.value;
    return frage !== null && frage.art === "mode" ? frage : null;
});
const modeFolge = computed(() => {
    const frage = modeFrage.value;
    if (frage === null || stand.value === null) return "";
    if (frage.ziel === "normal") return t("admin.system.ask.normalFollows");
    const holders = stand.value.restrictedAccessHolders;
    return holders.length === 0
        ? t("admin.system.ask.restrictFollowsNobody", { recht: t("auth.capability.access_restricted_mode") })
        : t("admin.system.ask.restrictFollows", { inhaber: inhaberText(holders) });
});
const modeProblem = computed(() => {
    const frage = modeFrage.value;
    if (frage === null || stand.value === null) return undefined;
    const key = schutzProblem(frage, stand.value, session.person?.id);
    return key === undefined ? undefined : t(key);
});
const modeErgebnis = computed(() => {
    const letzte = props.betrieb.ergebnis.value;
    return letzte !== null && letzte.ort === "mode" ? letzte.result : undefined;
});

/** Die Zeile „Wirksam“: Ton, Wort und der leise Satz dahinter (Blatt Z2). */
const wirksam = computed(() => {
    const u = urteil.value;
    if (u === null) return null;
    const seit = dauerText((u.seitMs ?? 0) + seitAntwort.value);
    if (u.art === "unbekannt") {
        return { ton: wirkungTon(u), text: modeName(null), satz: t("admin.system.effective.unknown") };
    }
    if (u.unprovisioned) {
        return { ton: modeTon(u.mode), text: modeName(u.mode), satz: t("admin.system.effective.unprovisioned") };
    }
    if (u.art === "zieht_nach") {
        return {
            ton: wirkungTon(u),
            text: t("admin.system.effective.still", { mode: modeName(u.mode) }),
            satz: t("admin.system.effective.catchingUp", { dauer: seit }),
        };
    }
    if (u.art === "weicht_ab") {
        return {
            ton: wirkungTon(u),
            text: modeName(u.mode),
            satz: t("admin.system.effective.deviates", { dauer: seit }),
        };
    }
    const alter = u.alterMs === null ? "" : vorText(u.alterMs + seitAntwort.value);
    return {
        ton: wirkungTon(u),
        text: modeName(u.mode),
        satz: alter === "" ? "" : t("admin.system.effective.measured", { vor: alter }),
    };
});

/** Der Rückweg als Satz mit zwei Befehlen; die Befehle stehen hervorgehoben im übersetzten Satz. */
const rueckweg = computed(() => {
    const [normal, loesen] = rueckwegBefehle(session.environment);
    const trenner = "\u0000";
    return t("admin.system.wayBack", { normal: `${trenner}normal${trenner}`, loesen: `${trenner}loesen${trenner}` })
        .split(trenner)
        .filter((teil) => teil !== "")
        .map((teil) =>
            teil === "normal"
                ? { befehl: true, text: normal }
                : teil === "loesen"
                  ? { befehl: true, text: loesen }
                  : { befehl: false, text: teil },
        );
});
</script>

<template>
    <div class="betrieb" :class="{ 'betrieb--telefon': props.telefon }" data-testid="betrieb">
        <VerwaltungLadeproblem
            :problems="props.betrieb.loadProblems.value"
            :fehlt="props.betrieb.unconfirmed.value"
            testid="betrieb-ladefehler"
            @bestaetigen="props.betrieb.confirmAgain()"
            ><span class="betrieb__zeile">{{ t("admin.system.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && props.betrieb.loading.value" class="betrieb__leise">{{ t("admin.loading") }}</p>

        <template v-if="stand !== null && urteil !== null">
            <VerwaltungBetriebKurzstatus
                v-if="!props.telefon"
                :brief="stand.brief"
                :seit-antwort="seitAntwort"
                :jetzt="jetzt"
                :telefon="false"
                :queue-paused="warteschlangePause === true"
            />

            <FensterKarte :titel="t('admin.system.switch.title')" data-testid="betrieb-hauptschalter">
                <div class="betrieb__schalterreihe">
                    <AvmSegmente
                        class="betrieb__schalter"
                        :model-value="modeWert"
                        :options="modeOptionen"
                        :label="t('admin.system.switch.label')"
                        :gestapelt="props.telefon"
                        testid="betrieb-schalter"
                        @update:model-value="waehlen"
                    />
                    <AvmSperrgrund :id="wartungId" :text="t('admin.system.switch.maintenanceReason')" />
                </div>
                <p
                    v-if="sperrSatz !== undefined"
                    :id="sperrId"
                    class="betrieb__sperrsatz"
                    data-testid="betrieb-sperrsatz"
                >
                    {{ sperrSatz }}
                </p>
                <VerwaltungBetriebFrage
                    v-if="modeFrage !== null"
                    :grund="props.betrieb.grund.value"
                    :frage="
                        t(modeFrage.ziel === 'restricted' ? 'admin.system.ask.restrict' : 'admin.system.ask.normal')
                    "
                    :folge="modeFolge"
                    :bestaetigen="
                        t(
                            modeFrage.ziel === 'restricted'
                                ? 'admin.system.ask.restrictAction'
                                : 'admin.system.ask.normalAction',
                        )
                    "
                    :pflicht="grundPflicht(modeFrage)"
                    :problem="modeProblem"
                    :busy="props.betrieb.busy.value"
                    testid="betrieb-frage-mode"
                    @update:grund="props.betrieb.setGrund"
                    @bestaetigen="props.betrieb.confirm()"
                    @abbrechen="props.betrieb.cancel()"
                />
                <VerwaltungMeldung :ergebnis="modeErgebnis" testid="betrieb-meldung-mode" />
                <dl
                    v-if="modeFrage === null && wirksam !== null"
                    class="betrieb__feldzeilen"
                    :data-wirkung="urteil.art"
                    data-testid="betrieb-wirkung"
                >
                    <dt>{{ t("admin.system.configured") }}</dt>
                    <dd data-testid="betrieb-eingestellt">
                        <template v-if="eingestellt !== null">
                            <span class="betrieb__stark">{{ modeName(eingestellt.mode.mode) }}</span>
                            <span class="betrieb__leise">{{ seitText(eingestellt.mode, new Date(jetzt)) }}</span>
                        </template>
                        <span v-else class="betrieb__leise">{{
                            urteil.unprovisioned ? t("admin.system.notSetUp") : t("admin.system.unknown")
                        }}</span>
                    </dd>
                    <dt>{{ t("admin.system.effective") }}</dt>
                    <dd data-testid="betrieb-wirksam">
                        <AvmStatus :ton="wirksam.ton" :text="wirksam.text" />
                        <span v-if="wirksam.satz !== ''" class="betrieb__leise">{{ wirksam.satz }}</span>
                    </dd>
                </dl>
                <template v-if="!props.telefon">
                    <div class="betrieb__trenner" aria-hidden="true"></div>
                    <dl class="betrieb__bedeutung" data-testid="betrieb-bedeutung">
                        <dt>{{ t("admin.system.mode.normal") }}</dt>
                        <dd>{{ t("admin.system.meaning.normal") }}</dd>
                        <dt>{{ t("admin.system.mode.restricted") }}</dt>
                        <dd>
                            {{
                                t("admin.system.meaning.restricted", {
                                    recht: t("auth.capability.access_restricted_mode"),
                                })
                            }}
                        </dd>
                        <dt>{{ t("admin.system.mode.maintenance") }}</dt>
                        <dd>{{ t("admin.system.meaning.maintenance") }}</dd>
                    </dl>
                </template>
            </FensterKarte>

            <VerwaltungBetriebKurzstatus
                v-if="props.telefon"
                :brief="stand.brief"
                :seit-antwort="seitAntwort"
                :jetzt="jetzt"
                :telefon="true"
                :queue-paused="warteschlangePause === true"
            />

            <FensterMauer>
                <VerwaltungBetriebSperre
                    :betrieb="props.betrieb"
                    lock="map"
                    :locked="bekannt && eingestellt !== null ? eingestellt.mapLock.locked : null"
                    :setting="eingestellt?.mapLock ?? null"
                    :sperr-satz="sperrSatz"
                    :sperr-id="sperrId"
                    :jetzt="jetzt"
                />
                <VerwaltungBetriebSperre
                    :betrieb="props.betrieb"
                    lock="system"
                    :locked="bekannt && eingestellt !== null ? eingestellt.systemLock.locked : null"
                    :setting="eingestellt?.systemLock ?? null"
                    :sperr-satz="sperrSatz"
                    :sperr-id="sperrId"
                    :jetzt="jetzt"
                />
                <VerwaltungBetriebWarteschlange
                    :betrieb="props.betrieb"
                    :paused="warteschlangePause"
                    :setting="eingestellt?.queuePause ?? null"
                    :sperr-satz="sperrSatz"
                    :sperr-id="sperrId"
                    :jetzt="jetzt"
                    :gemeinsam="stand.warteschlange"
                />
            </FensterMauer>

            <AvmHinweis testid="betrieb-rueckweg">
                <template v-for="(teil, index) in rueckweg" :key="index">
                    <code v-if="teil.befehl" class="betrieb__befehl">{{ teil.text }}</code>
                    <template v-else>{{ teil.text }}</template>
                </template>
            </AvmHinweis>
        </template>
    </div>
</template>

<style scoped>
.betrieb {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.betrieb__zeile {
    display: block;
}

.betrieb__leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.betrieb__stark {
    color: var(--color-text-strong);
}

/* Segmente und der Satz zu „Wartung“ in einer Reihe; am Telefon bricht der Satz unter die Mulde (Blatt A1, A4). */
.betrieb__schalterreihe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-10);
}

/* Die Mulde liegt auf der Karte (`panel-soft`) und braucht die hellere Fläche; doppelt so breit wie die der Sperren (Blatt: 440 zu
   220). */
.betrieb__schalter {
    width: calc(var(--avm-fenster-spalte) * 2);
    max-width: 100%;
    background: var(--color-panel);
}

.betrieb--telefon .betrieb__schalter {
    width: 100%;
}

.betrieb__sperrsatz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/* Feldzeilen: Beschriftung links in fester Breite, Wert füllt (Guide §8, §16); am Telefon untereinander. */
.betrieb__feldzeilen {
    display: grid;
    grid-template-columns: var(--avm-field-label-w) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    align-items: center;
    margin: 0;
}

.betrieb__feldzeilen > dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.betrieb__feldzeilen > dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-6);
    margin: 0;
}

.betrieb--telefon .betrieb__feldzeilen {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-2);
}

.betrieb--telefon .betrieb__feldzeilen > dd + dt {
    margin-top: var(--space-4);
}

.betrieb__trenner {
    height: 1px;
    background: var(--color-divider);
}

.betrieb__bedeutung {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.betrieb__bedeutung > dt {
    color: var(--color-text-strong);
}

.betrieb__bedeutung > dd {
    margin: 0;
}

.betrieb__befehl {
    color: var(--color-text-strong);
    font: inherit;
}
</style>
