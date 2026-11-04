<script lang="ts">
	import { page } from '$app/state';
	import ListView from '#lib/components/ListView.svelte';
</script>

<ListView categoryId={page.params.id ?? null} />
