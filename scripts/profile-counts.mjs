#!/usr/bin/env node
// MAP-COUNTS-1: how many tools each profile sees, straight from the registry (the relational map checks these).
import { registry } from '../src/tools/index.js';
import { profileCounts } from '../src/core/registry.js';
const c = profileCounts(registry);
console.log(`read_only=${c.read_only} everyday=${c.everyday} full=${c.full}`);
