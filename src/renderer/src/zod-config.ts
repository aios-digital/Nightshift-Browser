import { z } from 'zod'

// zod 4 probes `new Function('')` to decide whether it may JIT-compile parsers. The shell's CSP forbids eval, so
// the probe only produces a CSP violation report. Turn it off; parsing is identical without the JIT.
// Imported first in main.tsx so it runs before any schema module is evaluated.
z.config({ jitless: true })
