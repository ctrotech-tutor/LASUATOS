import { describe, expect, it } from 'vitest';
import { markdown } from './markdown.ts';

describe('markdown', () => {
  it('renders the little Markdown updates use', () => {
    expect(markdown('**Fixed** the `login` bug.\n\n- one\n- two')).toBe('<p><strong>Fixed</strong> the <code>login</code> bug.</p><ul><li>one</li><li>two</li></ul>');
    expect(markdown('Line one\nLine two')).toBe('<p>Line one<br>Line two</p>');
  });

  it('renders *single* and _underscore_ emphasis without touching lists, maths or bold', () => {
    expect(markdown('Tap *Try again* or ask your lecturer.')).toBe('<p>Tap <em>Try again</em> or ask your lecturer.</p>');
    expect(markdown('Use _Continue with Google_.')).toBe('<p>Use <em>Continue with Google</em>.</p>');
    expect(markdown('**Bold** and *soft*')).toBe('<p><strong>Bold</strong> and <em>soft</em></p>');
    expect(markdown('2 * 3 * 4')).toBe('<p>2 * 3 * 4</p>');
    expect(markdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('escapes HTML so an issue cannot inject markup', () => {
    const html = markdown('<script>alert(1)</script> <img src=x onerror=alert(1)> "quoted"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;quoted&quot;');
  });

  it('keeps https links only', () => {
    expect(markdown('[Help](https://lasuatos.vercel.app/help)')).toContain('<a href="https://lasuatos.vercel.app/help" rel="nofollow noopener noreferrer">Help</a>');
    expect(markdown('[x](javascript:alert(1))')).not.toContain('<a');
    expect(markdown('[x](http://example.com)')).not.toContain('<a');
    expect(markdown('See https://example.com/a.')).toContain('<a href="https://example.com/a" rel="nofollow noopener noreferrer">https://example.com/a</a>.');
  });

  it('escapes link labels and quotes in URLs', () => {
    const html = markdown('[<b>x</b>](https://example.com/"onmouseover=alert(1))');
    expect(html).not.toContain('<b>');
    expect(html).not.toMatch(/href="[^"]*"onmouseover/);
  });
});
