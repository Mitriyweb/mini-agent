#!/usr/bin/env node
import { main } from '../dist/start.js';

main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exitCode = 1;
});
