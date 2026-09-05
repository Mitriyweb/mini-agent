import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_MD = path.resolve(__dirname, '../../prompts/system.md');

export const INSTRUCTIONS: string = fs.readFileSync(SYSTEM_MD, 'utf8').trim();
