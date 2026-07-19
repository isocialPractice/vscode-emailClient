import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { escapeHtml, sanitizeEmailHtml, textToHtml } from '../utils/sanitizeHtml';

describe('sanitizeEmailHtml', () => {
  it('removes script elements and their content', () => {
    const out = sanitizeEmailHtml('<p>hi</p><script>alert(1)</script><p>bye</p>');
    assert.equal(out.includes('script'), false);
    assert.equal(out.includes('alert'), false);
    assert.equal(out.includes('<p>hi</p>'), true);
  });

  it('removes iframes, objects, and forms', () => {
    const out = sanitizeEmailHtml(
      '<iframe src="https://example.com"></iframe><object data="x"></object><form action="/x"><input></form>'
    );
    assert.equal(/<(iframe|object|form)/i.test(out), false);
  });

  it('strips inline event handlers', () => {
    const out = sanitizeEmailHtml('<img src="x.png" onerror="alert(1)"><a onclick=go()>x</a>');
    assert.equal(/on(error|click)/i.test(out), false);
  });

  it('neutralizes javascript: URLs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
    assert.equal(out.includes('javascript:'), false);
  });

  it('keeps benign formatting markup', () => {
    const input = '<div style="color:#1f2328"><strong>Hello</strong> <em>there</em></div>';
    assert.equal(sanitizeEmailHtml(input), input);
  });

  it('removes style blocks and comments', () => {
    const out = sanitizeEmailHtml('<style>body{display:none}</style><!-- hidden --><p>ok</p>');
    assert.equal(out, '<p>ok</p>');
  });
});

describe('textToHtml', () => {
  it('escapes markup so text renders literally', () => {
    const out = textToHtml('1 < 2 & <b>bold?</b>');
    assert.equal(out.includes('<b>'), false);
    assert.equal(out.includes('&lt;b&gt;'), true);
  });
});

describe('escapeHtml', () => {
  it('escapes all five significant characters', () => {
    assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });
});
