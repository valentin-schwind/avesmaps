const WIKI_DOM_CANCEL_API_URL = "/api/edit/wiki/dom-sync.php";
const cancelRunButton = document.getElementById("cancelRunBtn");
const wikiDomStatusElement = document.getElementById("status");
let cancelPollTimer = null;
let cancelRequestPending = false;

function updateCancelButton(running, cancelRequested = false) {
	if (!(cancelRunButton instanceof HTMLButtonElement)) return;
	cancelRunButton.hidden = !running;
	cancelRunButton.disabled = !running || cancelRequested || cancelRequestPending;
	cancelRunButton.textContent = cancelRequested || cancelRequestPending ? "Abbruch angefordert …" : "Import abbrechen";
}

async function fetchCancelJson(url, options = {}) {
	const response = await fetch(url, options);
	const text = await response.text();
	let payload;
	try {
		payload = JSON.parse(text);
	} catch (error) {
		throw new Error(text.slice(0, 700) || response.statusText);
	}
	if (!response.ok || payload.ok === false) {
		throw new Error(payload.error || response.statusText);
	}
	return payload;
}

async function refreshCancelState() {
	try {
		const payload = await fetchCancelJson(`${WIKI_DOM_CANCEL_API_URL}?action=status&_=${Date.now()}`);
		updateCancelButton(Boolean(payload.running), Boolean(payload.cancel_requested));
		if (!payload.running && cancelPollTimer !== null) {
			window.clearInterval(cancelPollTimer);
			cancelPollTimer = null;
			cancelRequestPending = false;
		}
	} catch (error) {
		if (wikiDomStatusElement instanceof HTMLElement) {
			wikiDomStatusElement.textContent = `Statusprüfung für Abbrechen fehlgeschlagen: ${error.message}`;
		}
	}
}

function ensureCancelPolling() {
	if (cancelPollTimer !== null) return;
	cancelPollTimer = window.setInterval(refreshCancelState, 1500);
}

async function requestImportCancel() {
	if (!(cancelRunButton instanceof HTMLButtonElement)) return;
	if (!confirm("Laufenden Wiki-DOM-Import abbrechen? Der Import stoppt nach der aktuell verarbeiteten Seite.")) return;
	cancelRequestPending = true;
	updateCancelButton(true, true);
	try {
		const payload = await fetchCancelJson(`${WIKI_DOM_CANCEL_API_URL}?action=cancel`, { method: "POST" });
		if (wikiDomStatusElement instanceof HTMLElement) {
			wikiDomStatusElement.textContent = payload.message || "Abbruch angefordert. Der Import stoppt nach der aktuellen Seite.";
		}
		ensureCancelPolling();
		refreshCancelState();
	} catch (error) {
		cancelRequestPending = false;
		updateCancelButton(true, false);
		if (wikiDomStatusElement instanceof HTMLElement) {
			wikiDomStatusElement.textContent = `Abbruch fehlgeschlagen: ${error.message}`;
		}
	}
}

if (cancelRunButton instanceof HTMLButtonElement) {
	cancelRunButton.addEventListener("click", requestImportCancel);
	refreshCancelState();
	ensureCancelPolling();
}
