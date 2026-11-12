<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { nachtsFreigeben } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { locale, t, type MessageKey } from "../i18n/i18n";
import { lokalErreichbar } from "../auth/lokal-probe";
import { authState } from "../auth/session-state";
import {
    kurzStand,
    laeuftGerade,
    letzterRueckweg,
    schritte,
    sperrSchluessel,
    themaName,
    uhrzeitGenau,
    zeitpunkt,
    type Freigabe,
    type LokalProbe,
    type StationStand,
} from "./freigabe";
import { freigabeZustand } from "./freigabe-zustand";
import { createLokalEinstellungen } from "./lokal-einstellungen";
import UmgebungenErhalten from "./umgebungen-erhalten.vue";
import UmgebungenGleise from "./umgebungen-gleise.vue";
import UmgebungenLauf from "./umgebungen-lauf.vue";
import UmgebungenLeiste from "./umgebungen-leiste.vue";
import {
    leistenStaende,
    leistenUmgebung,
    lokalZustand,
    nachweisTon,
    nachweisVon,
    productionZustand,
    stagePruefungZustand,
    stageZustand,
    type Fakt,
    type Verbinder,
    type Zustand,
} from "./umgebungen-leiste";
import UmgebungenLokalPanel from "./umgebungen-lokal-panel.vue";
import UmgebungenReleaseTest from "./umgebungen-release-test.vue";
import UmgebungenStation from "./umgebungen-station.vue";
import { createReleaseTest } from "./release-test";

/**
 * Systemsteuerung › Umgebungen (WI-0204; vorher „Production“, FREIGABE-0001 Stufe 1). Der Betreiber wählte am 2026-10-16 „Direkt
 * bauen“, „Gleise je Release“, „An der Bahn“ und „Nur Stationen“; Vorlage ist Fassung 2 der Probierseite.
 *
 * 🔴 **WI-0248, Vali: „das 3er stufen system … je nachdem wo man ist, soll die jeweilige umgebung markiert sein … die 3 boxen in allen
 * ansichten da und sogar gleich groß“.** Oben steht in JEDER Umgebung dieselbe Leiste Lokal → Stage → Production (`umgebungen-leiste.vue`),
 * drei gleich große Stationen (`umgebungen-station.vue`), die der Sitzung ist markiert. Unter dem Pfeil von Lokal zur Stage hängt der
 * Release-Test (sein Zustand für den Stage-Stand), unter dem von der Stage nach Production die Freigabe: seit WI-0248 kein Knopf mehr, sondern ihr
 * Zustand (Vali 2026-10-26: der Start des Release-Tests ist die Freigabe, die Auslieferung folgt automatisch bei Grün; `freigabe-zustand.ts`). Was
 * eine Umgebung nicht weiß, steht als Strich oder „nicht bekannt“; gerechnet wird in `umgebungen-leiste.ts`.
 *
 * Darunter, je nach Ort: auf der Stage, was noch nicht draußen ist (der laufende Vorgang, die Gleise, die wartenden Themen), lokal die Karte
 * „Release-Test“ (`umgebungen-release-test.vue`), auf Production die erhaltenen Releases (`umgebungen-erhalten.vue`). Läuft eine Freigabe,
 * stehen ihre Schritte darunter (`umgebungen-lauf.vue`), und die Ansicht fragt alle paar Sekunden nach. Die Gleise
 * (`umgebungen-gleise.vue`) zeigen je Freigabe und Rückweg, wo der Stand ist; sie ersetzen „Frühere Freigaben“.
 *
 * Stufe 2 (WI-0204 §10): Den laufenden Stand je Umgebung liefert `GET /api/admin/system/umgebungen` (WI-0180, eine Route für Menü und
 * Reiter), live und auch auf Production, wo es keine Statusdatei der Freigabe gibt. Für Betreiber steht unten das Panel „Lokal im Tailnet“.
 *
 * 🔴 **Keine Haken.** Die Auswahl je Thema ist Stufe 2 der Freigabe und kommt, wenn die Betreiber sie vermissen.
 */
const props = defineProps<{ freigabe: Freigabe }>();

const umgebung = authState.value.environment ?? null;
const ort = leistenUmgebung(umgebung);
/** Lokal und den Stand je Umgebung sehen nur Betreiber (`switch_environment`, WI-0180 §5.2). */
const darfLokal = authState.value.capabilities.includes("switch_environment");
const umgebungen = computed(() => props.freigabe.umgebungen.value);

// --- Release-Test: nur auf der lokalen Umgebung (WI-0248 L) -----------------------------------------------------------

/** Die Sitzung läuft in der Umgebung „development“: nur dort fragt die Ansicht nach dem Release-Test, und nur dort gibt es die Route. */
const lokalHier = ort === "development";
const releaseTest = createReleaseTest();
onMounted(() => {
    if (lokalHier && darfLokal) void releaseTest.laden();
});
/** Die Karte steht da, wo die Route antwortet; sonst bleibt der kurze Satz, dass es hier keine Freigaben gibt. */
const zeigeReleaseTest = computed(() => lokalHier && darfLokal && releaseTest.sicht.value !== null);
const testKarte = useTemplateRef<HTMLElement>("testKarte");
/** Der Link unter dem Pfeil von Lokal zur Stage: zur Karte darunter. */
function zumReleaseTest(): void {
    testKarte.value?.scrollIntoView({ block: "start" });
}

const sicht = computed(() => props.freigabe.sicht.value);
const datei = computed(() => sicht.value?.datei ?? null);
const eingabe = computed(() => ({
    umgebung,
    sicht: sicht.value,
    umgebungen: umgebungen.value,
    releaseTest: releaseTest.sicht.value,
}));
const staende = computed(() => leistenStaende(eingabe.value));
/** Die Stationen haben etwas zu zeigen: mit der Statusdatei (Stage) oder dem Live-Stand (Stage und Production). */
const zeigeBahn = computed(
    () => datei.value !== null || (umgebungen.value !== null && (ort === "staging" || ort === "production")),
);
const lauf = computed(() => props.freigabe.lauf.value);
const laeuft = computed(() => laeuftGerade(lauf.value));
const rueckweg = computed(() => letzterRueckweg(sicht.value));
const sperrSatz = computed(() => {
    const key = sperrSchluessel(props.freigabe.sperre.value, datei.value);
    return key === null ? null : t(key as MessageKey);
});
/** Eine offene Nacht-Freigabe der Stage von vor WI-0248 (`OPS-…`): Sie bleibt sichtbar und abbrechbar, bis sie erlischt; neue entstehen nicht mehr. */
const nacht = computed(() => props.freigabe.nacht.value);
/** Der Rückweg steht auch dann offen, wenn es auf der Stage nichts zu schieben gibt — er betrifft Production. */
const rueckwegOffen = computed(() => {
    const sperre = props.freigabe.sperre.value;
    // Wie der Server (`routes/freigabe.ts`): Der Rückweg wartet nur auf eine laufende Freigabe und braucht die Statusdatei; eine ungeprüfte
    // oder rote Stage hält ihn nicht auf.
    return sperre !== "laeuft" && sperre !== "nicht_eingerichtet";
});
const rueckwegGrund = computed(() => (rueckwegOffen.value ? undefined : (sperrSatz.value ?? undefined)));
/**
 * Von Hand nach Production, nur auf der Stage (Vali 2026-10-31: „mach dass ich in zukunft nach einem release test auch manuell von stage auf
 * production pushen kann“). Derselbe Server-Weg wie vor WI-0248 (`/production/release`, Passkey, Vorgang `OPS-…`, Claudios Abholer liefert aus).
 * 🔴 Offen nur mit grünem Release-Nachweis für den Stand, den Claudios Statusdatei als Stage nennt (`nachweis === "gruen"`): Ist die Stage seit dem
 * Test weiter, nennt sie den zuletzt grün geprüften Stand (Weg A, `freigabe-stand.sh`), und der geht raus. Der Volltest schreibt keinen Nachweis
 * (WI-0264 §5), öffnet den Knopf also nicht. Im Nachtmodus der Datei (`nachts`) heißt er „Für Production freigeben“; mit grünem Nachweis geht der
 * Stand gleich raus. Die Auslieferung von selbst nach einem grünen Schnelltest bleibt daneben bestehen.
 */
const nachts = computed(() => nachtsFreigeben(datei.value));
const releaseGrund = computed(() => {
    if (props.freigabe.sperre.value !== null) return sperrSatz.value ?? "";
    const n = datei.value?.nachweis;
    return n === undefined || n === "gruen" ? undefined : t("admin.production.nachTest");
});
const releaseHinweis = computed(() =>
    !nachts.value || releaseGrund.value !== undefined
        ? ""
        : t(nacht.value !== null ? "admin.production.nacht.abloesen" : "admin.production.nacht.hinweisGeprueft"),
);
const zeit = (iso: string | null): string => zeitpunkt(iso, locale.value);

/**
 * 🔴 Ein Druck räumt die Ansicht (Vali 2026-10-25: „nicht klar, ob ich den button gedrückt habe … dann weiß ich, dass es die fehler aus dem neuen
 * lauf und nicht von dem davor sind“): Vom Klick bis zur frischen Sicht steht unter der Leiste nur, was gerade geschieht; die Nachtfreigabe, der
 * Vorgang und der Rückweg von davor sind so lange weg. Eine Abweisung steht danach dort, mit der Uhrzeit des Versuchs.
 */
const versuch = computed(() => props.freigabe.versuch.value);
const versuchSatz = computed(() =>
    versuch.value === null ? "" : t(`admin.umgebungen.versuch.${versuch.value}` as MessageKey),
);
const abgewiesenUm = computed(() => uhrzeitGenau(props.freigabe.abgewiesenAm.value, locale.value));

/** Was in der Liste steht: während einer Freigabe und kurz danach die Liste von ihrem Start, sonst die der Statusdatei. */
const imLauf = computed(() => {
    const gemerkt = props.freigabe.imLauf.value;
    return lauf.value?.art === "release" && gemerkt !== null && gemerkt.ops === lauf.value.ops ? gemerkt : null;
});
const themen = computed(() => imLauf.value?.themen ?? datei.value?.themen ?? []);
const technik = computed(() => imLauf.value?.technik ?? datei.value?.technik ?? null);
const ergebnis = computed(() =>
    lauf.value !== null && !laeuft.value ? (lauf.value.fortschritt?.zustand ?? null) : null,
);
const themenTitel = computed(() => {
    const n = themen.value.length;
    if (laeuft.value && lauf.value?.art === "release") return t("admin.umgebungen.themen.laeuft", { n });
    if (imLauf.value !== null && ergebnis.value === "gruen") return t("admin.umgebungen.themen.ging", { n });
    return t("admin.production.themes", { n });
});
type ThemaWo = "wartet" | "unterwegs" | "draussen";
const themaWo = computed<ThemaWo>(() => {
    if (lauf.value?.art !== "release") return "wartet";
    if (laeuft.value) return "unterwegs";
    return ergebnis.value === "gruen" && imLauf.value !== null ? "draussen" : "wartet";
});

// --- Uhr und Nachfragen -------------------------------------------------------------------------------------------

const jetzt = ref(Date.now());
let letzteFrage = 0;
let uhr: ReturnType<typeof setInterval> | undefined;
/** Während eines Laufs alle drei Sekunden, sonst im Takt der Statusdatei; ein verborgener Tab fragt nicht. */
const takt = (): number => (laeuft.value || props.freigabe.busy.value ? 3000 : 20000);
/** Was jünger ist als das, hat das Fenster eben erst geladen; dann fragt das Öffnen des Reiters nicht noch einmal. */
const FRISCH_MS = 5000;
onMounted(() => {
    letzteFrage = Date.now();
    // Beim Öffnen des Reiters einmal frisch fragen, damit die Erreichbarkeit von Stage und Production (aus der Route, live) nicht vom
    // Laden des Fensters stammt; danach nur im Takt. Ohne bisherigen Stand lädt das Fenster gerade selbst.
    const geladen = props.freigabe.geladenAm.value;
    if (geladen !== null && letzteFrage - geladen > FRISCH_MS) void props.freigabe.laden();
    uhr = setInterval(() => {
        jetzt.value = Date.now();
        if (document.hidden || jetzt.value - letzteFrage < takt()) return;
        letzteFrage = jetzt.value;
        void props.freigabe.laden();
    }, 1000);
});
onBeforeUnmount(() => clearInterval(uhr));

// --- Lokal: Probe und Einstellungen --------------------------------------------------------------------------------

const lokal = computed(() => umgebungen.value?.lokal ?? null);
const lokalAdresse = computed(() => lokal.value?.adresse ?? null);
const probe = ref<LokalProbe>({ zustand: "ungeprueft", ms: null });
/** Die eine Probe ins Tailnet (`auth/lokal-probe.ts`), mit gemessener Zeit; aus diesem Browser, nicht vom Server. */
async function pruefen(): Promise<void> {
    const adresse = lokalAdresse.value;
    if (adresse === null || probe.value.zustand === "laeuft") return;
    probe.value = { zustand: "laeuft", ms: null };
    const beginn = performance.now();
    const ok = await lokalErreichbar(adresse);
    probe.value = { zustand: ok ? "ok" : "nein", ms: ok ? Math.round(performance.now() - beginn) : null };
}
// Beim Öffnen des Reiters einmal von selbst (`immediate`: Die Adresse steht dann oft schon da, weil das Fenster geladen hat, und ein Watcher
// ohne das hörte nur auf eine spätere Änderung; Vali: „ich muss immer auf "prüfen" klicken“), danach nur bei einer anderen Adresse. Nicht im
// Takt und nicht beim Neuzeichnen; „Prüfen“ im Panel fragt erneut. Auf Lokal selbst ist die Probe sinnlos: Die Seite kommt von dort.
watch(
    lokalAdresse,
    (adresse) => {
        probe.value = { zustand: "ungeprueft", ms: null };
        if (darfLokal && adresse !== null && !lokalHier) void pruefen();
    },
    { immediate: true },
);
const lokalEinstellungen = createLokalEinstellungen({ nachher: () => props.freigabe.laden() });
onMounted(() => {
    if (darfLokal) void lokalEinstellungen.laden();
});

/** „Stand vor …“ in der Sprache der Seite: Sekunden, ab einer Minute Minuten. */
const standVor = computed(() => {
    const am = props.freigabe.geladenAm.value;
    if (am === null) return "–";
    const s = Math.max(0, Math.floor((jetzt.value - am) / 1000));
    const [wert, einheit] = s < 60 ? [s, "second"] : [Math.floor(s / 60), "minute"];
    return new Intl.NumberFormat(locale.value, { style: "unit", unit: einheit, unitDisplay: "short" }).format(wert);
});

// --- Die drei Stationen -------------------------------------------------------------------------------------------

/** Seit wann der Stand läuft; ohne Statusdatei, wann das Release geschnitten wurde; ohne beides ein Strich. */
function stationZeit(stand: StationStand): string {
    if (stand.seit !== null) return t("admin.umgebungen.seit", { zeit: zeit(stand.seit) });
    if (stand.gebaut !== null) return t("admin.umgebungen.gebaut", { zeit: zeit(stand.gebaut) });
    return "–";
}

/** Eine Zeile mit Kreis, übersetzt für `umgebungen-station.vue`. */
function zeile(z: Zustand | null): { text: string; ton: Zustand["ton"]; fuellung: Zustand["fuellung"] } | null {
    return z === null ? null : { text: t(z.key, z.params), ton: z.ton, fuellung: z.fuellung };
}

/** Die Adresse ohne `https://`: Der Name ist lang genug, und der Port steht nur, wenn er nicht 443 ist. */
const lokalHost = computed(() => {
    const adresse = lokalAdresse.value;
    if (adresse === null) return null;
    try {
        return new URL(adresse).host;
    } catch {
        return adresse;
    }
});
const lokalFakten = computed<Fakt[]>(() =>
    lokal.value === null
        ? []
        : [
              { label: t("admin.umgebungen.fakt.adresse"), wert: lokalHost.value ?? "–", titel: lokal.value.adresse },
              {
                  label: t("admin.umgebungen.fakt.imMenue"),
                  wert: t(`admin.umgebungen.imMenue.${lokal.value.imMenue}` as MessageKey),
              },
          ],
);
const lokalZeile = computed(() => zeile(lokalZustand(lokalHier, darfLokal, lokal.value, probe.value)));
/** Gestrichelt nur, wo die Ansicht WEISS, dass es keine Adresse gibt (Betreiber); ohne das Recht ist es nicht bekannt, nicht „weg“. */
const lokalWeg = computed(() => darfLokal && !lokalHier && lokal.value === null);

/**
 * Die jüngste Freigabe, soweit der Entwicklungsrechner sie kennt (die Git-Notizen, WI-0248: sie entsteht mit dem Start des Release-Tests); sie sagt
 * nicht, dass Production sie schon trägt.
 */
const letzteFreigabe = computed(() => (lokalHier ? (releaseTest.sicht.value?.kandidat?.freigabe ?? null) : null));
/** Die Prüfung des Stands steht als eigene Zeile „Prüfung“, nicht mehr an der Stelle der Erreichbarkeit; darunter, woran sie hing. */
const stagePruefung = computed(() => stagePruefungZustand(datei.value));
const stageFakten = computed<Fakt[]>(() => [
    { label: t("admin.umgebungen.fakt.release"), wert: staende.value.stage.release ?? "–" },
    ...(stagePruefung.value === null
        ? []
        : [
              {
                  label: t("admin.umgebungen.fakt.pruefung"),
                  wert: t(stagePruefung.value.key),
                  ton: stagePruefung.value.ton,
                  zusatz: datei.value?.stagePruefung ?? undefined,
              },
          ]),
    { label: t("admin.umgebungen.fakt.neu"), wert: t("admin.umgebungen.fakt.neuStage") },
]);
const productionFakten = computed<Fakt[]>(() => [
    { label: t("admin.umgebungen.fakt.release"), wert: staende.value.production.release ?? "–" },
    ...(letzteFreigabe.value === null
        ? []
        : [
              {
                  label: t("admin.umgebungen.fakt.freigabe"),
                  wert: `${letzteFreigabe.value.von ?? "–"} · ${letzteFreigabe.value.sha.slice(0, 7)}`,
              },
          ]),
    { label: t("admin.umgebungen.fakt.neu"), wert: t("admin.umgebungen.fakt.neuProduction") },
]);

const stageZeile = computed(() => zeile(stageZustand(staende.value.stage, ort === "staging")));
const productionZeile = computed(() =>
    zeile(productionZustand(staende.value.production, lauf.value, laeuft.value, datei.value, ort === "production")),
);

// --- Die Pfeile ---------------------------------------------------------------------------------------------------

/** Von Lokal zur Stage: jeder Push; gestrichelt, solange Lokal aus diesem Browser nicht antwortet. */
const push = computed<Verbinder>(() => ({
    art: lokalHier || probe.value.zustand === "ok" ? "gleich" : "offen",
    text: t("admin.umgebungen.verbinder.push"),
    titel: t("admin.umgebungen.verbinder.pushTitel"),
}));

/** Die Verbindung zwischen Stage und Production: was wartet, oder wie weit die Freigabe ist. */
const verbinder = computed<Verbinder>(() => {
    // Ohne Statusdatei (Lokal, Production) weiß die Ansicht nicht, was wartet: nur die Linie.
    if (datei.value === null) return { art: "still", text: "", titel: "" };
    if (laeuft.value && lauf.value?.art === "release") {
        // Die Schritte zwischen Auftrag und Ende; der laufende zählt mit.
        const reihe = schritte(lauf.value).slice(1, -1);
        const i = Math.min(reihe.length, reihe.filter((schritt) => schritt.zustand === "fertig").length + 1);
        return {
            art: "lauf",
            text: `${String(i)}/${String(reihe.length)}`,
            titel: t("admin.umgebungen.verbinder.laeuft", { i, n: reihe.length }),
        };
    }
    const n = datei.value?.themen.length ?? 0;
    if (n === 0) return { art: "gleich", text: "=", titel: t("admin.production.blocked.gleich") };
    return { art: "offen", text: `${String(n)} ▸`, titel: t("admin.umgebungen.verbinder.warten", { n }) };
});

// --- Unter dem Pfeil von Lokal zur Stage: der Release-Test ----------------------------------------------------------

const nachweis = computed(() => nachweisVon(eingabe.value));
const nachweisWort = computed(() => {
    const n = nachweis.value;
    if (n.zustand === null) return null;
    if (n.zustand === "laeuft" && n.prozent !== null)
        return t("admin.umgebungen.nachweis.laeuftProzent", { n: n.prozent });
    if (n.zustand === "fehlt") return t("admin.umgebungen.nachweis.fehlt");
    return t(`admin.umgebungen.releaseTest.zustandWort.${n.zustand}` as MessageKey);
});
/** Woher die Umgebung ihr Wissen hat und wo der Test gestartet wird; lokal steht stattdessen der Link zur Karte. */
const nachweisHinweis = computed(() => {
    if (ort === "staging") return t("admin.umgebungen.nachweis.hinweis.stage");
    if (ort === "production") return t("admin.umgebungen.nachweis.hinweis.production");
    return null;
});

// --- Unter dem Pfeil von der Stage nach Production: die Freigabe -----------------------------------------------------

/**
 * 🔴 Kein Knopf mehr (WI-0248; Vali 2026-10-26: „1. Wann getestet wird: WENN ICH DAS WILL“, „3. … Nein das passiert automatisch, sobald der test grün
 * war“). Der Start des Release-Tests auf Lokal IST die Freigabe; hier steht, was aus ihr wird: auf der Stage aus Claudios Statusdatei
 * (`releaseFreigabe`, dazu sein Zusatz zur Auslieferung), auf Lokal aus dem Kandidaten des Starters. Ohne Freigabe: wie eine entsteht.
 */
const freigabeQuelle = computed(() =>
    datei.value !== null ? (datei.value.releaseFreigabe ?? null) : lokalHier ? letzteFreigabe.value : null,
);
const freigabeSatz = computed(() => {
    const z = freigabeZustand(freigabeQuelle.value);
    return { text: t(z.key, z.params), ton: z.ton };
});
/** Auf der Stage darunter, was mitginge: die Zahl der Themen und der Stand (wie bisher unter dem Knopf). */
const mitgehenSatz = computed(() => {
    const d = datei.value;
    if (d === null || laeuft.value) return "";
    return t("admin.umgebungen.mitgehen", { n: d.themen.length, stand: kurzStand(d.stage.release) });
});
</script>

<template>
    <FensterKarte :titel="t('admin.umgebungen.title')">
        <p v-if="props.freigabe.fehler.value && sicht === null" class="satz satz--fehler" role="alert">
            {{ t("admin.production.failed") }}
        </p>

        <div v-else-if="sicht !== null" class="umgebungen">
            <p class="kopfzeile">
                <span v-if="zeigeBahn" class="live" :class="{ 'live--schnell': laeuft }" data-testid="umgebungen-live">
                    <span class="live__punkt" aria-hidden="true"></span>
                    {{ t("admin.umgebungen.live", { zeit: standVor }) }}
                </span>
                <span class="satz satz--leise">{{ t("admin.umgebungen.weg") }}</span>
            </p>

            <UmgebungenLeiste :push="push" :freigabe="verbinder">
                <template #lokal>
                    <UmgebungenStation
                        testid="umgebungen-lokal"
                        zustand-testid="umgebungen-lokal-zustand"
                        :pille="t('auth.environment.development')"
                        :pille-ton="lokalHier || lokal !== null ? 'lokal' : 'neutral'"
                        :hier="lokalHier"
                        :gestrichelt="lokalWeg"
                        :stand="null"
                        :zeit="t('auth.environment.standLocal')"
                        :zustand="lokalZeile"
                        :fakten="lokalFakten"
                    />
                </template>

                <template #test>
                    <div class="zelle" data-testid="umgebungen-test">
                        <span class="zelle__titel">{{ t("admin.umgebungen.releaseTest.titel") }}</span>
                        <span class="zelle__zeile">
                            <AvmPille
                                v-if="nachweis.zustand !== null && nachweisWort !== null"
                                :ton="nachweisTon(nachweis.zustand)"
                                testid="umgebungen-test-zustand"
                                >{{ nachweisWort }}</AvmPille
                            >
                            <span v-else class="satz satz--leise" data-testid="umgebungen-test-zustand">{{
                                t("admin.umgebungen.unbekannt")
                            }}</span>
                            <span
                                v-if="nachweis.stand !== null"
                                class="zelle__stand"
                                data-testid="umgebungen-test-stand"
                                >{{ t("admin.umgebungen.nachweis.stand", { stand: nachweis.stand }) }}</span
                            >
                        </span>
                        <span v-if="nachweisHinweis !== null" class="satz satz--leise">{{ nachweisHinweis }}</span>
                        <AvmKnopf
                            v-if="zeigeReleaseTest"
                            groesse="zeile"
                            testid="umgebungen-test-link"
                            @click="zumReleaseTest()"
                            >{{ t("admin.umgebungen.nachweis.zurKarte") }}</AvmKnopf
                        >
                    </div>
                </template>

                <template #stage>
                    <UmgebungenStation
                        testid="umgebungen-stage"
                        zustand-testid="umgebungen-stage-zustand"
                        :pille="t('auth.environment.stage')"
                        pille-ton="warnung"
                        :hier="ort === 'staging'"
                        :stand="staende.stage.stand"
                        :zeit="stationZeit(staende.stage)"
                        :zustand="stageZeile"
                        :fakten="stageFakten"
                    />
                </template>

                <template #abnahme>
                    <div class="zelle" data-testid="umgebungen-abnahme">
                        <span class="zelle__titel">{{ t("admin.umgebungen.abnahme") }}</span>
                        <!-- WI-0248: Der Start des Release-Tests gibt frei, hier steht der Zustand; seit 2026-10-31 auch wieder der Knopf von Hand. -->
                        <span
                            v-if="datei !== null || lokalHier"
                            class="satz"
                            :class="freigabeSatz.ton === '' ? '' : `satz--${freigabeSatz.ton}`"
                            data-testid="umgebungen-freigabe-zustand"
                            >{{ freigabeSatz.text }}</span
                        >
                        <span
                            v-if="datei?.releaseFreigabe?.satz"
                            class="satz satz--leise"
                            data-testid="umgebungen-freigabe-satz"
                            >{{ datei.releaseFreigabe.satz }}</span
                        >
                        <AvmKnopf
                            v-if="datei !== null"
                            art="gefuellt"
                            breit
                            :gesperrt="releaseGrund ?? (props.freigabe.busy.value ? '' : undefined)"
                            testid="production-release"
                            @click="props.freigabe.nachProduction()"
                            >{{ t(nachts ? "admin.production.nacht.knopf" : "admin.production.release") }}</AvmKnopf
                        >
                        <span
                            v-if="releaseHinweis !== ''"
                            class="satz satz--leise"
                            data-testid="production-release-hinweis"
                            >{{ releaseHinweis }}</span
                        >
                        <span v-if="mitgehenSatz !== ''" class="satz satz--leise" data-testid="umgebungen-knopfsatz">{{
                            mitgehenSatz
                        }}</span>
                        <span
                            v-if="datei === null && !lokalHier"
                            class="satz satz--leise"
                            data-testid="umgebungen-knopfsatz"
                            >{{ t("admin.umgebungen.freigabeAufStage") }}</span
                        >
                    </div>
                </template>

                <template #production>
                    <UmgebungenStation
                        testid="umgebungen-production"
                        zustand-testid="umgebungen-production-zustand"
                        :pille="t('auth.environment.production')"
                        pille-ton="erfolg"
                        :hier="ort === 'production'"
                        :stand="staende.production.stand"
                        :zeit="stationZeit(staende.production)"
                        :zustand="productionZeile"
                        :fakten="productionFakten"
                    >
                        <div v-if="datei !== null" class="station__notfall">
                            <AvmKnopf
                                art="gefahr"
                                groesse="zeile"
                                :gesperrt="rueckwegGrund ?? (props.freigabe.busy.value ? '' : undefined)"
                                testid="production-rollback"
                                @click="props.freigabe.zurueck()"
                                >{{ t("admin.production.rollback") }}</AvmKnopf
                            >
                            <span class="satz satz--klein">{{ t("admin.production.rollbackHint") }}</span>
                        </div>
                    </UmgebungenStation>
                </template>
            </UmgebungenLeiste>

            <p v-if="versuch !== null" class="versuch" aria-live="polite" data-testid="umgebungen-versuch">
                <span class="umgebungen-puls"><AvmKreis fuellung="halb" :name="versuchSatz" /></span>
                <span>{{ versuchSatz }}</span>
            </p>
            <div
                v-else-if="props.freigabe.problems.value.length > 0"
                class="abweisung"
                role="alert"
                data-testid="umgebungen-abweisung"
            >
                <strong>{{ t("admin.umgebungen.abgewiesen", { zeit: abgewiesenUm }) }}</strong>
                <span v-for="problem in props.freigabe.problems.value" :key="problem.key">{{
                    t(problem.key, problem.params)
                }}</span>
            </div>

            <div v-if="nacht !== null && versuch === null" class="nacht" data-testid="production-nacht">
                <span class="nacht__kopf">{{ t("admin.production.nacht.titel", { release: nacht.release }) }}</span>
                <span class="satz satz--leise">{{
                    [
                        nacht.pruefung ?? t("admin.production.nacht.pruefungOffen"),
                        nacht.wer === null ? null : t("admin.production.nacht.von", { wer: nacht.wer }),
                    ]
                        .filter((teil) => teil !== null)
                        .join(" · ")
                }}</span>
                <!-- Ehrlich, was noch fehlt (Hauptorchestrierung 2026-10-19): Die Glocke `freigabe_erloschen` kommt erst mit Claudios nächstem
                     Bootstrap; bis dahin steht der Grund eines Erlöschens nur im Vorgang. Diese Zeile fällt weg, sobald er sie schickt. -->
                <span class="satz satz--leise" data-testid="production-nacht-ohne-glocke">{{
                    t("admin.production.nacht.ohneGlocke")
                }}</span>
                <AvmKnopf
                    :gesperrt="props.freigabe.busy.value ? '' : undefined"
                    testid="production-nacht-abbrechen"
                    @click="props.freigabe.abbrechen()"
                    >{{ t("admin.production.nacht.abbrechen") }}</AvmKnopf
                >
            </div>

            <!-- Darunter, je nach Ort: die Stage zeigt, was noch nicht draußen ist; Lokal den Stand der Tests; Production, was bei ihr ankam. -->
            <template v-if="datei !== null">
                <UmgebungenLauf v-if="versuch === null" :freigabe="props.freigabe" :jetzt="jetzt" />

                <div v-if="rueckweg !== null && versuch === null" class="rueckweg" data-testid="production-rueckweg">
                    <span class="rueckweg__kopf">{{ t("admin.production.rolledBack") }}</span>
                    <span>{{
                        t("admin.production.rolledBackText", {
                            am: zeit(rueckweg.am),
                            von: rueckweg.von,
                            auf: rueckweg.auf,
                            wer: rueckweg.durch ?? t("admin.production.rolledBackWhoUnknown"),
                        })
                    }}</span>
                    <span class="satz satz--klein"
                        >{{ t("admin.production.rolledBackHint")
                        }}<template v-if="rueckweg.vorgang !== null"> · {{ rueckweg.vorgang }}</template></span
                    >
                </div>

                <UmgebungenGleise :freigabe="props.freigabe" />

                <section class="themen-block">
                    <h4 class="ueberschrift">{{ themenTitel }}</h4>
                    <p v-if="technik !== null" class="technik">
                        <span
                            >{{ t("admin.production.migrations") }}
                            {{ technik.migrationen.join(", ") || t("admin.production.none") }}</span
                        >
                        <span>·</span>
                        <span
                            >{{ t("admin.production.grants") }}
                            {{ technik.rechte.join(", ") || t("admin.production.none") }}</span
                        >
                        <span>·</span>
                        <span
                            >{{ t("admin.production.env") }}
                            {{ technik.umgebungswerte.join(", ") || t("admin.production.none") }}</span
                        >
                    </p>
                    <ul class="themen" data-testid="production-themen">
                        <li v-for="thema in themen" :key="thema.id" class="thema">
                            <span class="thema__name">{{ themaName(thema, t("admin.production.base")) }}</span>
                            <span class="thema__satz" :class="{ 'thema__satz--roh': thema.unredigiert }">{{
                                thema.satz ?? t("admin.production.baseText")
                            }}</span>
                            <span class="thema__marken">
                                <span v-for="marke in thema.marken" :key="marke" class="marke">{{
                                    t(`admin.production.mark.${marke}` as MessageKey)
                                }}</span>
                                <span v-if="thema.unredigiert" class="marke marke--roh">{{
                                    t("admin.production.mark.unedited")
                                }}</span>
                                <span>{{ t("admin.production.changes", { n: thema.anzahl, bis: thema.bis }) }}</span>
                            </span>
                            <span class="thema__wo" :class="`thema__wo--${themaWo}`" data-testid="umgebungen-thema-wo">
                                <span :class="{ 'umgebungen-puls': themaWo === 'unterwegs' }">
                                    <AvmKreis
                                        :fuellung="
                                            themaWo === 'draussen' ? 'voll' : themaWo === 'unterwegs' ? 'halb' : 'leer'
                                        "
                                        :name="t(`admin.umgebungen.thema.${themaWo}` as MessageKey)"
                                    />
                                </span>
                                {{ t(`admin.umgebungen.thema.${themaWo}` as MessageKey) }}
                            </span>
                        </li>
                    </ul>
                </section>
            </template>
            <div v-else-if="zeigeReleaseTest" ref="testKarte" class="test-karte">
                <UmgebungenReleaseTest :test="releaseTest" />
            </div>
            <UmgebungenErhalten
                v-else-if="ort === 'production'"
                :sicht="sicht"
                :stand="staende.production"
                :zeit="stationZeit(staende.production)"
            />
            <p v-else class="satz satz--unten" data-testid="production-ohne">
                {{ t("admin.production.notSetUp") }}
            </p>

            <UmgebungenLokalPanel
                v-if="darfLokal && zeigeBahn"
                class="lokal-panel"
                :einstellungen="lokalEinstellungen"
                :probe="probe"
                :adresse="lokalAdresse"
                @pruefen="void pruefen()"
            />
        </div>
    </FensterKarte>
</template>

<style scoped>
/*
 * Raster der Ansicht (Probierseite Fassung 2): Die Leiste und die Gleise teilen sich drei gleich breite Spalten (Lokal, Stage, Production);
 * die Fuge dazwischen trägt den Pfeil. So stehen die Kreise der Gleise unter ihrer Station.
 */
/* Die Fuge gilt für die ganze Ansicht; die Leiste und die Gleise lesen sie mit (`umgebungen-leiste.vue`, `umgebungen-gleise.vue`). */
.umgebungen {
    --fuge: calc(2 * var(--space-24));
    /* Die Höhe der drei Stationen (Vali: „eine stabile höhe … 300 px?“): gleich, auch während der Probe und bei langen Texten; schmal darf
       die Station darüber hinaus wachsen (`umgebungen-station.vue`). */
    --station-hoehe: 300px;
    container: umgebungen / inline-size;
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.satz {
    margin: 0;
    color: var(--color-text-muted);
}

.satz--leise,
.satz--klein {
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.satz--klein {
    font-size: var(--font-size-caption);
}

.satz--fehler {
    color: var(--color-danger-soft-text);
}

/* Der Zustand der Freigabe (WI-0248): rot und grün wie die Pillen; sonst die gewöhnliche Farbe des Satzes. */
.satz--rot {
    color: var(--color-danger-soft-text);
}

.satz--gut {
    color: var(--color-success-soft-text);
}

.satz--unten {
    margin-top: var(--space-12);
}

/* --- Kopfzeile --- */

.kopfzeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-4) var(--space-12);
    margin: 0 0 var(--space-10);
}

.lokal-panel {
    margin-top: var(--space-16);
}

.live {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.live__punkt {
    width: var(--space-6);
    height: var(--space-6);
    border-radius: 50%;
    background: var(--color-success);
    animation: puls-punkt 2.4s ease-out infinite;
}

.live--schnell .live__punkt {
    animation-duration: 0.9s;
}

@keyframes puls-punkt {
    0% {
        box-shadow: 0 0 0 0 var(--color-success-halo);
    }
    70% {
        box-shadow: 0 0 0 var(--space-6) transparent;
    }
    100% {
        box-shadow: 0 0 0 0 transparent;
    }
}

/* --- Die Zellen unter den Pfeilen --- */

/* Deckende Fläche in der Farbe der Karte: Der Stiel vom Pfeil liegt dahinter und endet sichtbar an der Kante. */
.zelle {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
    box-sizing: border-box;
    min-width: 0;
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.zelle__titel {
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.02em;
    line-height: var(--leading-snug);
}

.zelle__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.zelle__stand {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.station__notfall {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-8);
}

.test-karte {
    margin-top: var(--space-16);
}

.rueckweg {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-12);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-sm);
    background: var(--color-warning-soft);
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.rueckweg__kopf {
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Die Nacht-Freigabe (WI-0234, WI-0248): ein Stand wartet auf die vollständige Prüfung und das Nachtfenster; Abbrechen am Zeilenende. */
/* Der Druck, der gerade unterwegs ist, und die Abweisung danach: unter der Leiste, wo danach die Freigabe oder der Vorgang steht. */
.versuch,
.abweisung {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    margin: var(--space-12) 0 0;
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.abweisung {
    border-color: var(--color-danger-soft-text);
    color: var(--color-danger-soft-text);
}

.nacht {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-10);
    margin-top: var(--space-12);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    font-size: var(--font-size-small);
}

.nacht__kopf {
    color: var(--color-text-strong);
}

.nacht > :last-child {
    margin-left: auto;
}

/* --- Themen --- */

.themen-block {
    margin-top: var(--space-16);
}

.ueberschrift {
    margin: 0 0 var(--space-6);
    font-size: var(--font-size-body);
    font-weight: var(--font-weight-bold);
}

.technik {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-6);
    margin: 0 0 var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.themen {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.thema {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-12);
    padding: var(--space-8) 0;
    border-top: 1px solid var(--color-divider);
}

.thema__name {
    color: var(--color-text-strong);
}

.thema__satz {
    grid-column: 1;
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.thema__satz--roh {
    color: var(--color-text-muted);
}

.thema__marken {
    display: flex;
    flex-wrap: wrap;
    grid-column: 1;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.thema__wo {
    display: flex;
    grid-row: 1 / 4;
    grid-column: 2;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.thema__wo--unterwegs {
    color: var(--color-text-strong);
}

.thema__wo--draussen {
    color: var(--color-success-soft-text);
}

.marke {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
}

.marke--roh {
    border-style: dashed;
    background: transparent;
}

@media (prefers-reduced-motion: reduce) {
    .live__punkt {
        animation: none;
    }
}
</style>

<style>
/* Ein laufender Kreis atmet: ein Ring um den Kreis, der Kreis selbst bleibt, wie avm-kreis ihn zeichnet. Gilt für die Ansicht
   „Umgebungen“ und ihre Bauteile (Stationen, Schritte, Gleise). */
.umgebungen-puls {
    display: inline-flex;
    border-radius: 50%;
    animation: umgebungen-atmen 1.2s ease-in-out infinite;
}

@keyframes umgebungen-atmen {
    50% {
        box-shadow: 0 0 0 var(--space-2) var(--color-success-halo);
    }
}

@media (prefers-reduced-motion: reduce) {
    .umgebungen-puls {
        animation: none;
    }
}
</style>
