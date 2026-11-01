#!/usr/bin/env node
// PUB-7: `npm run launch:readiness [-- --json]` prints the public-launch readiness report (same evaluation as the owner tool
// github_launch_readiness). Read-only: it reads repository evidence and this machine's switch NAMES (fixed words, never values).
// The switches it shows are this machine's; ask the owner tool on the live server for production's. It never changes a setting.
import { evaluateLaunchReadiness, gatherLaunchFacts, readinessText } from '../src/launch/readiness.js';

const report = evaluateLaunchReadiness(await gatherLaunchFacts({ env: process.env }));
if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
else console.log(readinessText(report) + '\n\n(Switches above are this machine\'s settings. The owner tool github_launch_readiness on the live server shows production\'s.)');
