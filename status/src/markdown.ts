/**
 * The little Markdown that incident updates use (paragraphs, lists, **bold**, _italic_ or *italic*,
 * `code`, links), turned into HTML. Everything is escaped first and only https
 * links survive, so nothing in an issue can inject markup into the status page.
 */

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function inline(text: string): string {
  const links: string[] = [];
  // Pull links out before escaping so their URLs are checked whole.
  let source = text.replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^)\s]{1,500})\)/g, (_match, label: string, url: string) => {
    links.push(`<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">${escapeHtml(label)}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  source = source.replace(/https:\/\/[^\s<>()]{1,500}[^\s<>().,;:!?'"]/g, (url) => {
    links.push(`<a href="${escapeHtml(url)}" rel="nofollow noopener noreferrer">${escapeHtml(url)}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  return escapeHtml(source)
    .replace(/`([^`\n]{1,200})`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]{1,300})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_\n]{1,300})_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])\*([^*\s][^*\n]{0,298}[^*\s]|[^*\s])\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_match, index: string) => links[Number(index)] ?? '');
}

export function markdown(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (!lines.length) return '';
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(lines[0]!);
    if (heading && lines.length === 1) return `<p><strong>${inline(heading[1]!)}</strong></p>`;
    return `<p>${lines.map((line) => inline(line.replace(/^#{1,6}\s+/, ''))).join('<br>')}</p>`;
  }).join('');
}
