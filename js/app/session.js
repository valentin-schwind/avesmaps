// Wer ist angemeldet, und was darf die Person? Der Client fragt das genau einmal beim Start.
//
// 💣 WARUM ES DIESE DATEI GIBT. Bis 2026-08-01 hing die Landschaftsebene an `?landschaften=1` -- einem
// URL-Schalter, den jeder Besucher anhängen konnte. Er war nie ein Riegel, er war eine Bitte. Der
// Owner-Auftrag („nur für Admins automatisch freischalten") verlangt einen echten Riegel, und einen
// echten Riegel gab es im Frontend bis heute nicht: `index.html` ist statisch, serverseitig gerendert
// wird der Nutzer nur in `edit/index.php` und `admin/index.php`, und die Editor-Hülle bindet die Karte
// als `<iframe ...&edit=1>` ein, ohne irgendetwas über den Nutzer weiterzugeben. Die Sitzung lebte
// ausschließlich serverseitig. Dieser Kanal ist die kleinste Brücke darüber.
//
// 🔴 DER RIEGEL FÄLLT GESCHLOSSEN AUS. Die Antwort kommt asynchron; bis sie da ist -- und für immer,
// wenn sie nie kommt -- gilt „nicht freigeschaltet". Deshalb schaltet dieses Modul niemals etwas AB,
// es schaltet nur frei. Ein Netzfehler, eine HTML-Fehlerseite, ein Zwischenspeicher: alles landet bei
// „anonym". Die Prüfung selbst ist reine Ansichtssache; die Daten hinter der Ebene sind ohnehin
// öffentlich lesbar (`api/app/ecosystem-areas.php`), hier geht es darum, was die Karte ANBIETET.
//
// ⚠️ `no-store`, nicht `no-cache`: die Antwort hängt am Sitzungs-Cookie. Eine zwischengespeicherte
// Admin-Antwort, die einem anonymen Besucher serviert wird, wäre genau der Fehler, den dieser Umbau
// abstellen soll.
(function () {
	"use strict";

	const SESSION_ENDPOINT = "api/app/session.php";

	const ANONYMOUS = Object.freeze({
		authenticated: false,
		username: null,
		role: null,
		capabilities: Object.freeze({ admin: false, edit: false, review: false }),
	});

	// Nur echtes `true` zählt. Eine als JSON geparste Fehlerseite, ein Proxy, der "0" statt false
	// schreibt, ein 1 statt true -- alles davon ist truthy und würde die Ebene sonst öffentlich machen.
	function strictBoolean(value) {
		return value === true;
	}

	function anonymousSession() {
		return {
			authenticated: false,
			username: null,
			role: null,
			capabilities: { admin: false, edit: false, review: false },
		};
	}

	function normalizeSessionPayload(payload) {
		if (!payload || typeof payload !== "object" || payload.ok === false) {
			return anonymousSession();
		}
		const capabilities = payload.capabilities;
		const hasCapabilities = capabilities && typeof capabilities === "object";
		return {
			authenticated: strictBoolean(payload.authenticated),
			username: typeof payload.username === "string" ? payload.username : null,
			role: typeof payload.role === "string" ? payload.role : null,
			capabilities: {
				admin: hasCapabilities && strictBoolean(capabilities.admin),
				edit: hasCapabilities && strictBoolean(capabilities.edit),
				review: hasCapabilities && strictBoolean(capabilities.review),
			},
		};
	}

	// Die eine Entscheidung. Heute: Admin. „Die Reviewer werden zur gegebenen Zeit Zugriff auf das
	// Tool bekommen" (Owner 2026-07-30) -- wenn es soweit ist, ist das hier eine Zeile, und der Test
	// daneben sagt, welche.
	function sessionGrantsEcosystem(payload) {
		if (!payload || typeof payload !== "object") { return false; }
		const capabilities = payload.capabilities;
		if (!capabilities || typeof capabilities !== "object") { return false; }
		return strictBoolean(capabilities.admin);
	}

	let currentSession = anonymousSession();
	let sessionPromise = null;

	function loadSession() {
		if (sessionPromise) { return sessionPromise; }
		if (typeof fetch !== "function") {
			sessionPromise = Promise.resolve(currentSession);
			return sessionPromise;
		}
		sessionPromise = fetch(SESSION_ENDPOINT, {
			method: "GET",
			credentials: "same-origin",
			headers: { Accept: "application/json" },
			cache: "no-store",
		})
			.then((response) => (response.ok ? response.json() : null))
			.catch(() => null)
			.then((payload) => {
				currentSession = normalizeSessionPayload(payload);
				return currentSession;
			});
		return sessionPromise;
	}

	if (typeof window !== "undefined") {
		window.AvesmapsSession = {
			load: loadSession,
			current: function () { return currentSession; },
			grantsEcosystem: function () { return sessionGrantsEcosystem(currentSession); },
			ANONYMOUS: ANONYMOUS,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { normalizeSessionPayload, sessionGrantsEcosystem };
	}
})();
