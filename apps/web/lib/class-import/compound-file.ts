/**
 * The container of old Office files (.xls from Excel 97–2003, .doc from Word 97–2003): a
 * "compound file", a little FAT file system inside one file. This reads its streams by name
 * ("Workbook", "WordDocument", "1Table"…), which is all the class-list readers need.
 *
 * Written from Microsoft's published format ([MS-CFB]); it reads only, follows every chain
 * with a step limit (a damaged or hostile file cannot loop forever) and never trusts a size
 * beyond the bytes actually there.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const MAX_SECTOR = 0xfffffffa;

export class CompoundFileError extends Error {}

export interface CompoundFile {
  /** Stream names, as written in the file. */
  readonly names: readonly string[];
  /** A stream's bytes by name (any case), or null when the file has none by that name. */
  stream(name: string): Uint8Array | null;
}

export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((value, index) => bytes[index] === value);
}

export function readCompoundFile(buffer: ArrayBuffer | Uint8Array): CompoundFile {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!isCompoundFile(bytes)) throw new CompoundFileError('not a compound file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);

  const sectorShift = u16(0x1e);
  if (sectorShift !== 9 && sectorShift !== 12) throw new CompoundFileError('unexpected sector size');
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << u16(0x20);
  const miniCutoff = u32(0x38) || 4096;
  const perSector = sectorSize / 4;
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize) + 1;
  const offsetOf = (sector: number) => (sector + 1) * sectorSize;
  const sectorBytes = (sector: number) => {
    const start = offsetOf(sector);
    if (sector > MAX_SECTOR || start >= bytes.length) throw new CompoundFileError('sector out of range');
    return bytes.subarray(start, Math.min(bytes.length, start + sectorSize));
  };

  // The FAT's own sectors: 109 in the header, then the DIFAT chain.
  const fatSectors: number[] = [];
  for (let index = 0; index < 109; index += 1) {
    const sector = u32(0x4c + index * 4);
    if (sector <= MAX_SECTOR) fatSectors.push(sector);
  }
  let difat = u32(0x44);
  for (let steps = 0; difat <= MAX_SECTOR && steps < sectorCount; steps += 1) {
    const at = offsetOf(difat);
    if (at + sectorSize > bytes.length) break;
    for (let index = 0; index < perSector - 1; index += 1) {
      const sector = u32(at + index * 4);
      if (sector <= MAX_SECTOR) fatSectors.push(sector);
    }
    difat = u32(at + (perSector - 1) * 4);
  }
  const fat: number[] = [];
  for (const sector of fatSectors) {
    const at = offsetOf(sector);
    if (at + sectorSize > bytes.length) continue;
    for (let index = 0; index < perSector; index += 1) fat.push(u32(at + index * 4));
  }

  const chain = (start: number, table: readonly number[], limit: number): number[] => {
    const sectors: number[] = [];
    let sector = start;
    while (sector !== END_OF_CHAIN && sector !== FREE && sector <= MAX_SECTOR) {
      if (sectors.length > limit) throw new CompoundFileError('broken chain');
      sectors.push(sector);
      sector = table[sector] ?? END_OF_CHAIN;
    }
    return sectors;
  };
  const readChain = (start: number, size: number): Uint8Array => {
    const sectors = chain(start, fat, sectorCount);
    const out = new Uint8Array(Math.min(size, sectors.length * sectorSize));
    let at = 0;
    for (const sector of sectors) {
      if (at >= out.length) break;
      const part = sectorBytes(sector).subarray(0, out.length - at);
      out.set(part, at);
      at += part.length;
    }
    return out.subarray(0, at);
  };

  // Directory: 128-byte entries.
  const directory = readChain(u32(0x30), sectorCount * sectorSize);
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let at = 0; at + 128 <= directory.length; at += 128) {
    const nameLength = Math.min(64, dirView.getUint16(at + 64, true));
    let name = '';
    for (let index = 0; index + 2 < nameLength; index += 2) name += String.fromCharCode(dirView.getUint16(at + index, true));
    entries.push({ name, type: directory[at + 66] ?? 0, start: dirView.getUint32(at + 116, true), size: dirView.getUint32(at + 120, true) });
  }
  const root = entries.find((entry) => entry.type === 5);
  if (!root) throw new CompoundFileError('no root entry');

  let miniStream: Uint8Array | null = null;
  let miniFat: number[] | null = null;
  const mini = () => {
    if (!miniStream || !miniFat) {
      miniStream = readChain(root.start, root.size);
      const table = readChain(u32(0x3c), u32(0x40) * sectorSize);
      const tableView = new DataView(table.buffer, table.byteOffset, table.byteLength);
      miniFat = [];
      for (let at = 0; at + 4 <= table.length; at += 4) miniFat.push(tableView.getUint32(at, true));
    }
    return { stream: miniStream, table: miniFat };
  };

  const streams = entries.filter((entry) => entry.type === 2);
  return {
    names: streams.map((entry) => entry.name),
    stream(name: string) {
      const wanted = name.toLowerCase();
      const entry = streams.find((item) => item.name.toLowerCase() === wanted);
      if (!entry) return null;
      if (entry.size >= miniCutoff) return readChain(entry.start, entry.size);
      const { stream, table } = mini();
      const sectors = chain(entry.start, table, Math.ceil(stream.length / miniSectorSize) + 1);
      const out = new Uint8Array(Math.min(entry.size, sectors.length * miniSectorSize));
      let at = 0;
      for (const sector of sectors) {
        if (at >= out.length) break;
        const start = sector * miniSectorSize;
        const part = stream.subarray(start, Math.min(stream.length, start + miniSectorSize, start + out.length - at));
        out.set(part, at);
        at += part.length;
      }
      return out.subarray(0, at);
    },
  };
}
