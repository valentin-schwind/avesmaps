// Das Mastodon-Relais, wirklich ausgefuehrt -- mit gefaelschtem `fetch`.
// Entwurf: docs/superpowers/specs/2026-08-30-mastodon-relais-design.md
//
// 🔴 Die teuerste Zusicherung steht in Abschnitt 4: ein uebernommener Beitrag bekommt IMMER eine
// Rueckmeldung, auch wenn der Versand scheitert. Ohne sie bliebe er in `sending` liegen, und der Hub
// zeigte „wird gesendet" fuer etwas, das niemand mehr anfasst.
//
// Ausfuehren:  node tools/social/test-mastodon-relais.mjs

import assert from "node:assert";
import { relaisLauf, mastodonFehlertext } from "./mastodon-relais.mjs";

const BASIS = "https://avesmaps.example";
const INSTANZ = "https://mastodon.example";

/** Eine Antwort, wie `fetch` sie liefert. */
function antwort(status, koerper, { istBild = false } = {}) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => koerper,
		blob: async () => (istBild ? new Blob([new Uint8Array([1, 2, 3])]) : null),
	};
}

/**
 * Ein Netz aus Regeln: [Musterstueck der Adresse, Antwortgeber]. Protokolliert jeden Aufruf.
 */
function netz(regeln) {
	const aufrufe = [];
	const fetchImpl = async (url, optionen = {}) => {
		aufrufe.push({ url: String(url), optionen });
		for (const [muster, geber] of regeln) {
			if (String(url).includes(muster)) {
				return typeof geber === "function" ? geber(optionen, aufrufe) : geber;
			}
		}
		throw new Error(`Unerwarteter Abruf: ${url}`);
	};
	return { fetchImpl, aufrufe };
}

const ohneSchlaf = async () => {};
const lauf = (n) => relaisLauf({
	fetchImpl: n.fetchImpl, basis: BASIS, relayToken: "R", mastodonToken: "M", schlaf: ohneSchlaf,
});

const auftragOhneBild = {
	ok: true, arbeit: true, post_id: 46, channel: "mastodon", text: "Hallo Aventurien",
	media_url: "", media_alt: "", sprache: "de", idempotency_key: "avesmaps-social-46",
	instanz: INSTANZ,
};

// -------------------------------------------------------------------------------------------------
// 1. Nichts zu tun. ⚠️ Der NORMALFALL -- und er darf Mastodon nicht einmal anfassen.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([["relay-next", antwort(200, { ok: true, arbeit: false })]]);
	const ergebnis = await lauf(n);
	assert.strictEqual(ergebnis.gesendet, 0, "nichts gesendet");
	assert.strictEqual(n.aufrufe.length, 1, "genau EIN Abruf -- kein Mastodon, keine Rueckmeldung");
}

// -------------------------------------------------------------------------------------------------
// 2. Ein Beitrag ohne Bild.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([
		["relay-next", antwort(200, auftragOhneBild)],
		["/api/v1/statuses", antwort(200, { id: "12345", url: INSTANZ + "/@Avesmaps/12345" })],
		["relay-result", antwort(200, { ok: true, uebernommen: true })],
	]);
	const ergebnis = await lauf(n);
	assert.strictEqual(ergebnis.gesendet, 1, "gesendet");

	const status = n.aufrufe.find((a) => a.url.includes("/api/v1/statuses"));
	// ⭐ Der Idempotency-Key kommt vom SERVER und reist mit -- er ist der Grund, warum ein zweiter
	// Lauf ueber denselben Beitrag gefahrlos ist.
	assert.strictEqual(status.optionen.headers["Idempotency-Key"], "avesmaps-social-46");
	const gesendet = JSON.parse(status.optionen.body);
	assert.strictEqual(gesendet.status, "Hallo Aventurien", "der Text kommt vom Server, unveraendert");
	assert.strictEqual(gesendet.language, "de");
	assert.ok(!("media_ids" in gesendet), "ohne Bild kein media_ids");

	const rueck = n.aufrufe.find((a) => a.url.includes("relay-result"));
	const gemeldet = JSON.parse(rueck.optionen.body);
	assert.strictEqual(gemeldet.ok, true);
	assert.strictEqual(gemeldet.remote_url, INSTANZ + "/@Avesmaps/12345",
		"die Adresse nennt Mastodon selbst -- sie wird nie aus id und Instanz gebaut");
}

// -------------------------------------------------------------------------------------------------
// 3. Mit Bild: erst hochladen, dann senden. 💣 `media_ids` muss eine LISTE sein.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([
		["relay-next", antwort(200, { ...auftragOhneBild, media_url: BASIS + "/bild.jpg", media_alt: "Eine Karte" })],
		[BASIS + "/bild.jpg", antwort(200, null, { istBild: true })],
		["/api/v2/media", antwort(200, { id: "media-9" })],
		["/api/v1/statuses", antwort(200, { id: "777", url: INSTANZ + "/@Avesmaps/777" })],
		["relay-result", antwort(200, { ok: true, uebernommen: true })],
	]);
	const ergebnis = await lauf(n);
	assert.strictEqual(ergebnis.gesendet, 1, "mit Bild gesendet");

	const gesendet = JSON.parse(n.aufrufe.find((a) => a.url.includes("/api/v1/statuses")).optionen.body);
	assert.deepStrictEqual(gesendet.media_ids, ["media-9"], "media_ids ist eine Liste");

	// 💣 Die Bildbeschreibung gehoert an den UPLOAD, nicht an den Beitrag: /api/v1/statuses hat kein
	// solches Feld, nimmt es klaglos an und verwirft es -- das Bild kaeme ohne Beschreibung an, und
	// niemand wuesste davon.
	const upload = n.aufrufe.find((a) => a.url.includes("/api/v2/media"));
	assert.strictEqual(upload.optionen.body.get("description"), "Eine Karte");
	assert.ok(!("description" in gesendet), "die Beschreibung reist NICHT am Beitrag mit");
}

// -------------------------------------------------------------------------------------------------
// 4. 🔴 DIE WICHTIGSTE: Mastodon lehnt ab -- und es wird TROTZDEM zurueckgemeldet.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([
		["relay-next", antwort(200, auftragOhneBild)],
		["/api/v1/statuses", antwort(422, { error: "Validation failed: Text ist zu lang" })],
		["relay-result", antwort(200, { ok: true, uebernommen: true })],
	]);
	const ergebnis = await lauf(n);
	assert.strictEqual(ergebnis.gesendet, 0, "nicht gesendet");

	const rueck = n.aufrufe.find((a) => a.url.includes("relay-result"));
	assert.ok(rueck, "ES WIRD ZURUECKGEMELDET -- sonst haengt der Beitrag bis zum Verfall in `sending`");
	const gemeldet = JSON.parse(rueck.optionen.body);
	assert.strictEqual(gemeldet.ok, false);
	// Mastodons eigener Wortlaut reist mit: er IST die Diagnose.
	assert.ok(gemeldet.error.includes("Text ist zu lang"), "der Grund der Instanz steht im Hub");
	assert.ok(gemeldet.error.includes("422"), "samt Status");
}

// -------------------------------------------------------------------------------------------------
// 5. Dasselbe, wenn schon das Bild scheitert.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([
		["relay-next", antwort(200, { ...auftragOhneBild, media_url: BASIS + "/weg.jpg" })],
		[BASIS + "/weg.jpg", antwort(404, null)],
		["relay-result", antwort(200, { ok: true, uebernommen: true })],
	]);
	const ergebnis = await lauf(n);
	assert.strictEqual(ergebnis.gesendet, 0);
	const gemeldet = JSON.parse(n.aufrufe.find((a) => a.url.includes("relay-result")).optionen.body);
	assert.strictEqual(gemeldet.ok, false);
	assert.ok(gemeldet.error.includes("nicht abrufbar"), "der Grund benennt das Bild");
	assert.ok(!n.aufrufe.some((a) => a.url.includes("/api/v1/statuses")),
		"ohne Bild wird der Beitrag NICHT ohne Bild gesendet -- das waere ein anderer Beitrag");
}

// -------------------------------------------------------------------------------------------------
// 6. 💣 Keine id zurueck heisst NICHT gesendet -- dieselbe Zusage wie ueberall im Hub.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([
		["relay-next", antwort(200, auftragOhneBild)],
		["/api/v1/statuses", antwort(200, { seltsam: true })],
		["relay-result", antwort(200, { ok: true, uebernommen: true })],
	]);
	const ergebnis = await lauf(n);
	assert.strictEqual(ergebnis.gesendet, 0, "ohne id gilt es als nicht gesendet");
}

// -------------------------------------------------------------------------------------------------
// 7. Der Fehlertext. 💣 Mastodon meldet `error` als ZEICHENKETTE, Meta als OBJEKT -- wer den
//    Facebook-Leser abschreibt, verliert die Diagnose der Instanz.
// -------------------------------------------------------------------------------------------------
assert.ok(mastodonFehlertext(401, { error: "The access token is invalid" }).includes("access token"),
	"der Wortlaut der Instanz reist mit");
assert.ok(mastodonFehlertext(500, null).includes("500"), "ohne Rumpf bleibt wenigstens der Status");
// ⚠️ Ein OBJEKT unter `error` (Metas Form) darf nicht als "[object Object]" durchrutschen.
assert.ok(!mastodonFehlertext(400, { error: { message: "x" } }).includes("[object"),
	"eine fremde Fehlerform wird nicht in den Text gestottert");

// -------------------------------------------------------------------------------------------------
// 8. Ein unerreichbarer eigener Endpunkt WIRFT -- daran soll der Workflow rot werden.
//    ⚠️ Im Gegensatz zu einem abgelehnten Beitrag: der steht im Hub und ist dort zu sehen.
// -------------------------------------------------------------------------------------------------
{
	const n = netz([["relay-next", antwort(503, null)]]);
	await assert.rejects(() => lauf(n), /relay-next/, "ein toter eigener Endpunkt wirft");
}

console.log("mastodon-relais ok");
