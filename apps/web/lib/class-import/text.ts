/**
 * Text files as their makers wrote them. Excel's "Unicode Text" export is UTF-16 with tabs;
 * older Windows tools write Windows-1252 (where "Adébáyọ̀" would otherwise come out as
 * "AdÃ©bÃ¡yá»�"). The byte-order mark decides when there is one; otherwise UTF-8 is tried
 * strictly and Windows-1252 is the fallback.
 */
export function decodeText(bytes: Uint8Array): { readonly text: string; readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
  // UTF-16 without a mark: every other byte zero in mostly-ASCII text.
  const sample = bytes.subarray(0, 2000);
  let zeroOdd = 0;
  let zeroEven = 0;
  sample.forEach((byte, index) => { if (byte === 0) { if (index % 2) zeroOdd += 1; else zeroEven += 1; } });
  if (sample.length >= 8 && zeroOdd > sample.length * 0.3 && zeroEven < sample.length * 0.02) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  if (sample.length >= 8 && zeroEven > sample.length * 0.3 && zeroOdd < sample.length * 0.02) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
    }
  }
}
