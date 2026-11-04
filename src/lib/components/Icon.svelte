<script lang="ts" module>
	// One outline icon set, 24px grid, 1.6 stroke. Decorative by default (aria-hidden).
	const PATHS = {
		plus: 'M12 5v14M5 12h14',
		search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.6-4.6',
		dice: 'M5 3.5h14A1.5 1.5 0 0 1 20.5 5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5ZM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
		settings:
			'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.5 7.5 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.4 1 2-3.4Z',
		stack: 'M12 3 3 7.5 12 12l9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
		back: 'M15 5l-7 7 7 7',
		chevronDown: 'M6 9l6 6 6-6',
		chevronUp: 'M6 15l6-6 6 6',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
		external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
		close: 'M6 6l12 12M18 6 6 18',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		filter: 'M4 6h16M7 12h10M10 18h4',
		grid: 'M4 4h6.5v8H4zM13.5 4H20v8h-6.5zM4 15h6.5v5H4zM13.5 15H20v5h-6.5z',
		list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
		reroll: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4.5h-4.5',
		quote:
			'M9.5 7C6.5 8 5 10.5 5 14v3h5v-5H7.5c0-2 .8-3.3 2.6-4.1zM18.5 7c-3 1-4.5 3.5-4.5 7v3h5v-5h-2.5c0-2 .8-3.3 2.6-4.1z',
		alert: 'M12 4 2.8 19.5h18.4L12 4ZM12 10v4.5M12 17h.01',
		arrowUp: 'M12 19V5M6 11l6-6 6 6',
		arrowDown: 'M12 5v14M6 13l6 6 6-6',
		trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3',
		download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
		upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
		logout: 'M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3M10 16l4-4-4-4M14 12H4',
		cloudOff: 'M3 3l18 18M8 7.5A5 5 0 0 1 16.8 10a4 4 0 0 1 3 6.5M17 18H7a4.5 4.5 0 0 1-1.6-8.7',
		sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6'
	} as const;
	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
		stroke?: number;
		label?: string;
		class?: string;
	}
	let { name, size = 18, stroke = 1.6, label, class: cls = '' }: Props = $props();
</script>

<svg
	class="icon {cls}"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"><path d={PATHS[name]} /></svg
>
