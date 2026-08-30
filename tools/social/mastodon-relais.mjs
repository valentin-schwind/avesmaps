// Das Relais: holt einen wartenden Beitrag bei Avesmaps ab, sendet ihn von DIESER Maschine aus an
// Mastodon und meldet das Ergebnis zurueck.
// Entwurf: docs/superpowers/specs/2026-08-30-mastodon-relais-design.md
//
// 💣 WARUM ES DAS GIBT: rollenspiel.social verwirft die Pakete von avesmaps.de (Phase `tcp`, Port 80
// UND 443, gemessen 30.08.2026). Die Instanz-Administration hat eine Ausnahme abgelehnt und um eine
// Alternative gebeten. Ein GitHub-Runner hat eine andere Adresse -- das ist der ganze Trick.
//
// 💣 DIE SENDELOGIK STEHT DAMIT ZWEIMAL IM HAUS: hier in JavaScript und in
// api/_internal/social/adapters/mastodon.php in PHP. Das ist GEWOLLT und kein Versehen: der
// PHP-Weg bleibt der Rueckfall, falls die Sperre je faellt -- dann nimmt man `relay` aus dem
// Register und alles laeuft wieder direkt, ohne dass hier etwas zurueckgebaut werden muss.
// ⚠️ Wer an einer der beiden Stellen etwas an der Mastodon-Schnittstelle aendert, muss die andere
// ansehen. Was NICHT doppelt ist und auch nie werden darf: der Beitragstext (den baut der Server,
// `avesmapsSocialCompose`) und der Idempotency-Key (den gibt der Server mit).

const MEDIA_POLL_VERSUCHE = 5;
const MEDIA_POLL_PAUSE_MS = 2000;

/** Mastodons Fehlertext -- er meldet ihn als STRING, nicht als Objekt wie Meta. */
export function mastodonFehlertext(status, rumpf) {
	let text = "";
	if (rumpf && typeof rumpf === "object") {
		// 💣 `error` ist bei Mastodon eine ZEICHENKETTE. Wer den Facebook-Leser abschreibt, prueft
		// auf ein Objekt, findet nichts und verliert damit genau die Diagnose, die die Instanz
		// mitgeschickt hat.
		//
		// 💣 UND NUR EINE ZEICHENKETTE. `String(objekt)` ergibt "[object Object]" -- das saehe im
		// Hub aus wie eine Diagnose, waere aber keine, und es wuerde niemanden auf die Idee bringen,
		// dass hier eine unerwartete Antwortform ankam. Was keine Zeichenkette ist, wird
		// weggelassen; der Status bleibt dann die ganze Auskunft. (Vom eigenen Test gefunden.)
		const roh = typeof rumpf.error_description === "string" ? rumpf.error_description : rumpf.error;
		text = typeof roh === "string" ? roh.trim() : "";
	}
	const kopf = `Mastodon hat den Beitrag abgelehnt (HTTP ${status})`;
	return text === "" ? `${kopf}.` : `${kopf}: ${text}`;
}

/** Wartet -- als eigene Funktion, damit ein Test sie ersetzen kann, statt wirklich zu schlafen. */
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Das Bild zu Mastodon hochladen.
 *
 * 💣 MASTODON WILL DIE BYTES, FACEBOOK BEKOMMT EINE ADRESSE. Das Bild wird also erst von uns geholt
 * und dann weitergereicht.
 * 💣 202 IST WEDER FEHLER NOCH ERFOLG -- die Anlage wird noch verarbeitet. Wer die id trotzdem sofort
 * an den Beitrag haengt, bekommt eine 422, deren Text vom BEITRAG spricht und nicht vom Bild.
 */
export async function ladeBildHoch({ fetchImpl, instanz, token, bildUrl, beschreibung, schlaf = warte }) {
	const bildAntwort = await fetchImpl(bildUrl);
	if (!bildAntwort.ok) {
		throw new Error(`Das Bild war unter ${bildUrl} nicht abrufbar (HTTP ${bildAntwort.status}).`);
	}
	const daten = await bildAntwort.blob();

	const formular = new FormData();
	formular.append("file", daten, "avesmaps.jpg");
	if (beschreibung) { formular.append("description", beschreibung); }

	const antwort = await fetchImpl(`${instanz}/api/v2/media`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: formular,
	});
	const rumpf = await antwort.json().catch(() => null);

	if (antwort.status >= 200 && antwort.status < 300) {
		const id = rumpf && rumpf.id ? String(rumpf.id) : "";
		if (id === "") { throw new Error("Mastodon nannte keine Bild-Kennung."); }
		if (antwort.status !== 202) { return id; }

		// Der 202-Fall: gedeckelt nachfragen, bis die Anlage fertig ist.
		for (let versuch = 0; versuch < MEDIA_POLL_VERSUCHE; versuch += 1) {
			await schlaf(MEDIA_POLL_PAUSE_MS);
			const probe = await fetchImpl(`${instanz}/api/v1/media/${encodeURIComponent(id)}`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (probe.status === 200) { return id; }
		}
		throw new Error("Mastodon hat das Bild nicht rechtzeitig fertig verarbeitet.");
	}

	throw new Error(mastodonFehlertext(antwort.status, rumpf));
}

/**
 * Einen Beitrag senden.
 *
 * 💣 JSON, nicht form-encoded: `media_ids` muss eine LISTE sein, und `media_ids[0]=…` liest Rack als
 * Hash mit dem Schluessel "0".
 * ⭐ Der `Idempotency-Key` kommt vom Server und haengt allein an der Beitrags-ID -- deshalb ist ein
 * zweiter Lauf ueber denselben Beitrag gefahrlos.
 */
export async function sendeBeitrag({ fetchImpl, instanz, token, text, sprache, mediaId, idempotencyKey }) {
	const felder = { status: text, language: sprache || "de" };
	if (mediaId) { felder.media_ids = [mediaId]; }

	const antwort = await fetchImpl(`${instanz}/api/v1/statuses`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify(felder),
	});
	const rumpf = await antwort.json().catch(() => null);

	if (antwort.status < 200 || antwort.status >= 300) {
		throw new Error(mastodonFehlertext(antwort.status, rumpf));
	}
	const id = rumpf && rumpf.id ? String(rumpf.id) : "";
	// 💣 KEINE ID HEISST NICHT GESENDET -- dieselbe Zusage wie ueberall im Hub: „gesendet" bedeutet,
	// dass etwas oeffentlich sichtbar ist.
	if (id === "") { throw new Error("Mastodon nannte keine Beitrags-Kennung."); }

	// ⚠️ Die Adresse nennt Mastodon SELBST. Sie aus id und Instanz zusammenzubauen ist bei geteilten
	// Beitraegen falsch -- dann zeigt `url` auf den Ursprungsserver.
	return { remoteId: id, remoteUrl: rumpf.url ? String(rumpf.url) : "" };
}

/**
 * Ein vollstaendiger Lauf.
 *
 * 🔴 Was auch passiert: ein uebernommener Beitrag bekommt IMMER eine Rueckmeldung. Ohne sie bliebe
 * er in `sending` liegen, bis der Verfall greift -- der Hub zeigte derweil „wird gesendet" fuer
 * etwas, das niemand mehr anfasst.
 */
export async function relaisLauf({ fetchImpl, basis, relayToken, mastodonToken, log = () => {}, schlaf = warte }) {
	const naechster = await fetchImpl(`${basis}/api/social/relay-next.php`, {
		method: "POST",
		headers: { "X-Avesmaps-Relay-Token": relayToken },
	});
	if (!naechster.ok) {
		throw new Error(`relay-next.php antwortete mit HTTP ${naechster.status}.`);
	}
	const auftrag = await naechster.json();

	if (!auftrag || auftrag.arbeit !== true) {
		log("Nichts zu senden.");
		return { gesendet: 0 };
	}

	log(`Beitrag ${auftrag.post_id} uebernommen.`);

	let ergebnis = { ok: false, remote_id: "", remote_url: "", error: "" };
	try {
		let mediaId = "";
		if (auftrag.media_url) {
			mediaId = await ladeBildHoch({
				fetchImpl, instanz: auftrag.instanz, token: mastodonToken,
				bildUrl: auftrag.media_url, beschreibung: auftrag.media_alt, schlaf,
			});
		}
		const gesendet = await sendeBeitrag({
			fetchImpl, instanz: auftrag.instanz, token: mastodonToken,
			text: auftrag.text, sprache: auftrag.sprache, mediaId,
			idempotencyKey: auftrag.idempotency_key,
		});
		ergebnis = { ok: true, remote_id: gesendet.remoteId, remote_url: gesendet.remoteUrl, error: "" };
		log(`Gesendet: ${gesendet.remoteUrl || gesendet.remoteId}`);
	} catch (fehler) {
		ergebnis = { ok: false, remote_id: "", remote_url: "", error: String(fehler && fehler.message || fehler) };
		log(`Fehlgeschlagen: ${ergebnis.error}`);
	}

	const rueckmeldung = await fetchImpl(`${basis}/api/social/relay-result.php`, {
		method: "POST",
		headers: { "X-Avesmaps-Relay-Token": relayToken, "Content-Type": "application/json" },
		body: JSON.stringify({ post_id: auftrag.post_id, channel: auftrag.channel, ...ergebnis }),
	});
	if (!rueckmeldung.ok) {
		throw new Error(`relay-result.php antwortete mit HTTP ${rueckmeldung.status}.`);
	}

	return { gesendet: ergebnis.ok ? 1 : 0, fehler: ergebnis.ok ? "" : ergebnis.error };
}

// Direkt ausgefuehrt (aus dem Workflow) -- beim Import (aus dem Test) passiert hier nichts.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
	const basis = process.env.AVESMAPS_BASIS || "https://avesmaps.de";
	const relayToken = process.env.AVESMAPS_RELAY_TOKEN || "";
	const mastodonToken = process.env.MASTODON_TOKEN || "";
	if (relayToken === "" || mastodonToken === "") {
		console.error("FEHLT: AVESMAPS_RELAY_TOKEN und/oder MASTODON_TOKEN sind nicht gesetzt.");
		process.exit(1);
	}
	relaisLauf({ fetchImpl: fetch, basis, relayToken, mastodonToken, log: (t) => console.log(t) })
		.then((r) => { console.log(`Fertig. Gesendet: ${r.gesendet}`); })
		.catch((f) => { console.error(String(f && f.message || f)); process.exit(1); });
}
