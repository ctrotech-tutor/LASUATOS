/**
 * A face centroid stored compactly for the duplicate search (migration 0033):
 * big-endian float32, 4 bytes a number, the same bytes PostgreSQL's
 * float4send makes (the migration packs older rows with it). Reading 14,000
 * registered faces this way is a third of the data of the JSON column and
 * nothing to parse on the request thread (see docs/LOAD_TESTING.md, "Pilot
 * morning").
 *
 * The signatures are rounded to 6 decimal places and lie within ±1, so float32
 * (about 7 significant digits) changes a cosine score by less than 1e-6.
 */

export function packCentroid(values: readonly number[]): Buffer {
  const packed = Buffer.allocUnsafe(values.length * 4);
  for (let index = 0; index < values.length; index += 1) packed.writeFloatBE(values[index]!, index * 4);
  return packed;
}

/** The numbers back; null when the bytes cannot be a packed centroid. */
export function unpackCentroid(packed: Uint8Array): Float32Array | null {
  if (packed.byteLength === 0 || packed.byteLength % 4 !== 0) return null;
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  const values = new Float32Array(packed.byteLength / 4);
  for (let index = 0; index < values.length; index += 1) values[index] = view.getFloat32(index * 4, false);
  return values;
}
