import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PDF_RUNTIME_VERSION, copyPdfAssets } from './copy-pdf-assets.mjs';

describe('the PDF reader worker', () => {
  it('is copied under a name with the version the reader asks for', () => {
    const target = copyPdfAssets();
    expect(target.endsWith(`/public/pdf/pdf.worker-${PDF_RUNTIME_VERSION}.min.mjs`)).toBe(true);
    const reader = readFileSync(new URL('../apps/web/lib/class-import/pdf.ts', import.meta.url), 'utf8');
    expect(reader).toContain(`const PDF_RUNTIME_VERSION = '${PDF_RUNTIME_VERSION}'`);
    expect(reader).toContain('/pdf/pdf.worker-${PDF_RUNTIME_VERSION}.min.mjs');
  });
});
