/**
 * Types for the bundled embedded API (dist/embedded.mjs, built from src/embedded.ts).
 * Kept by hand so the web app does not typecheck the API source with its own settings.
 */
export declare function handleApiRequest(request: Request): Promise<Response>;
export declare function clientAddress(headers: Headers): string;
