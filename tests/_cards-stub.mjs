import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./_cards-hooks.mjs', pathToFileURL('./tests/'));
