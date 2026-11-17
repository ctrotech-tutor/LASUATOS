/**
 * The last answer to each GET, with the server's ETag for it (see the API's conditional-get).
 * Polls send the tag back in If-None-Match; when nothing changed the server answers
 * `304 Not Modified` with no body and the caller gets the very same object again, so the screen
 * does not redraw and the poll cost a few hundred bytes instead of the whole register or list.
 *
 * In memory, for this tab only, for the most recent URLs; never in the browser's HTTP cache
 * (requests stay `no-store`). An answer only stands in for one read with the same schema.
 */

type Remembered = { readonly tag: string; readonly schema: unknown; readonly data: unknown };

const remembered = new Map<string, Remembered>();
const REMEMBER_AT_MOST = 80;

/** The tag to send for `url`, and the answer it stands for. */
export function rememberedAnswer(url: string, schema: unknown): Remembered | undefined {
  const known = remembered.get(url);
  return known && known.schema === schema ? known : undefined;
}

/** Keeps the latest answer (or forgets the URL when the server sent no tag). */
export function rememberAnswer(url: string, tag: string | null, schema: unknown, data: unknown): void {
  remembered.delete(url);
  if (!tag) return;
  remembered.set(url, { tag, schema, data });
  while (remembered.size > REMEMBER_AT_MOST) {
    const oldest = remembered.keys().next().value;
    if (oldest === undefined) break;
    remembered.delete(oldest);
  }
}

/** Forgets every remembered answer (signing out, or another account signing in). */
export function forgetRememberedAnswers(): void {
  remembered.clear();
}
