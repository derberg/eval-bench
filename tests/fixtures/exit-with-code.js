#!/usr/bin/env node
// Exits with the code given as first arg, ignores everything else.
process.exit(parseInt(process.argv[2] ?? '0', 10));
