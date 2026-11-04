<script lang="ts">
	import Modal from './Modal.svelte';
	import CapturePanel from './CapturePanel.svelte';
	import { capture } from '#lib/client/ui.svelte.ts';
</script>

<Modal
	open={capture.open}
	title="Quick capture"
	hideTitle
	placement="top"
	onclose={() => (capture.open = false)}
	testid="capture-modal"
>
	<CapturePanel />
</Modal>
