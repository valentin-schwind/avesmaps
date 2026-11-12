<script setup lang="ts">
import { computed, onMounted } from "vue";
import type { MailAbrufStand, MailRoutineArt, MailVersandStand } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmStatus from "../controls/avm-status.vue";
import { authState } from "../auth/session-state";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import {
    betriebsText,
    betriebsTon,
    erfolgZahlen,
    grundSatz,
    laufSchluessel,
    startpunktParams,
    type MailVerwaltung,
} from "./mail-verwaltung";

/**
 * Das Panel „Mailpostfach“ unter Systemsteuerung › Redaktion & Zusammenarbeit (WI-0268 C6c): der Mailweg der Community, Abruf (IMAP) und Versand (SMTP), jeder mit Betrieb, Routine, Zugang und letztem Lauf.
 * Aufbau und Bauteile wie der Discord-Reiter (`news/discord-verwaltung.vue`): zwei Karten untereinander, in jeder Feldzeilen mit Statuspunkt und dem Knopf der Routine.
 *
 * - 🔴 Kein Nutzer, kein Kennwort, keine Adresse: Der Server sagt nur „hinterlegt“ oder „fehlt“, nennt den Server (nur den Host) und den Ordner. Eingerichtet wird der Zugang auf dem Server.
 * - Die Routine ist ein Schalter in der Datenbank zusätzlich zur Konfiguration auf dem Server: Fehlt dort eine Angabe, geht der Weg nicht, gleich wie der Schalter steht.
 * - Der Knopf erscheint nur mit `manage_system_settings`; der Server prüft trotzdem jede Anfrage und verlangt den Passkey.
 */
const props = defineProps<{ mail: MailVerwaltung }>();

const darf = authState.value.capabilities.includes("manage_system_settings");
const stand = computed(() => props.mail.stand.value);
const beschaeftigt = computed(() => props.mail.busy.value !== null);

onMounted(() => {
    void props.mail.laden();
});

const zeit = (iso: string): string =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Was beide Karten gemeinsam zeigen; die Zeilen, die nur eine Art hat (Ordner, Startpunkt, wartende Mails), stehen im Template je unter ihrer Art. */
type Weg = MailAbrufStand | MailVersandStand;

const karten = computed(() => {
    const s = stand.value;
    if (s === null) return [];
    return [
        { art: "abruf" as const, weg: s.abruf as Weg },
        { art: "versand" as const, weg: s.versand as Weg },
    ];
});

const grundText = (art: MailRoutineArt, weg: Weg): string | null => {
    const satz = grundSatz(art, weg);
    return satz === null ? null : t(satz.key, satz.zeit === null ? {} : { zeit: zeit(satz.zeit) });
};

const routineSeit = (weg: Weg): string | null => {
    const { geaendertAt, geaendertVon } = weg.routine;
    if (geaendertAt === null) return null;
    return geaendertVon === null
        ? t("admin.mail.routine.seitOhne", { zeit: zeit(geaendertAt) })
        : t("admin.mail.routine.seit", { zeit: zeit(geaendertAt), name: geaendertVon });
};

const laufText = (weg: Weg): string => {
    const lauf = weg.letzterLauf;
    if (lauf === null) return t("admin.mail.lauf.nie");
    return t("admin.mail.lauf.zeile", { zeit: zeit(lauf.at), ergebnis: t(laufSchluessel(lauf.ergebnis)) });
};

const abrufErfolg = (weg: MailAbrufStand): string =>
    weg.letzterErfolg === null
        ? t("admin.mail.erfolg.keiner")
        : t("admin.mail.erfolg.abruf", { zeit: zeit(weg.letzterErfolg.at), ...erfolgZahlen(weg.letzterErfolg) });

const versandErfolg = (weg: MailVersandStand): string =>
    weg.letzterErfolg === null
        ? t("admin.mail.erfolg.keiner")
        : t(
              weg.letzterErfolg.kopieFehlt === true
                  ? "admin.mail.erfolg.versandOhneKopie"
                  : "admin.mail.erfolg.versand",
              {
                  zeit: zeit(weg.letzterErfolg.at),
              },
          );

const letzteMailText = (weg: MailAbrufStand): string =>
    weg.letzteMailAt === null ? t("admin.mail.letzteMail.keine") : zeit(weg.letzteMailAt);

const startpunktText = (weg: MailAbrufStand): string =>
    weg.startpunkt === null
        ? t("admin.mail.startpunkt.keiner")
        : t("admin.mail.startpunkt.zeile", startpunktParams(weg.startpunkt));

const abruf = (weg: Weg): MailAbrufStand => weg as MailAbrufStand;
const versand = (weg: Weg): MailVersandStand => weg as MailVersandStand;
</script>

<template>
    <div class="mail" data-testid="mail-verwaltung">
        <p v-if="props.mail.fehler.value" class="satz satz--fehler" role="alert">{{ t("admin.mail.failed") }}</p>

        <FensterKarte v-for="karte in karten" :key="karte.art" :titel="t(`admin.mail.${karte.art}.title`)">
            <p class="satz">{{ t(`admin.mail.${karte.art}.lead`) }}</p>
            <AvmHinweis
                v-if="karte.weg.grund === 'nicht_eingerichtet'"
                ton="warnung"
                :testid="`mail-${karte.art}-vorbehalt`"
                >{{ grundText(karte.art, karte.weg) }}</AvmHinweis
            >
            <FensterFeldzeilen :testid="`mail-${karte.art}`">
                <dt>{{ t("admin.mail.field.betrieb") }}</dt>
                <dd class="betrieb">
                    <AvmStatus
                        :ton="betriebsTon(karte.weg)"
                        :text="t(betriebsText(karte.art, karte.weg))"
                        :testid="`mail-${karte.art}-betrieb`"
                    />
                    <span
                        v-if="karte.weg.grund !== null && karte.weg.grund !== 'nicht_eingerichtet'"
                        class="leise"
                        :data-testid="`mail-${karte.art}-grund`"
                        >{{ grundText(karte.art, karte.weg) }}</span
                    >
                </dd>
                <dt>{{ t("admin.mail.field.routine") }}</dt>
                <dd class="routine">
                    <AvmStatus
                        :ton="karte.weg.routine.aktiv ? 'erfolg' : 'ruhe'"
                        :text="t(karte.weg.routine.aktiv ? 'admin.mail.routine.an' : 'admin.mail.routine.aus')"
                        :testid="`mail-${karte.art}-routine-status`"
                    />
                    <span v-if="routineSeit(karte.weg)" class="leise">{{ routineSeit(karte.weg) }}</span>
                    <AvmKnopf
                        v-if="darf"
                        groesse="zeile"
                        :art="karte.weg.routine.aktiv ? 'weich' : 'gefuellt'"
                        :gesperrt="beschaeftigt ? '' : undefined"
                        :testid="`mail-${karte.art}-schalten`"
                        @click="props.mail.setzeRoutine(karte.art, !karte.weg.routine.aktiv)"
                        >{{
                            t(
                                karte.weg.routine.aktiv
                                    ? "admin.mail.routine.ausschalten"
                                    : "admin.mail.routine.einschalten",
                            )
                        }}</AvmKnopf
                    >
                </dd>
                <dt>{{ t("admin.mail.field.zugang") }}</dt>
                <dd :data-testid="`mail-${karte.art}-zugang`">
                    {{
                        t(
                            karte.weg.zugang === "hinterlegt"
                                ? "admin.mail.zugang.hinterlegt"
                                : "admin.mail.zugang.fehlt",
                        )
                    }}
                </dd>
                <dt>{{ t("admin.mail.field.server") }}</dt>
                <dd :data-testid="`mail-${karte.art}-server`">
                    {{ karte.weg.server ?? t("admin.mail.server.keiner") }}
                </dd>
                <template v-if="karte.art === 'abruf'">
                    <dt>{{ t("admin.mail.field.ordner") }}</dt>
                    <dd data-testid="mail-abruf-ordner">{{ abruf(karte.weg).ordner }}</dd>
                </template>
                <dt>{{ t("admin.mail.field.lauf") }}</dt>
                <dd :data-testid="`mail-${karte.art}-lauf`">{{ laufText(karte.weg) }}</dd>
                <dt>{{ t("admin.mail.field.erfolg") }}</dt>
                <dd :data-testid="`mail-${karte.art}-erfolg`">
                    {{ karte.art === "abruf" ? abrufErfolg(abruf(karte.weg)) : versandErfolg(versand(karte.weg)) }}
                </dd>
                <template v-if="karte.art === 'abruf'">
                    <dt>{{ t("admin.mail.field.letzteMail") }}</dt>
                    <dd data-testid="mail-abruf-letzte-mail">{{ letzteMailText(abruf(karte.weg)) }}</dd>
                    <dt>{{ t("admin.mail.field.startpunkt") }}</dt>
                    <dd data-testid="mail-abruf-startpunkt">{{ startpunktText(abruf(karte.weg)) }}</dd>
                </template>
                <template v-else>
                    <dt>{{ t("admin.mail.field.wartend") }}</dt>
                    <dd class="betrieb" data-testid="mail-versand-wartend">
                        <span>{{ versand(karte.weg).wartend }}</span>
                        <span v-if="versand(karte.weg).wartend > 0 && !karte.weg.routine.aktiv" class="leise">{{
                            t("admin.mail.wartend.hinweis")
                        }}</span>
                    </dd>
                    <dt>{{ t("admin.mail.field.fehler") }}</dt>
                    <dd data-testid="mail-versand-fehler">{{ versand(karte.weg).fehler7Tage }}</dd>
                </template>
            </FensterFeldzeilen>
            <template v-if="props.mail.problemArt.value === karte.art">
                <p
                    v-for="problem in props.mail.problems.value"
                    :key="problem.key"
                    class="satz satz--fehler"
                    role="alert"
                >
                    {{ t(problem.key, problem.params) }}
                </p>
            </template>
            <p class="satz leise">{{ t("admin.mail.hinweis.zugang") }}</p>
        </FensterKarte>
    </div>
</template>

<style scoped>
.mail {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

.leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.betrieb,
.routine {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}
</style>
