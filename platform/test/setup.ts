import { prepareTestEnv } from './env.js';

// Must run before any module from src/ is imported:
// src/core/config.ts reads process.env once at import time
await prepareTestEnv();