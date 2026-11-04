import { env } from './env';

/** Minimal SMTP sender. Uses nodemailer if installed; otherwise logs. */
export async function sendMail(to: string, subject: string, text: string) {
	try {
		const mod = 'nodemailer';
		const nodemailer = await import(/* @vite-ignore */ mod);
		const t = nodemailer.createTransport(env.smtpUrl);
		await t.sendMail({ from: env.smtpFrom || undefined, to, subject, text });
	} catch (err) {
		console.warn('[mail] could not send email (is nodemailer installed?)', err, {
			to,
			subject,
			text
		});
	}
}
