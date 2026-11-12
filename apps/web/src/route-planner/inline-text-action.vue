<script setup lang="ts">
const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ activate: [] }>();

function activate(): void {
    if (!props.disabled) emit("activate");
}
</script>

<template>
    <span
        role="button"
        :tabindex="disabled ? -1 : 0"
        :aria-disabled="disabled || undefined"
        @click.stop="activate"
        @keydown.enter.stop.prevent="activate"
        @keydown.space.stop.prevent="activate"
        ><slot
    /></span>
</template>
