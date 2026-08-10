import { createNestingPlan } from './nesting.js';

self.addEventListener('message', event => {
    const { requestId, manifest, materials, options } = event.data || {};
    try {
        const plan = createNestingPlan(manifest, materials, options || {});
        self.postMessage({ requestId, ok: true, plan });
    } catch (error) {
        self.postMessage({
            requestId,
            ok: false,
            error: {
                name: error?.name || 'Error',
                message: error?.message || String(error)
            }
        });
    }
});
