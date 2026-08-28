<script lang="ts">
  import { ShieldCheck } from '@lucide/svelte';

  let { compact = false } = $props<{ compact?: boolean }>();
</script>

<div class:compact class="save-status" role="status">
  <ShieldCheck size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
  <span>{compact ? 'Private on this device' : 'Saved on this device'}</span>
</div>
