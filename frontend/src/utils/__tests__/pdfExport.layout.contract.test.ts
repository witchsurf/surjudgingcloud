import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/utils/pdfExport.ts'), 'utf8');

describe('PDF export layout guards', () => {
  it('fits the competition title inside the printable cover width', () => {
    expect(source).toContain('const coverTitleMaxWidth = pageW - (MARGIN + 8) * 2');
    expect(source).toContain('doc.getTextWidth(coverTitle) > coverTitleMaxWidth');
  });

  it('keeps full country names readable in final rankings', () => {
    expect(source).toContain("['#', 'NOM', 'PAYS', 'PTS']");
    expect(source).toContain('const countryWidth = finalistsOnly ? 62 : 72');
    expect(source).not.toContain("cellWidth: finalistsOnly ? 62 : 34");
  });
});
