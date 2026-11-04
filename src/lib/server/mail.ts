import { emailConfigured, renderEmail, sendEmail } from './notify/email';

/**
 * Sends a transactional email (password reset) through the SMTP transport in notify/email.ts.
 * Without SMTP_URL it logs instead, so the admin CLI reset remains the fallback.
 */
export async function sendMail(to: string, subject: string, text: string, html?: string) {
	if (!emailConfigured()) {
		console.warn('[mail] SMTP_URL is not set; not sending', { to, subject });
		return;
	}
	try {
		await sendEmail({ to, subject, text, html });
	} catch (err) {
		console.error('[mail] could not send email', { to, subject }, err);
	}
}

/** Password-reset email in the app's style. */
export async function sendPasswordReset(to: string, url: string) {
	const { html } = renderEmail({
		subject: 'Reset your password',
		preheader: 'Use this link to choose a new password.',
		heading: 'Reset your password',
		intro: 'Someone (hopefully you) asked to reset the password for this account.',
		sections: [],
		cta: { label: 'Choose a new password', url },
		reason: "If you didn't ask for this, you can ignore this email.",
		manageLink: false
	});
	await sendMail(
		to,
		'Reset your password',
		`Reset your password: ${url}\n\nIf you didn't ask for this, you can ignore this email.`,
		html
	);
}
