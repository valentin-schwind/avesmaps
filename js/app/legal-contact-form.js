"use strict";

// Schlankes Kontaktformular im Hinweise-Dialog. Die Nachricht geht serverseitig
// an den Betreiber (Empfaengeradresse nur in der Server-Config) -- es steht keine
// E-Mail-Adresse oeffentlich auf der Seite. Honeypot + Zeitfalle hier vorne, der
// eigentliche Spam-/Rate-Limit-Schutz sitzt serverseitig in api/app/contact.php.
(function () {
	const CONTACT_REQUEST_TIMEOUT_MS = 12000;
	const pageLoadedAt = Date.now();

	function trOrFallback(key, fallback) {
		return typeof tr === "function" ? tr(key, fallback) : fallback;
	}

	function fieldValue(form, selector) {
		const element = form.querySelector(selector);
		return element ? String(element.value || "") : "";
	}

	function setContactStatus(message, tone) {
		const statusElement = document.getElementById("legal-contact-status");
		if (!statusElement) {
			return;
		}
		statusElement.textContent = message;
		statusElement.dataset.tone = tone || "";
	}

	function resolveEndpoint() {
		return typeof getDefaultContactEndpointUrl === "function"
			? getDefaultContactEndpointUrl()
			: "api/app/contact.php";
	}

	async function submitContactMessage(payload) {
		const abortController = new AbortController();
		const timeoutId = window.setTimeout(() => abortController.abort(), CONTACT_REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(resolveEndpoint(), {
				method: "POST",
				headers: { Accept: "application/json", "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				signal: abortController.signal,
			});
			let data = null;
			try {
				data = await response.json();
			} catch (_error) {
				data = null;
			}
			if (!response.ok || !data || data.ok !== true) {
				const message = data && data.error && data.error.message
					? data.error.message
					: (data && data.message) || "";
				return { ok: false, message: message };
			}
			return { ok: true, message: data.message || "" };
		} finally {
			window.clearTimeout(timeoutId);
		}
	}

	async function handleSubmit(event) {
		event.preventDefault();
		const form = event.currentTarget;
		if (!(form instanceof HTMLFormElement) || !form.reportValidity()) {
			return;
		}
		const message = fieldValue(form, "#legal-contact-message");
		if (message.trim() === "") {
			return;
		}
		const submitButton = form.querySelector('button[type="submit"]');
		if (submitButton) {
			submitButton.disabled = true;
		}
		setContactStatus(trOrFallback("legal.contact.sending", "Nachricht wird gesendet …"), "pending");

		const result = await submitContactMessage({
			message: message,
			email: fieldValue(form, "#legal-contact-email"),
			name: fieldValue(form, "#legal-contact-name"),
			website: fieldValue(form, "#legal-contact-website"),
			elapsed_ms: Math.max(0, Date.now() - pageLoadedAt),
			page_url: window.location.href,
		}).catch(() => ({ ok: false, message: "" }));

		if (submitButton) {
			submitButton.disabled = false;
		}
		if (result.ok) {
			form.reset();
			setContactStatus(trOrFallback("legal.contact.success", "Danke! Deine Nachricht ist angekommen."), "success");
		} else {
			setContactStatus(
				result.message || trOrFallback("legal.contact.error", "Die Nachricht konnte nicht gesendet werden. Bitte später erneut versuchen."),
				"error"
			);
		}
	}

	function bindContactForm() {
		const form = document.getElementById("legal-contact-form");
		if (form) {
			form.addEventListener("submit", handleSubmit);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bindContactForm);
	} else {
		bindContactForm();
	}
})();
