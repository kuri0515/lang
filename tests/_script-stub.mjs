import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register('./_script-hooks.mjs', pathToFileURL('./tests/'));
