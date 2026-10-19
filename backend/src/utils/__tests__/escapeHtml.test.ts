import { describe, it, expect } from '@jest/globals';
import { escapeHtml } from '../escapeHtml.js';

describe('escapeHtml', () => {
  it('escapes all HTML special characters', () => {
    const input = '<script>alert("xss")</script>';
    const result = escapeHtml(input);
    expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('Hello, world!')).toBe('Hello, world!');
  });
});
