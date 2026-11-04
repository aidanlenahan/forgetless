// Global UI state: quick-capture modal, toasts, confirm dialog.

export const capture = $state({ open: false, categoryId: null as string | null, text: '' });

export function openCapture(categoryId: string | null = null, text = '') {
	capture.categoryId = categoryId;
	capture.text = text;
	capture.open = true;
}

export interface Toast {
	id: number;
	message: string;
	kind: 'info' | 'error' | 'success';
	action?: { label: string; href: string };
}
export const toasts = $state<Toast[]>([]);
let toastSeq = 0;
export function toast(
	message: string,
	opts: { kind?: Toast['kind']; action?: Toast['action']; ms?: number } = {}
) {
	const t: Toast = { id: ++toastSeq, message, kind: opts.kind ?? 'info', action: opts.action };
	toasts.push(t);
	while (toasts.length > 3) toasts.shift();
	setTimeout(() => dismissToast(t.id), opts.ms ?? (opts.kind === 'error' ? 6000 : 3500));
}
export function dismissToast(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}

interface ConfirmReq {
	title: string;
	message?: string;
	confirmLabel?: string;
	danger?: boolean;
	resolve: (ok: boolean) => void;
}
export const confirmState = $state({ req: null as ConfirmReq | null });
export function confirmDialog(opts: Omit<ConfirmReq, 'resolve'>): Promise<boolean> {
	confirmState.req?.resolve(false);
	return new Promise((resolve) => {
		confirmState.req = { ...opts, resolve };
	});
}

/** True when a keyboard event originates from a text-entry element. */
export function isTypingTarget(t: EventTarget | null): boolean {
	if (!(t instanceof HTMLElement)) return false;
	if (t.isContentEditable) return true;
	const tag = t.tagName;
	if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (tag === 'INPUT') {
		const type = (t as HTMLInputElement).type;
		return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
			type
		);
	}
	return false;
}
