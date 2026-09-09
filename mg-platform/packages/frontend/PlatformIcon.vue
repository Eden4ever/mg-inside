<script lang="ts">
import { defineComponent, h } from 'vue';
import symbols from './icons/lucide.json' with { type: 'json' };
export default defineComponent({
  name: 'PlatformIcon',
  props: { name: { type: String, required: true } },
  setup(props) {
    return () => {
      const nodes = symbols[props.name as keyof typeof symbols] || symbols.square;
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' }, nodes.map(([tag, attributes]) => h(tag as string, attributes as Record<string, string>)));
    };
  },
});
</script>
