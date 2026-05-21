#!/usr/bin/env node
// Thin shim — keeps the published bin path stable while the build output lives in dist/.
import('../dist/cli.js');
