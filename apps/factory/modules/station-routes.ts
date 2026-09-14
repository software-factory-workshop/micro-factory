import { addImports, defineNuxtModule } from 'nuxt/kit';
import { factoryPorts } from '../runtime/lib/factory-config.ts';

// Production routing is declared once in vercel.json. In development the three
// independent Eve roots listen on separate ports; the browser keeps one origin.
// The migrator root also serves the shared /factory/** and /eve/v1/** routes.
export default defineNuxtModule({
  meta: { name: 'factory-station-routes' },
  setup(_options, nuxt) {
    addImports({ name: 'useEveAgent', from: 'eve/vue' });
    if (process.env.VERCEL) return;
    const rules = nuxt.options.routeRules ||= {};
    for (const [name, port] of [['migrator', factoryPorts.migrator], ['quality-gate', factoryPorts.qualityGate], ['security-gate', factoryPorts.securityGate]] as const) {
      rules[`/${name}/**`] = { proxy: `http://127.0.0.1:${port}/**` };
    }
    rules['/eve/v1/**'] = { proxy: `http://127.0.0.1:${factoryPorts.migrator}/eve/v1/**` };
    rules['/factory/**'] = { proxy: `http://127.0.0.1:${factoryPorts.migrator}/factory/**` };
  },
});
