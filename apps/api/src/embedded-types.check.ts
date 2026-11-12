// Compile-time guard: the hand-written embedded.d.ts used by the web app must match src/embedded.ts.
import type * as Declared from '../embedded.js';
import type * as Implemented from './embedded.js';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export const embeddedTypesMatch: [
  Same<typeof Declared.handleApiRequest, typeof Implemented.handleApiRequest>,
  Same<typeof Declared.clientAddress, typeof Implemented.clientAddress>,
] = [true, true];
