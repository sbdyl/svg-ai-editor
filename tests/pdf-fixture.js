// Minimal real PDFs exercise parsing and rendering without external fixtures.
export function pdfFixture(labels = ['Reference method: latent alignment.']) {
  const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${labels.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${labels.length} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  for (const [index, label] of labels.entries()) {
    const content = `BT /F1 12 Tf 20 150 Td (${label.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  let source = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 1; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(source)); source += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const start = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  source += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(source);
}
