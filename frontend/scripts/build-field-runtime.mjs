#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootScript = path.resolve(__dirname, '../../scripts/build-field-runtime.mjs');

// Delegate directly to root script
import(rootScript);
