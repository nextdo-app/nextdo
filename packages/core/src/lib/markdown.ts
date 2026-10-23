/**
 * A deliberately small Markdown parser for user-authored notes (issue #63).
 *
 * Why not a library: `packages/core` stays dependency-free (spec:
 * project/directory-structure.md Rule 1 — core has zero runtime deps), and a
 * note is one or two paragraphs the user typed into a plain text box, not a
 * README. The supported subset is exactly what such a note plausibly uses:
 *
 *   - block level: `#`/`##`/`###` headings, `-`/`*`/`+` and `1.` lists,
 *     `>` quotes, ``` fenced code, blank-line separated paragraphs;
 *   - inline level: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``,
 *     `[label](href)`, and backslash escapes.
 *
 * Everything else is literal text — an unsupported construct must degrade to
 * the characters the user typed, never disappear. That is the whole safety
 * property: the note is free text stored in the DB and shown in the UI, so
 * the parser must never throw on arbitrary input and never drop content.
 *
 * Output is a plain data tree (no React, no I/O), so both the renderer in
 * `packages/ui` and the compact one-line summary on the Now card read the
 * same parse.
 */

/** An inline span. `children` nest (bold inside a link label is not modelled —
 *  a link label is plain text). */
export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string };

/** A block-level node. `level` is capped at 3 — deeper headings render as 3
 *  (a note has no room for six visual heading sizes). */
export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'quote'; children: MarkdownInline[] }
  | { type: 'code'; text: string; lang?: string };

const BULLET_RE = /^[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\d{1,9})[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const FENCE_RE = /^```\s*([\w+-]*)\s*$/;
const CLOSING_FENCE_RE = /^```\s*$/;

/** Characters a backslash may escape, per CommonMark's ASCII punctuation set. */
const ESCAPABLE = new Set('\\`*_{}[]()#+-.!>~|'.split(''));

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/** True when `line` begins a block that must interrupt a running paragraph. */
function startsBlock(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    BULLET_RE.test(line) ||
    ORDERED_RE.test(line)
  );
}

/**
 * Find a `[label](href)` starting at `start`, or null.
 *
 * Deliberately literal: no nested brackets, no title attribute, no reference
 * links. A note that writes `[x](y` (unbalanced) keeps the raw text.
 */
function matchLink(
  source: string,
  start: number,
): { text: string; href: string; end: number } | null {
  const closeBracket = source.indexOf('](', start + 1);
  if (closeBracket === -1) return null;
  const closeParen = source.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  const text = source.slice(start + 1, closeBracket);
  const href = source.slice(closeBracket + 2, closeParen).trim();
  if (text === '' || href === '') return null;
  return { text, href, end: closeParen + 1 };
}

/**
 * Find an emphasis run starting at `start`.
 *
 * `_`/`__` are refused mid-word so `snake_case_names` in a note stay literal —
 * the single most common false positive for a naive `_` rule.
 */
function matchDelimiter(
  source: string,
  start: number,
): { node: MarkdownInline; end: number } | null {
  const tokens = ['**', '__', '~~', '*', '_'] as const;

  for (const token of tokens) {
    if (!source.startsWith(token, start)) continue;
    if (token.startsWith('_')) {
      const before = source[start - 1];
      if (before !== undefined && WORD_CHAR_RE.test(before)) continue;
    }
    const close = source.indexOf(token, start + token.length);
    // `**` with an empty body is two literal asterisks, not emphasis.
    if (close === -1 || close === start + token.length) continue;
    if (token.startsWith('_')) {
      const after = source[close + token.length];
      if (after !== undefined && WORD_CHAR_RE.test(after)) continue;
    }
    const children = parseMarkdownInline(source.slice(start + token.length, close));
    const end = close + token.length;
    if (token === '**' || token === '__') return { node: { type: 'strong', children }, end };
    if (token === '~~') return { node: { type: 'strike', children }, end };
    return { node: { type: 'em', children }, end };
  }
  return null;
}

/** Parse one line (or the joined lines of a paragraph) into inline spans. */
export function parseMarkdownInline(source: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let buffer = '';
  let i = 0;

  const flush = (): void => {
    if (buffer !== '') {
      out.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  while (i < source.length) {
    const ch = source[i];
    if (ch === undefined) break;

    if (ch === '\\') {
      const next = source[i + 1];
      if (next !== undefined && ESCAPABLE.has(next)) {
        buffer += next;
        i += 2;
        continue;
      }
    }

    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end !== -1) {
        flush();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const link = matchLink(source, i);
      if (link !== null) {
        flush();
        out.push({ type: 'link', text: link.text, href: link.href });
        i = link.end;
        continue;
      }
    }

    if (ch === '*' || ch === '_' || ch === '~') {
      const delimiter = matchDelimiter(source, i);
      if (delimiter !== null) {
        flush();
        out.push(delimiter.node);
        i = delimiter.end;
        continue;
      }
    }

    buffer += ch;
    i += 1;
  }

  flush();
  return out;
}

/** Parse a whole note into block nodes. Never throws; never drops text. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Fenced code — an unclosed fence swallows the rest, which is what the
    // user sees while still typing.
    const fence = FENCE_RE.exec(line);
    if (fence !== null) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length) {
        const inner = lines[i];
        if (inner === undefined) break;
        if (CLOSING_FENCE_RE.test(inner)) {
          i += 1;
          break;
        }
        body.push(inner);
        i += 1;
      }
      blocks.push(
        lang === ''
          ? { type: 'code', text: body.join('\n') }
          : { type: 'code', text: body.join('\n'), lang },
      );
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading !== null) {
      const hashes = heading[1] ?? '#';
      const level = Math.min(3, hashes.length) as 1 | 2 | 3;
      blocks.push({
        type: 'heading',
        level,
        children: parseMarkdownInline((heading[2] ?? '').trim()),
      });
      i += 1;
      continue;
    }

    if (QUOTE_RE.test(line)) {
      const parts: string[] = [];
      while (i < lines.length) {
        const inner = lines[i];
        if (inner === undefined) break;
        const match = QUOTE_RE.exec(inner);
        if (match === null) break;
        parts.push(match[1] ?? '');
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseMarkdownInline(parts.join(' ').trim()) });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (bullet !== null || ordered !== null) {
      const isOrdered = bullet === null;
      const items: MarkdownInline[][] = [];
      while (i < lines.length) {
        const inner = lines[i];
        if (inner === undefined) break;
        const match = isOrdered ? ORDERED_RE.exec(inner) : BULLET_RE.exec(inner);
        if (match === null) break;
        // Ordered captures title in group 2, bullet in group 1.
        items.push(parseMarkdownInline((isOrdered ? (match[2] ?? '') : (match[1] ?? '')).trim()));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    // Paragraph — consume until a blank line or a line that opens another
    // block. The guard at the bottom keeps a pathological line (one that
    // `startsBlock` rejects here but matched nothing above) from stalling.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const inner = lines[i];
      if (inner === undefined) break;
      if (inner.trim() === '' || startsBlock(inner)) break;
      paragraph.push(inner.trim());
      i += 1;
    }
    if (paragraph.length === 0) {
      paragraph.push(line.trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseMarkdownInline(paragraph.join(' ')) });
  }

  return blocks;
}

/**
 * Flatten a note into ONE inline sequence — the compact preview used where a
 * multi-block layout cannot go (the Now card, truncated to two lines).
 *
 * Blocks are joined with ` · `, list items likewise, and a code block keeps
 * only its first line: the point is to show that the note exists and hint at
 * its content, not to reproduce the document.
 */
export function markdownInlineSummary(source: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  const pushSeparator = (): void => {
    if (out.length > 0) out.push({ type: 'text', text: ' · ' });
  };

  for (const block of parseMarkdown(source)) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
      case 'quote':
        pushSeparator();
        out.push(...block.children);
        break;
      case 'code': {
        pushSeparator();
        const firstLine = block.text.split('\n')[0] ?? '';
        out.push({ type: 'code', text: firstLine });
        break;
      }
      case 'list':
        for (const item of block.items) {
          pushSeparator();
          out.push(...item);
        }
        break;
    }
  }

  return out;
}

/** The note's plain text with every Markdown marker removed. */
export function markdownToPlainText(source: string): string {
  const render = (nodes: MarkdownInline[]): string =>
    nodes
      .map((node) => {
        switch (node.type) {
          case 'text':
            return node.text;
          case 'code':
            return node.text;
          case 'link':
            return node.text;
          case 'strong':
          case 'em':
          case 'strike':
            return render(node.children);
        }
      })
      .join('');

  return parseMarkdown(source)
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
        case 'quote':
          return render(block.children);
        case 'code':
          return block.text;
        case 'list':
          return block.items.map(render).join(' · ');
      }
    })
    .join(' · ')
    .trim();
}
