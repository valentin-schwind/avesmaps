<script setup lang="ts">
/**
 * Die Pause der Warteschlange im Eintrag „Betriebszustand“ (WI-0160; Claudios Entwurf §5, Betreiberwunsch 2026-10-15). Dieselbe Karte
 * wie die zwei Sperren (`verwaltung-betrieb-sperre.vue`): der Schalter Läuft · Pausiert, darunter „Hält an“ und „Läuft weiter“, und
 * wenn pausiert, seit wann, von wem und warum. Umgeschaltet wird über dieselbe Bestätigung: Pausieren mit Grund, Fortsetzen ohne
 * Pflicht; beides fragt den Passkey (Stufe S).
 *
 * 🔴 **Es gibt kein „Starten“.** Der Betreiber hat „Warteschlange starten“ und „Pausieren“ gewünscht; gebaut ist „Pausieren“ und im
 * pausierten Zustand „Fortsetzen“ — nichts ist angehalten, was man starten müsste, die Aufträge holt der Abholer von selbst ab. Die
 * Begründung steht im Work Item WI-0160, ihm vorgelegt.
 *
 * 🔴 Weiß der Server seinen Zustand nicht, steht keine Stellung gewählt da: „unbekannt“ ist nie „läuft“.
 *
 * 🔴 **Ein Schalter für alle Umgebungen** (WI-0163 §1.6, §1.7): Mit dem Stand des Dirigenten zeigt die Karte die WIRKSAME Pause
 * (die jüngste Anweisung über Stage und Production) mit ihrem Ort, „pausiert seit 03:12 · Valentin · auf der Stage“, und darunter die
 * gemeinsame Reihe (`verwaltung-betrieb-reihe.vue`). Ist der Stand unbekannt, sagt die Karte das und zeigt die letzte Anweisung dieser
 * Umgebung; so vergleicht dann auch der Server. Ohne Stand-Datei bleibt alles wie in WI-0160.
 */
import { computed } from "vue";
import type { GemeinsameWarteschlange } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { unbekanntSatz } from "../status/gemeinsam-view";
import type { Operations } from "./betriebszustand";
import { grundPflicht, seitText } from "./betriebszustand";
import VerwaltungBetriebFrage from "./verwaltung-betrieb-frage.vue";
import VerwaltungBetriebReihe from "./verwaltung-betrieb-reihe.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { wirksamSeitText } from "./warteschlange-reihe";

const props = defineProps<{
    betrieb: Operations;
    /** Der gezeigte Stand: die wirksame Pause, ohne frischen Stand die eigene Zeile; `null`, wenn er unbekannt ist. */
    paused: boolean | null;
    setting: {
        since: string | null;
        by: { displayName: string } | null;
        byLabel: string | null;
        reason: string | null;
    } | null;
    /** Warum sich gerade nichts umschalten lässt (Recht fehlt, Zustand unbekannt); sperrt beide Segmente. */
    sperrSatz?: string | undefined;
    /** Die Kennung des Satzes, auf den die gesperrten Segmente zeigen. */
    sperrId?: string | undefined;
    jetzt: number;
    /** Die gemeinsame Warteschlange (WI-0163); fehlt ohne Stand-Datei. */
    gemeinsam?: GemeinsameWarteschlange | undefined;
}>();

/** Mit Stand-Datei gilt der Schalter für alle Umgebungen; die Sätze sagen es. */
const geteilt = computed(() => props.gemeinsam !== undefined);
/** Frisch: die wirksame Pause und die Reihe aus dem Stand. */
const frisch = computed(() => (props.gemeinsam?.zustand === "ok" ? props.gemeinsam : null));
const unbekannt = computed(() => unbekanntSatz(props.gemeinsam, props.jetzt));
/** Der Satz unter dem Schalter, solange pausiert ist: die wirksame Pause mit Ort, sonst die eigene Zeile wie bisher. */
const seitSatz = computed((): string | null => {
    if (props.paused !== true) return null;
    const jetzt = new Date(props.jetzt);
    const pause = frisch.value?.pause ?? null;
    if (frisch.value !== null && pause !== null) return wirksamSeitText(pause, frisch.value.umgebung, jetzt);
    return props.setting === null ? null : seitText(props.setting, jetzt);
});

const offen = computed(() => {
    const frage = props.betrieb.frage.value;
    return frage !== null && frage.art === "queue" ? frage : null;
});
const gesperrt = computed(() => props.sperrSatz !== undefined || props.betrieb.busy.value);
const wert = computed(() => (props.paused === null ? "" : props.paused ? "pausiert" : "laeuft"));
const optionen = computed(() =>
    (["laeuft", "pausiert"] as const).map((value) => ({
        value,
        label: t(value === "laeuft" ? "admin.system.queue.running" : "admin.system.queue.paused"),
        gesperrt: gesperrt.value,
        beschrieben: props.sperrSatz === undefined ? undefined : props.sperrId,
    })),
);
const ergebnis = computed(() => {
    const letzte = props.betrieb.ergebnis.value;
    return letzte !== null && letzte.ort === "queue" ? letzte.result : undefined;
});

function waehlen(value: string): void {
    const ziel = value === "pausiert";
    if (props.paused === null || ziel === props.paused) return;
    props.betrieb.ask({ art: "queue", ziel });
}
</script>

<template>
    <FensterKarte :titel="t('admin.system.queue.title')" data-testid="betrieb-warteschlange">
        <AvmSegmente
            class="warteschlange__schalter"
            :model-value="wert"
            :options="optionen"
            :label="t('admin.system.queue.label')"
            testid="betrieb-warteschlange-schalter"
            @update:model-value="waehlen"
        />
        <p v-if="seitSatz !== null" class="warteschlange__seit" data-testid="betrieb-warteschlange-seit">
            <span class="warteschlange__stark">{{ t("admin.system.queue.since") }}</span>
            {{ seitSatz }}
        </p>
        <AvmHinweis v-if="unbekannt !== null" ton="warnung" testid="betrieb-warteschlange-unbekannt">
            {{ unbekannt.lead }} {{ unbekannt.satz }} {{ t("admin.system.queue.ownOnly") }}
        </AvmHinweis>
        <VerwaltungBetriebFrage
            v-if="offen !== null"
            :grund="props.betrieb.grund.value"
            :frage="t(offen.ziel ? 'admin.system.queue.ask' : 'admin.system.queue.release')"
            :folge="
                t(
                    offen.ziel
                        ? geteilt
                            ? 'admin.system.queue.askFollowsShared'
                            : 'admin.system.queue.askFollows'
                        : geteilt
                          ? 'admin.system.queue.releaseFollowsShared'
                          : 'admin.system.queue.releaseFollows',
                )
            "
            :bestaetigen="t(offen.ziel ? 'admin.system.queue.action.pause' : 'admin.system.queue.action.resume')"
            :pflicht="grundPflicht(offen)"
            :busy="props.betrieb.busy.value"
            testid="betrieb-frage-queue"
            @update:grund="props.betrieb.setGrund"
            @bestaetigen="props.betrieb.confirm()"
            @abbrechen="props.betrieb.cancel()"
        />
        <VerwaltungMeldung :ergebnis="ergebnis" testid="betrieb-meldung-queue" />
        <dl class="warteschlange__bedeutung">
            <dt>{{ t("admin.system.queue.holds") }}</dt>
            <dd>{{ t(geteilt ? "admin.system.queue.holdsTextShared" : "admin.system.queue.holdsText") }}</dd>
            <dt>{{ t("admin.system.queue.staysOpen") }}</dt>
            <dd>{{ t("admin.system.queue.staysOpenText") }}</dd>
        </dl>
        <VerwaltungBetriebReihe v-if="frisch !== null" :reihe="frisch.reihe" />
    </FensterKarte>
</template>

<style scoped>
/* Die Mulde liegt auf der Karte (`panel-soft`) und braucht deshalb die hellere Fläche; so breit wie die der Sperren (Blatt: 220). */
.warteschlange__schalter {
    width: var(--avm-fenster-spalte);
    max-width: 100%;
    background: var(--color-panel);
}

.warteschlange__seit {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.warteschlange__stark {
    color: var(--color-text-strong);
}

.warteschlange__bedeutung {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.warteschlange__bedeutung > dt {
    color: var(--color-text-strong);
}

.warteschlange__bedeutung > dd {
    margin: 0;
}
</style>
