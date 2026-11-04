// Email channel: nodemailer transport from SMTP_URL plus a small renderer for the app's emails
// (plain text + inline-CSS HTML in the warm editorial palette). Every email links to the settings page.
import nodemailer from 'nodemailer';
import { env } from '../env';
import { APP_NAME } from '../../shared/config';

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
	html?: string;
	headers?: Record<string, string>;
}
/** The part of a nodemailer transport we use (tests swap in a fake with setMailTransport). */
export interface MailTransport {
	sendMail(m: MailMessage & { from: string }): Promise<unknown>;
}

const g = globalThis as unknown as {
	__appMail?: { url: string; transport: MailTransport };
	__appMailOverride?: MailTransport | null;
};

export function setMailTransport(t: MailTransport | null) {
	g.__appMailOverride = t;
}

export function emailConfigured(): boolean {
	return !!g.__appMailOverride || !!env.smtpUrl;
}

function transport(): MailTransport {
	if (g.__appMailOverride) return g.__appMailOverride;
	if (!env.smtpUrl) throw new Error('SMTP_URL is not set');
	if (g.__appMail?.url !== env.smtpUrl)
		g.__appMail = {
			url: env.smtpUrl,
			transport: nodemailer.createTransport(env.smtpUrl) as unknown as MailTransport
		};
	return g.__appMail.transport;
}

export function mailFrom(): string {
	if (env.smtpFrom) return env.smtpFrom;
	let host = 'localhost';
	try {
		host = new URL(env.origin).hostname || host;
	} catch {
		/* keep default */
	}
	return `"${APP_NAME}" <no-reply@${host.includes('.') ? host : `${host}.localdomain`}>`;
}

export const manageUrl = () => `${env.origin}/settings#notifications`;

export async function sendEmail(m: MailMessage): Promise<void> {
	await transport().sendMail({ from: mailFrom(), ...m });
}

// ---------- rendering ----------

export interface EmailAction {
	label: string;
	url: string;
	primary?: boolean;
}
export interface EmailItem {
	title: string;
	url: string;
	/** small line under the title, e.g. "Watch · added 7 months ago · from Sam" */
	meta?: string;
	/** quoted "why" note */
	note?: string;
	actions?: EmailAction[];
}
export interface EmailSection {
	heading: string;
	items: EmailItem[];
}
export interface EmailModel {
	subject: string;
	/** hidden inbox preview text */
	preheader: string;
	heading: string;
	intro: string;
	sections: EmailSection[];
	cta?: EmailAction;
	/** why the recipient got this ("You get this digest every Sunday.") */
	reason: string;
	/** footer link to the notification settings (default true) */
	manageLink?: boolean;
}

const C = {
	bg: '#f4f0e8',
	card: '#fbf9f5',
	ink: '#211c17',
	muted: '#5b5249',
	faint: '#6a6157',
	border: '#e0d8cb',
	accent: '#b23a1e',
	accentSoft: '#f6e1d8',
	accentText: '#9c3218'
};
const SERIF = "Newsreader, Georgia, 'Times New Roman', serif";
const SANS = "'Instrument Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const esc = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);

function itemHtml(it: EmailItem): string {
	const actions = it.actions?.length
		? `<tr><td style="padding:10px 0 2px">${it.actions
				.map(
					(a) =>
						`<a href="${esc(a.url)}" style="display:inline-block;margin:0 6px 6px 0;padding:7px 14px;border-radius:7px;font:600 13px/1 ${SANS};text-decoration:none;${
							a.primary
								? `background:${C.accent};color:#ffffff;border:1px solid ${C.accent}`
								: `background:${C.card};color:${C.ink};border:1px solid #cbc0b0`
						}">${esc(a.label)}</a>`
				)
				.join('')}</td></tr>`
		: '';
	return `<tr><td style="padding:14px 0;border-top:1px solid ${C.border}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td><a href="${esc(it.url)}" style="font:560 18px/1.3 ${SERIF};color:${C.ink};text-decoration:none">${esc(it.title)}</a></td></tr>
${it.meta ? `<tr><td style="padding-top:3px;font:13px/1.45 ${SANS};color:${C.faint}">${esc(it.meta)}</td></tr>` : ''}
${it.note ? `<tr><td style="padding-top:6px;font:italic 15px/1.45 ${SERIF};color:${C.muted}">&ldquo;${esc(it.note)}&rdquo;</td></tr>` : ''}
${actions}
</table></td></tr>`;
}

export function renderEmail(m: EmailModel): { subject: string; html: string; text: string } {
	const manage = m.manageLink === false ? null : manageUrl();
	const sections = m.sections
		.map(
			(
				s
			) => `<tr><td style="padding:22px 0 4px;font:700 11px/1 ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${C.accentText}">${esc(s.heading)}</td></tr>
<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${s.items.map(itemHtml).join('')}</table></td></tr>`
		)
		.join('');
	const cta = m.cta
		? `<tr><td style="padding:26px 0 4px"><a href="${esc(m.cta.url)}" style="display:inline-block;padding:11px 20px;border-radius:7px;background:${C.accent};color:#ffffff;font:600 14px/1 ${SANS};text-decoration:none">${esc(m.cta.label)}</a></td></tr>`
		: '';
	const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(m.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.ink};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">
<tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:0 4px 14px;font:italic 500 20px/1 ${SERIF};color:${C.accent}">${esc(APP_NAME)}</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.border};border-radius:10px;padding:26px 26px 22px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="font:560 26px/1.15 ${SERIF};letter-spacing:-.01em;color:${C.ink}">${esc(m.heading)}</td></tr>
<tr><td style="padding-top:8px;font:15px/1.5 ${SANS};color:${C.muted}">${esc(m.intro)}</td></tr>
${sections}
${cta}
</table></td></tr>
<tr><td style="padding:16px 6px 0;font:12px/1.5 ${SANS};color:${C.faint}">${esc(m.reason)}${manage ? ` <a href="${esc(manage)}" style="color:${C.accentText}">Manage or unsubscribe</a>.` : ''}</td></tr>
</table></td></tr></table></body></html>`;

	const lines: string[] = [m.heading, '', m.intro];
	for (const s of m.sections) {
		lines.push('', s.heading.toUpperCase());
		for (const it of s.items) {
			lines.push('', `* ${it.title}`);
			if (it.meta) lines.push(`  ${it.meta}`);
			if (it.note) lines.push(`  "${it.note}"`);
			lines.push(`  ${it.url}`);
			for (const a of it.actions ?? []) lines.push(`  ${a.label}: ${a.url}`);
		}
	}
	if (m.cta) lines.push('', `${m.cta.label}: ${m.cta.url}`);
	lines.push('', '--', manage ? `${m.reason} Manage or unsubscribe: ${manage}` : m.reason);
	return { subject: m.subject, html, text: lines.join('\n') };
}

/** Headers for every notification email (one-click "manage" link for mail clients). */
export const listHeaders = () => ({ 'List-Unsubscribe': `<${manageUrl()}>` });
