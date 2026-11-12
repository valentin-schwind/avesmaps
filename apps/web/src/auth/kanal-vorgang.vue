<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useTemplateRef, watch } from "vue";
import {
    KANAL_STATUS_STATIONEN,
    erreichteStatusStationen,
    staende,
    stationenFuer,
    statusStation,
    wegFuer,
    type KanalEintrag,
} from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import { t } from "../i18n/i18n";
import KanalBildEintrag from "./kanal-bild-eintrag.vue";
import CommitVerweis from "./commit-verweis.vue";
import KanalBildWahl from "./kanal-bild-wahl.vue";
import KanalWer from "./kanal-wer.vue";
import {
    KANAL_BILDER_JE_MELDUNG,
    abholSatz,
    kategorieName,
    kontextName,
    prioritaetName,
    prioritaetTon,
    stationName,
    statusName,
    statusTon,
    zustandName,
    zeit,
    type Kanal,
} from "./kanal";

/**
 * Ein Vorgang (Blatt WI-0124 C1, C2, A3): Kopf mit OPS-Nummer und Status, darunter die Nachweis-Leiste mit vier Stationen der laufenden
 * Runde, der Verlauf, der technische Kontext und der Fix-Bericht. Der Betreiber schreibt Nachrichten, nimmt ab oder öffnet mit Kommentar
 * wieder (jeder Betreiber, Entscheidung 17 A; W2), löscht eine abgenommene Meldung nach Wunsch. Nach dem Ablauf bleibt der Rest.
 * Texte stehen als Text da, nie als HTML.
 */
const props = defineProps<{ kanal: Kanal; telefon: boolean }>();
const emit = defineEmits<{ zurueck: [] }>();

const v = computed(() => props.kanal.vorgang.value);
const now = computed(() => new Date());
const text = ref("");
const frage = ref<"wieder" | "loeschen" | "erledigt" | "abbrechen" | null>(null);
const kommentar = ref("");

/**
 * Die Bestätigung unter dem Schreibfeld: angelegt oder gesendet, mit der OPS-Nummer und der Erwartung (Befund Stage-Release 5c37bc88,
 * Arbeitsanweisung WI-0124 §6). Sie rollt ins Bild, wo das Fenster lang ist, und steht bis zur nächsten Handlung (kein Toast, §15.1).
 */
const bestaetigung = computed<{ satz: string; ton: "neutral" | "warnung" } | null>(() => {
    const b = props.kanal.bestaetigung.value;
    if (b === null || b.ops !== v.value?.ops) return null;
    const stand = props.kanal.abholung.value;
    if (stand?.laeuft)
        return {
            satz: t(b.art === "angelegt" ? "kanal.sent.created" : "kanal.sent.message", { ops: b.ops }),
            ton: "neutral",
        };
    const kurz = t(b.art === "angelegt" ? "kanal.sent.createdOnly" : "kanal.sent.messageOnly", { ops: b.ops });
    // Holt niemand ab, sagt die Bestätigung es mit derselben Regel wie Liste und Vorgang; unbekannt: nur, was geschah.
    return stand === null ? { satz: kurz, ton: "neutral" } : { satz: `${kurz} ${wartet.value}`, ton: "warnung" };
});
/**
 * Der Satz, wenn die Routine nicht abholt (Koordination 2026-10-11: „Im Vorgang selbst steht derselbe Satz, nicht nur oben in der Liste“).
 * Nur solange der Vorgang auf die Routine wartet, also nicht zur Abnahme und nicht abgenommen.
 */
const wartet = computed(() => {
    const stand = props.kanal.abholung.value;
    if (stand === null || stand.laeuft) return null;
    return `${abholSatz(stand, props.kanal.jetzt.value)} ${t("kanal.pickup.waitsOne")}`;
});
const wartetHier = computed(
    () =>
        wartet.value !== null &&
        v.value !== null &&
        !["zur_abnahme", "abgenommen", "zu_sichten"].includes(v.value.status),
);
const bestaetigt = useTemplateRef<InstanceType<typeof AvmHinweis>>("bestaetigt");
watch(bestaetigung, async (neu, alt) => {
    if (neu === null || neu.satz === alt?.satz) return;
    await nextTick();
    (bestaetigt.value?.$el as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
});

/**
 * Die Leiste zeigt den Weg, den DIESER Vorgang gehen kann (Betreiber 2026-10-13: „Leiste bleibt, aber mit Status-Stationen“).
 *
 * 🪤 Vorher stand hier `KANAL_STATIONEN` für jeden Vorgang. Zwei Folgen, beide vom Betreiber an OPS-000003 gefunden:
 * `production_live` und `production_zurueck` standen an einer Nutzerfrage, und die vier Fix-Stationen standen dort auf „offen“,
 * obwohl Claudio längst geantwortet hatte — an einer Frage gibt es nichts zu committen. „Offen“ liest sich wie „kommt noch“.
 *
 * Jetzt: **ohne Fix der Status-Weg** (`gemeldet · übernommen · beantwortet · erledigt`, aus dem Verlauf gelesen), **mit Fix die
 * Nachweis-Stationen** wie bisher. Das Kriterium ist der Fix, nicht die Kategorie — Thomas' Frage steht unter
 * „Editor-Optimierung“, und eine feste Tafel je Kategorie hätte ihr weiter die Fix-Stationen gegeben.
 */
const stationen = computed(() => {
    const vorgang = v.value;
    if (vorgang === null) return [];
    // 💣 Nur die LAUFENDE Runde zaehlt (2026-10-16): Der Vorgang bekam bisher alle Runden, die Liste nur die laufende —
    // nach einem Wiederoeffnen zeigte dieselbe Meldung hier den Fix-Weg und dort den Status-Weg.
    const runde = {
        art: vorgang.art,
        alleNachweise: vorgang.alleNachweise.filter((n) => n.runde === vorgang.runde),
        aenderungen: vorgang.aenderungen.filter((a) => a.runde === vorgang.runde),
    };
    if (wegFuer(runde) === "status") {
        const erreicht = erreichteStatusStationen(vorgang.status, vorgang.eintraege);
        const zeitpunkt = (station: string): string | undefined => {
            if (station === "gemeldet") return vorgang.gemeldetAt;
            return vorgang.eintraege.filter((e) => e.art === "status" && statusStation(e.statusNach) === station).at(-1)
                ?.at;
        };
        const stand = staende([...KANAL_STATUS_STATIONEN], erreicht);
        return KANAL_STATUS_STATIONEN.map((station, i) => ({
            station,
            stand: stand[i] ?? "offen",
            erreicht: erreicht.has(station),
            at: erreicht.has(station) ? zeitpunkt(station) : undefined,
            commit: undefined,
            release: undefined,
        }));
    }
    const liste = stationenFuer(vorgang.art);
    const erreichteStationen = new Set(runde.alleNachweise.map((n) => n.station));
    const stand = staende([...liste], erreichteStationen);
    return liste.map((station, i) => {
        const nachweis = runde.alleNachweise.filter((n) => n.station === station).at(-1);
        return {
            station,
            stand: stand[i] ?? "offen",
            erreicht: nachweis !== undefined,
            at: nachweis?.at,
            commit: nachweis?.commit ?? undefined,
            release: nachweis?.release ?? undefined,
        };
    });
});
const titel = computed(
    () =>
        v.value?.titel ??
        v.value?.kurztitel ??
        (v.value === null ? "" : `${kategorieName(v.value.kategorie)} · ${v.value.ops}`),
);
const offen = computed(() => v.value !== null && v.value.status !== "abgenommen");
/** Was im Kopf steht, wenn der Vorgang zu ist: wie er endete (0127), sonst weiter „Archiv“. */
const abschlussWort = computed(() =>
    v.value?.abschluss === "erledigt"
        ? t("kanal.pill.done")
        : v.value?.abschluss === "abgebrochen"
          ? t("kanal.pill.discarded")
          : // An die Community (WI-0297): die Nummer der Redaktion, der Zustand selbst sagt schon „an Community“.
            v.value?.abschluss === "an_community"
            ? (v.value.community ?? t("kanal.tab.archiv"))
            : t("kanal.tab.archiv"),
);
const istRest = computed(() => v.value?.abgelaufenAt !== null && v.value?.abgelaufenAt !== undefined);

const bildVon = (id: string) => v.value?.bilder.find((bild) => bild.id === id);

// Solange der Worker ein Bild rendert, sieht der Vorgang alle paar Sekunden nach (kein Kanal zum Browser).
let nachsehen: ReturnType<typeof setTimeout> | undefined;
watch(
    v,
    (jetzt) => {
        if (nachsehen !== undefined) clearTimeout(nachsehen);
        nachsehen = undefined;
        if (jetzt === null || !jetzt.bilder.some((bild) => bild.zustand === "wird_vorbereitet")) return;
        const ops = jetzt.ops;
        nachsehen = setTimeout(() => void props.kanal.oeffne(ops), 2500);
    },
    { immediate: true },
);
onUnmounted(() => {
    if (nachsehen !== undefined) clearTimeout(nachsehen);
});

async function anhaengen(dateien: File[]): Promise<void> {
    const ops = v.value?.ops;
    if (ops === undefined) return;
    for (const datei of dateien) if (!(await props.kanal.bildAnhaengen(ops, datei))) return;
}

function eintragSatz(e: KanalEintrag): string {
    // Die Weiterleitung (WI-0297) trägt die COM-Nummer als Text: „zu sichten → an Community (COM-…)“.
    if (e.art === "status" && e.statusNach === "abgenommen" && /^COM-\d{6,12}$/u.test(e.text ?? ""))
        return t("kanal.entry.status", {
            from: statusName(e.statusVon ?? ""),
            to: `${t("kanal.status.anCommunity")} (${e.text ?? ""})`,
        });
    if (e.art === "status")
        return t("kanal.entry.status", { from: statusName(e.statusVon ?? ""), to: statusName(e.statusNach ?? "") });
    if (e.art === "bild") return t("kanal.entry.image");
    if (e.art === "bild_entfernt") return t("kanal.entry.imageRemoved");
    return e.text ?? "";
}
const leise = (e: KanalEintrag): boolean => e.art === "status" || e.art === "bild_entfernt";

async function senden(): Promise<void> {
    if (text.value.trim() === "") return;
    if (await props.kanal.nachricht(text.value)) text.value = "";
}
async function wiederOeffnen(): Promise<void> {
    if (kommentar.value.trim() === "") return;
    if (await props.kanal.wiederOeffnen(kommentar.value)) {
        kommentar.value = "";
        frage.value = null;
    }
}
async function loeschen(): Promise<void> {
    if (await props.kanal.loeschen()) frage.value = null;
}
/** Selbst abschließen (0127): „erledigt“ nimmt den Kommentar mit, wenn einer steht; „abbrechen“ braucht ihn. */
async function abschliessen(art: "erledigt" | "abgebrochen"): Promise<void> {
    if (art === "abgebrochen" && kommentar.value.trim() === "") return;
    if (await props.kanal.abschliessen(art, kommentar.value)) {
        kommentar.value = "";
        frage.value = null;
    }
}
</script>

<template>
    <article
        v-if="v !== null"
        class="vorgang"
        :class="{ 'vorgang--telefon': props.telefon }"
        :data-testid="`kanal-vorgang-${v.ops}`"
    >
        <button type="button" class="vorgang__zurueck" data-testid="kanal-zurueck" @click="emit('zurueck')">
            ‹ {{ t("kanal.back") }}
        </button>
        <header class="vorgang__kopf">
            <span class="vorgang__ops">{{ v.ops }}</span>
            <h3 class="vorgang__titel">{{ titel }}</h3>
            <span class="vorgang__rechts">
                <span class="status" :class="`status--${statusTon(v.status)}`" data-testid="kanal-status"
                    ><span class="status__punkt" />{{ zustandName(v) }}</span
                >
                <AvmPille v-if="v.status === 'abgenommen'" ton="neutral">{{ abschlussWort }}</AvmPille>
            </span>
        </header>
        <div class="vorgang__meta">
            <span>{{ kategorieName(v.kategorie) }}</span>
            <span
                >{{ t("kanal.col.prioritaet") }}
                <AvmPille :ton="prioritaetTon(v.prioritaet)">{{ prioritaetName(v.prioritaet) }}</AvmPille></span
            >
            <span v-if="v.gemeldetVon !== null"
                >{{ t("kanal.meta.reportedBy") }} <KanalWer :wer="{ art: 'person', ...v.gemeldetVon }" />
                {{ zeit(v.gemeldetAt, now) }}</span
            >
            <span v-else-if="v.discordMelder !== undefined"
                >{{ t("kanal.meta.reportedBy") }} <KanalWer :wer="null" :discord="v.discordMelder" />
                {{ zeit(v.gemeldetAt, now) }}</span
            >
            <span v-else>{{ t("kanal.meta.reported", { time: zeit(v.gemeldetAt, now) }) }}</span>
            <span
                >{{ t("kanal.meta.assignee") }}
                <KanalWer :wer="{ art: v.zustaendig === 'claudia' ? 'claudia' : 'claudio' }"
            /></span>
            <span v-if="v.runde > 1">{{ t("kanal.meta.round", { n: v.runde }) }}</span>
        </div>

        <p v-if="istRest" class="vorgang__rest" data-testid="kanal-rest">
            {{
                t(v.vonHandGeloescht ? "kanal.rest.byHand" : "kanal.rest.expired", { time: zeit(v.abgelaufenAt!, now) })
            }}
        </p>

        <AvmHinweis v-if="wartetHier" ton="warnung" testid="kanal-vorgang-abholung">{{ wartet }}</AvmHinweis>

        <div v-if="v.status === 'zu_sichten'" class="vorgang__sichten" data-testid="kanal-sichten">
            <AvmHinweis ton="warnung" testid="kanal-sichten-hinweis">{{ t("kanal.sichten.hinweis") }}</AvmHinweis>
            <span class="vorgang__sichten-knoepfe">
                <AvmKnopf
                    art="gefuellt"
                    :gesperrt="props.kanal.busy.value === 'sichten' ? t('kanal.busy') : undefined"
                    testid="kanal-sichten-claudio"
                    @click="props.kanal.sichten('claudio')"
                    >{{ t("kanal.sichten.anClaudio") }}</AvmKnopf
                >
                <AvmKnopf
                    :gesperrt="props.kanal.busy.value === 'sichten' ? t('kanal.busy') : undefined"
                    testid="kanal-sichten-claudia"
                    @click="props.kanal.sichten('claudia')"
                    >{{ t("kanal.sichten.anClaudia") }}</AvmKnopf
                >
                <!-- WI-0297: eine Meldung für die Redaktion, nicht für Claudio oder Claudia (Vali 2026-11-09 zu OPS-000097). -->
                <AvmKnopf
                    :gesperrt="props.kanal.busy.value === 'sichten' ? t('kanal.busy') : undefined"
                    testid="kanal-sichten-community"
                    @click="props.kanal.anCommunity()"
                    >{{ t("kanal.sichten.anCommunity") }}</AvmKnopf
                >
            </span>
        </div>

        <AvmHinweis
            v-if="v.abschluss === 'an_community' && v.community !== undefined"
            ton="neutral"
            testid="kanal-an-community"
            >{{ t("kanal.anCommunity.satz", { com: v.community }) }}</AvmHinweis
        >

        <ol class="leiste" :aria-label="t('kanal.proofs.label')" data-testid="kanal-nachweise">
            <li
                v-for="s in stationen"
                :key="s.station"
                class="station"
                :class="{ 'station--voll': s.erreicht, 'station--entfallen': s.stand === 'entfallen' }"
            >
                <span class="station__punkt" aria-hidden="true">{{
                    s.erreicht ? "✓" : s.stand === "entfallen" ? "–" : ""
                }}</span>
                <span class="station__titel">{{ stationName(s.station) }}</span>
                <span v-if="s.commit" class="station__zeile"><CommitVerweis :sha="s.commit" :stellen="7" /></span>
                <span v-if="s.release" class="station__zeile">{{ s.release }}</span>
                <span v-if="s.at" class="station__zeile">{{ zeit(s.at, now) }}</span>
                <span v-else-if="!s.erreicht" class="station__zeile">{{
                    t(s.stand === "entfallen" ? "kanal.proofs.skipped" : "kanal.proofs.open")
                }}</span>
            </li>
        </ol>

        <div class="vorgang__spalten" :class="{ 'vorgang__spalten--rest': istRest }">
            <div class="vorgang__haupt">
                <section v-if="v.nachricht !== null" class="eintrag" data-testid="kanal-meldung">
                    <KanalWer
                        :wer="v.gemeldetVon === null ? null : { art: 'person', ...v.gemeldetVon }"
                        :discord="v.discordMelder"
                    />
                    <p class="eintrag__text">{{ v.titel }}</p>
                    <p class="eintrag__text">{{ v.nachricht }}</p>
                    <p v-if="v.schritte !== null" class="eintrag__text eintrag__text--leise">{{ v.schritte }}</p>
                </section>
                <ol class="verlauf" data-testid="kanal-verlauf">
                    <li
                        v-for="e in v.eintraege"
                        :key="e.seq"
                        class="verlauf__eintrag"
                        :class="{ 'verlauf__eintrag--leise': leise(e) }"
                    >
                        <span class="verlauf__kopf"
                            ><KanalWer :wer="e.von" /><span class="verlauf__zeit">{{ zeit(e.at, now) }}</span></span
                        >
                        <KanalBildEintrag
                            v-if="e.art === 'bild' && e.bild !== null"
                            :id="e.bild"
                            :kanal="props.kanal"
                            :bild="bildVon(e.bild)"
                        />
                        <p v-else class="eintrag__text">{{ eintragSatz(e) }}</p>
                    </li>
                </ol>

                <form v-if="offen" class="schreiben" data-testid="kanal-schreiben" @submit.prevent="senden">
                    <AvmTextbereich v-model="text" :zeilen="3" maxlength="8000" testid="kanal-antwort" />
                    <span class="schreiben__knoepfe">
                        <KanalBildWahl
                            mehrfach
                            :gesperrt="props.kanal.busy.value === 'bild' ? t('kanal.busy') : undefined"
                            :platz="KANAL_BILDER_JE_MELDUNG"
                            testid="kanal-bild"
                            @gewaehlt="anhaengen"
                        />
                        <AvmKnopf
                            typ="submit"
                            groesse="zeile"
                            :gesperrt="
                                props.kanal.busy.value === 'nachricht'
                                    ? t('kanal.busy')
                                    : text.trim() === ''
                                      ? t('kanal.reply.empty')
                                      : undefined
                            "
                            testid="kanal-senden"
                            >{{ t("kanal.reply.send") }}</AvmKnopf
                        >
                    </span>
                </form>

                <AvmHinweis
                    v-if="bestaetigung !== null"
                    ref="bestaetigt"
                    :ton="bestaetigung.ton"
                    rolle="status"
                    testid="kanal-bestaetigung"
                    >{{ bestaetigung.satz }}</AvmHinweis
                >

                <p v-for="(problem, i) in props.kanal.fehler.value" :key="i" class="vorgang__problem" role="alert">
                    {{ t(problem.key, problem.params) }}
                </p>

                <div v-if="offen" class="vorgang__abnahme" data-testid="kanal-betreiber-abschluss">
                    <AvmKnopf testid="kanal-erledigt" @click="frage = 'erledigt'">{{ t("kanal.done") }}</AvmKnopf>
                    <AvmKnopf testid="kanal-abbrechen" @click="frage = 'abbrechen'">{{ t("kanal.discard") }}</AvmKnopf>
                </div>
                <AvmBestaetigung
                    v-if="frage === 'erledigt'"
                    :frage="t('kanal.doneAsk')"
                    :folge="t('kanal.doneFollows')"
                    :bestaetigen="t('kanal.doneNow')"
                    testid="kanal-erledigt-frage"
                    @bestaetigen="abschliessen('erledigt')"
                    @abbrechen="frage = null"
                >
                    <AvmTextbereich v-model="kommentar" :zeilen="3" maxlength="8000" testid="kanal-erledigt-text" />
                </AvmBestaetigung>
                <AvmBestaetigung
                    v-if="frage === 'abbrechen'"
                    :frage="t('kanal.discardAsk')"
                    :folge="t('kanal.discardFollows')"
                    :bestaetigen="t('kanal.discardNow')"
                    :gesperrt="kommentar.trim() === '' ? t('kanal.discardNeedsComment') : undefined"
                    testid="kanal-abbrechen-frage"
                    @bestaetigen="abschliessen('abgebrochen')"
                    @abbrechen="frage = null"
                >
                    <AvmTextbereich v-model="kommentar" :zeilen="3" maxlength="8000" testid="kanal-abbrechen-text" />
                </AvmBestaetigung>

                <div v-if="v.status === 'zur_abnahme'" class="vorgang__abnahme">
                    <AvmKnopf art="gefuellt" testid="kanal-abnehmen" @click="props.kanal.abnehmen()">{{
                        t("kanal.accept")
                    }}</AvmKnopf>
                    <AvmKnopf testid="kanal-wieder" @click="frage = 'wieder'">{{ t("kanal.reopen") }}</AvmKnopf>
                </div>
                <AvmBestaetigung
                    v-if="frage === 'wieder'"
                    :frage="t('kanal.reopenAsk')"
                    :folge="t('kanal.reopenFollows')"
                    :bestaetigen="t('kanal.reopen')"
                    :gesperrt="kommentar.trim() === '' ? t('kanal.reopenNeedsComment') : undefined"
                    testid="kanal-wieder-frage"
                    @bestaetigen="wiederOeffnen()"
                    @abbrechen="frage = null"
                >
                    <AvmTextbereich v-model="kommentar" :zeilen="3" maxlength="8000" testid="kanal-kommentar" />
                </AvmBestaetigung>

                <div v-if="v.status === 'abgenommen' && !istRest" class="vorgang__ende" data-testid="kanal-ende">
                    <span>{{
                        t("kanal.until", { time: v.aufbewahrtBis === null ? "—" : zeit(v.aufbewahrtBis, now) })
                    }}</span>
                    <AvmKnopf art="gefahr" groesse="zeile" testid="kanal-loeschen" @click="frage = 'loeschen'"
                        ><span aria-hidden="true">⊘ </span>{{ t("kanal.delete") }}</AvmKnopf
                    >
                </div>
                <AvmBestaetigung
                    v-if="frage === 'loeschen'"
                    :frage="t('kanal.deleteAsk')"
                    :folge="t('kanal.deleteFollows', { ops: v.ops, short: v.kurztitel ?? '—' })"
                    :bestaetigen="t('kanal.deleteNow')"
                    testid="kanal-loeschen-frage"
                    @bestaetigen="loeschen()"
                    @abbrechen="frage = null"
                />
            </div>

            <aside class="vorgang__neben">
                <section v-if="Object.keys(v.kontext).length > 0" class="kasten" data-testid="kanal-kontext">
                    <h4 class="kasten__titel">{{ t("kanal.context") }}</h4>
                    <dl class="kontext">
                        <template v-for="(wert, schluessel) in v.kontext" :key="schluessel">
                            <dt>{{ kontextName(String(schluessel)) }}</dt>
                            <dd>{{ wert }}</dd>
                        </template>
                    </dl>
                </section>
                <section v-if="v.aenderungen.length > 0" class="kasten" data-testid="kanal-fixbericht">
                    <h4 class="kasten__titel">{{ t("kanal.fixReport") }}</h4>
                    <div v-for="a in v.aenderungen" :key="a.id" class="aenderung">
                        <KanalWer :wer="{ art: a.agent }" />
                        <span class="aenderung__zeile">{{
                            t("kanal.change.head", {
                                round: a.runde ?? "—",
                                klasse: a.klasse,
                                art: t(`kanal.change.art.${a.art}`),
                            })
                        }}</span>
                        <span class="aenderung__was">{{ a.was }}</span>
                        <span v-if="a.commit" class="aenderung__zeile"
                            ><CommitVerweis :sha="a.commit" :stellen="7" />{{
                                a.release ? ` · ${a.release}` : ""
                            }}</span
                        >
                        <span
                            v-for="(b, i) in a.beobachtungen"
                            :key="i"
                            class="aenderung__zeile"
                            :class="`aenderung__beob--${b.ergebnis}`"
                        >
                            {{ t(`kanal.observation.${b.ergebnis}`) }}{{ b.text ? `: ${b.text}` : "" }}
                        </span>
                        <span class="aenderung__zeile">{{
                            a.nachpruefung === null ? t("kanal.review.open") : t(`kanal.review.${a.nachpruefung}`)
                        }}</span>
                    </div>
                </section>
            </aside>
        </div>
    </article>
</template>

<style scoped>
.vorgang {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.vorgang__zurueck {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    font-size: var(--font-size-small);
    cursor: pointer;
}

.vorgang__zurueck:hover {
    color: var(--color-link-hover);
}

.vorgang__kopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-8);
}

.vorgang__ops {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

.vorgang__titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    font-weight: 400;
}

.vorgang--telefon .vorgang__titel {
    flex-basis: 100%;
    order: 3;
}

.vorgang__rechts {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    margin-left: auto;
}

.vorgang__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-10);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Text, Pille und Siegel einer Angabe auf einer Mitte (sonst sitzt „zuständig“ tiefer als das Siegel). */
.vorgang__meta > span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.vorgang__rest {
    margin: 0;
    padding: var(--space-6) var(--space-10);
    border-left: 3px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.status {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

.status__punkt {
    width: var(--avm-status-dot);
    height: var(--avm-status-dot);
    border-radius: 50%;
    background: var(--color-text-muted);
}

.status--arbeit .status__punkt {
    background: var(--color-warning);
}

.status--abnahme .status__punkt {
    background: var(--color-accent);
}

.status--fertig .status__punkt {
    background: var(--color-success);
}

.leiste {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0;
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    list-style: none;
}

.vorgang--telefon .leiste {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
}

.station {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-right: var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.station::before {
    content: "";
    position: absolute;
    top: calc(var(--icon-sm) / 2);
    left: var(--icon-sm);
    right: 0;
    height: 2px;
    background: var(--color-divider);
}

.station--voll::before {
    background: var(--color-success);
}

.station:last-child::before,
.vorgang--telefon .station::before {
    display: none;
}

.station__punkt {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--color-warning);
    background: var(--color-panel);
    color: var(--color-panel);
    line-height: 1;
}

.station--voll .station__punkt {
    background: var(--color-success);
    box-shadow: none;
}

/*
 * Entfallen (2026-10-16): Diese Station kommt nicht mehr — eine spätere ist schon erreicht. Der wartende Ring in
 * `--color-warning` sagte das Gegenteil, und zwei volle Punkte mit leeren dazwischen sahen aus wie zwei Läufe
 * nebeneinander (Betreiber: „manche laufen plötzlich parallel“). Leise Linie statt Warteton, ein Strich statt Haken.
 */
.station--entfallen .station__punkt {
    box-shadow: inset 0 0 0 2px var(--color-divider);
    color: var(--color-text-muted);
}

.station--entfallen .station__titel {
    color: var(--color-text-muted);
}

.station__titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.vorgang__spalten {
    display: grid;
    grid-template-columns: minmax(0, 1fr) calc(var(--avm-field-label-w) * 1.9);
    gap: var(--space-12);
    align-items: start;
}

/* Am Rest gibt es weder Meldung noch Verlauf: Der Fix-Bericht nimmt die ganze Breite. */
.vorgang__spalten--rest,
.vorgang--telefon .vorgang__spalten {
    grid-template-columns: minmax(0, 1fr);
}

.vorgang__haupt,
.vorgang__neben {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-width: 0;
}

.eintrag,
.verlauf__eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
}

.verlauf {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.verlauf__eintrag--leise {
    padding: 0 var(--space-10);
    border: 0;
    background: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.verlauf__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.verlauf__zeit {
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.eintrag__text {
    margin: 0;
    color: var(--color-text);
    line-height: var(--leading-snug);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.verlauf__eintrag--leise .eintrag__text,
.eintrag__text--leise {
    color: var(--color-text-muted);
}

.schreiben {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.schreiben__knoepfe,
.vorgang__abnahme {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-4);
}

/* Erst sichten (WI-0255 Paket 2): der Satz, darunter rechtsbündig die zwei Freigaben wie die Abnahme. */
.vorgang__sichten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.vorgang__sichten-knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

.vorgang__problem {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}

.vorgang__ende {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    font-size: var(--font-size-caption);
}

.kasten__titel {
    margin: 0 0 var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: 400;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.kontext {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
}

.kontext dt {
    color: var(--color-text-muted);
}

.kontext dd {
    margin: 0;
    overflow-wrap: anywhere;
}

.aenderung {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.aenderung__was {
    color: var(--color-text);
}

.aenderung__zeile {
    color: var(--color-text-muted);
}

.aenderung__beob--fehler,
.aenderung__beob--rollback,
.aenderung__beob--fallback {
    color: var(--color-warning-soft-text);
}
</style>
