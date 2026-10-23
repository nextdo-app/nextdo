/**
 * `parseMarkdown` / `markdownInlineSummary` — the note renderer's only input
 * (task 10-22-note-markdown-rendering).
 *
 * The contract that matters is the degradation rule: anything outside the
 * supported subset must survive as the characters the user typed. A note is
 * free text, so no input may throw and no input may lose content.
 */
import {
  markdownInlineSummary,
  markdownToPlainText,
  parseMarkdown,
  parseMarkdownInline,
} from './markdown';

describe('parseMarkdown — inline', () => {
  it('parses bold, italic, strike, code and links', () => {
    expect(parseMarkdownInline('**粗** *斜* ~~删~~ `码` [链](https://a.test)')).toEqual([
      { type: 'strong', children: [{ type: 'text', text: '粗' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: '斜' }] },
      { type: 'text', text: ' ' },
      { type: 'strike', children: [{ type: 'text', text: '删' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: '码' },
      { type: 'text', text: ' ' },
      { type: 'link', text: '链', href: 'https://a.test' },
    ]);
  });

  it('nests emphasis inside bold', () => {
    expect(parseMarkdownInline('**a *b* c**')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'a ' },
          { type: 'em', children: [{ type: 'text', text: 'b' }] },
          { type: 'text', text: ' c' },
        ],
      },
    ]);
  });

  it('leaves snake_case names literal (an underscore is not emphasis mid-word)', () => {
    expect(parseMarkdownInline('order_id 与 user_name')).toEqual([
      { type: 'text', text: 'order_id 与 user_name' },
    ]);
  });

  it('keeps an unbalanced link literal instead of swallowing the rest', () => {
    expect(parseMarkdownInline('看 [这里](https://a.test')).toEqual([
      { type: 'text', text: '看 [这里](https://a.test' },
    ]);
  });

  it('keeps a lone backtick and empty emphasis literal', () => {
    expect(parseMarkdownInline('a ` b')).toEqual([{ type: 'text', text: 'a ` b' }]);
    expect(parseMarkdownInline('**')).toEqual([{ type: 'text', text: '**' }]);
    expect(parseMarkdownInline('****')).toEqual([{ type: 'text', text: '****' }]);
  });

  it('honours backslash escapes', () => {
    expect(parseMarkdownInline('\\*不是斜体\\*')).toEqual([{ type: 'text', text: '*不是斜体*' }]);
  });
});

describe('parseMarkdown — blocks', () => {
  it('parses headings, lists, quotes and fenced code', () => {
    const source = [
      '# 一级',
      '## 二级',
      '### 三级',
      '#### 四级按三级渲染',
      '',
      '- 甲',
      '- 乙',
      '',
      '1. 一',
      '2. 二',
      '',
      '> 引用',
      '',
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');

    expect(parseMarkdown(source)).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: '一级' }] },
      { type: 'heading', level: 2, children: [{ type: 'text', text: '二级' }] },
      { type: 'heading', level: 3, children: [{ type: 'text', text: '三级' }] },
      { type: 'heading', level: 3, children: [{ type: 'text', text: '四级按三级渲染' }] },
      {
        type: 'list',
        ordered: false,
        items: [[{ type: 'text', text: '甲' }], [{ type: 'text', text: '乙' }]],
      },
      {
        type: 'list',
        ordered: true,
        items: [[{ type: 'text', text: '一' }], [{ type: 'text', text: '二' }]],
      },
      { type: 'quote', children: [{ type: 'text', text: '引用' }] },
      { type: 'code', text: 'const a = 1;', lang: 'ts' },
    ]);
  });

  it('joins consecutive lines into one paragraph', () => {
    expect(parseMarkdown('第一行\n第二行')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '第一行 第二行' }] },
    ]);
  });

  it('keeps an unclosed fence instead of dropping the body', () => {
    expect(parseMarkdown('```\n还在输入')).toEqual([{ type: 'code', text: '还在输入' }]);
  });

  it('returns no blocks for blank input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n\n  ')).toEqual([]);
  });

  it('never throws on arbitrary input', () => {
    const nasty = ['**a', '`b', '[c](', '> d', '1.', '#', '```', '~~~', '**/**', '_a_b_'];
    for (const source of nasty) {
      expect(() => parseMarkdown(source)).not.toThrow();
    }
  });

  it('does not drop characters from plain text', () => {
    const plain = '打电话给王工 138-0000-0000，说明 3 个问题 #1 #2';
    expect(markdownToPlainText(plain)).toBe(plain);
  });
});

describe('markdownInlineSummary', () => {
  it('flattens blocks into one inline run joined by a separator', () => {
    const summary = markdownInlineSummary('# 标题\n\n- 甲\n- 乙');

    expect(summary).toEqual([
      { type: 'text', text: '标题' },
      { type: 'text', text: ' · ' },
      { type: 'text', text: '甲' },
      { type: 'text', text: ' · ' },
      { type: 'text', text: '乙' },
    ]);
  });

  it('keeps only the first line of a code block', () => {
    expect(markdownInlineSummary('```\n第一行\n第二行\n```')).toEqual([
      { type: 'code', text: '第一行' },
    ]);
  });

  it('is empty for a blank note', () => {
    expect(markdownInlineSummary('   ')).toEqual([]);
  });
});

describe('markdownToPlainText', () => {
  it('strips markers and keeps link labels, not hrefs', () => {
    expect(markdownToPlainText('**看** [文档](https://a.test)')).toBe('看 文档');
  });

  it('keeps list items on one line', () => {
    expect(markdownToPlainText('- 甲\n- 乙')).toBe('甲 · 乙');
  });
});
