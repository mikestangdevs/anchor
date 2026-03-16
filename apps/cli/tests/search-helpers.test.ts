import { describe, it, expect } from 'vitest';
import {
  cleanSnippet,
  truncateSnippet,
  SNIPPET_MAX_CHARS,
  DISPLAY_SCORE_FLOOR,
} from '../src/commands/search-helpers.js';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('Search display constants', () => {
  it('SNIPPET_MAX_CHARS is at least 500 chars (meaningfully larger than old 200)', () => {
    expect(SNIPPET_MAX_CHARS).toBeGreaterThanOrEqual(500);
  });

  it('DISPLAY_SCORE_FLOOR is above 0.20 (old permissive floor)', () => {
    expect(DISPLAY_SCORE_FLOOR).toBeGreaterThan(0.20);
  });

  it('DISPLAY_SCORE_FLOOR is at most 0.60 (not so strict nothing passes)', () => {
    expect(DISPLAY_SCORE_FLOOR).toBeLessThanOrEqual(0.60);
  });
});

// ─── cleanSnippet ───────────────────────────────────────────────────────────

describe('cleanSnippet', () => {
  it('strips markdown images', () => {
    const input = 'Intro text\n![Logo](https://example.com/logo.png)\nBody text';
    expect(cleanSnippet(input)).not.toContain('![');
    expect(cleanSnippet(input)).toContain('Intro text');
    expect(cleanSnippet(input)).toContain('Body text');
  });

  it('converts markdown links to plain text', () => {
    const input = 'See [the docs](https://example.com/docs) for details.';
    const result = cleanSnippet(input);
    expect(result).toContain('the docs');
    expect(result).not.toContain('https://example.com/docs');
    expect(result).not.toContain('[');
  });

  it('removes bare URL lines', () => {
    const input = 'Before\nhttps://example.com/some-url\nAfter';
    const result = cleanSnippet(input);
    expect(result).not.toContain('https://example.com/some-url');
    expect(result).toContain('Before');
    expect(result).toContain('After');
  });

  it('collapses triple newlines to double', () => {
    const input = 'Para 1\n\n\n\nPara 2';
    const result = cleanSnippet(input);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('trims leading and trailing whitespace', () => {
    const input = '   \n  content  \n  ';
    expect(cleanSnippet(input)).toBe('content');
  });

  it('returns empty string for empty input', () => {
    expect(cleanSnippet('')).toBe('');
  });
});

// ─── truncateSnippet ─────────────────────────────────────────────────────────

describe('truncateSnippet', () => {
  it('returns text unchanged when under maxChars', () => {
    const short = 'Short text that is well under the limit.';
    expect(truncateSnippet(short, 200)).toBe(short);
  });

  it('truncates to at most maxChars characters (plus ellipsis)', () => {
    const long = 'a'.repeat(1000);
    const result = truncateSnippet(long, 200);
    // Should not be dramatically longer than the limit
    expect(result.length).toBeLessThanOrEqual(210);
  });

  it('appends an ellipsis indicator when truncated', () => {
    const long = 'word '.repeat(200); // 1000 chars
    const result = truncateSnippet(long, 200);
    expect(result).toMatch(/\.{2,}|…/);
  });

  it('prefers to break at a newline near the limit', () => {
    // Build a string with a newline at position 180 (within the 85% window of 200)
    const text = 'x'.repeat(180) + '\n' + 'y'.repeat(200);
    const result = truncateSnippet(text, 200);
    // Should break at the newline, not mid-word
    expect(result).toMatch(/\n\s+\.\.\./);
  });

  it('falls back to word break when no newline is in the window', () => {
    // No newlines, spaces at regular intervals
    const text = ('hello world ').repeat(100); // 1200 chars
    const result = truncateSnippet(text, 200);
    // Should not end mid-word
    expect(result).not.toMatch(/\w\.\.\./);
  });

  it('uses SNIPPET_MAX_CHARS as default limit', () => {
    const long = 'a'.repeat(SNIPPET_MAX_CHARS + 200);
    const result = truncateSnippet(long);
    expect(result.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 20); // some slack for ellipsis
  });

  it('returns identical text for exact-length input', () => {
    const exact = 'x'.repeat(SNIPPET_MAX_CHARS);
    expect(truncateSnippet(exact)).toBe(exact);
  });
});
