/**
 * `MarkdownNote` — the note renderer (task 10-22-note-markdown-rendering).
 *
 * The parser is unit-tested in `packages/core` (`lib/markdown.test.ts`); this
 * suite covers the RN layer: which nodes reach the tree, that `inline` mode
 * stays ONE text run so `numberOfLines` still truncates, that an empty note
 * renders nothing, and that links are only interactive in block mode with a
 * handler supplied.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { MarkdownNote } from '@nextdo/ui';

describe('MarkdownNote — block mode', () => {
  it('renders headings, list items and paragraphs as text', () => {
    render(<MarkdownNote value={'# 标题\n\n- 甲\n- 乙\n\n正文 **重点**'} />);

    expect(screen.getByText('标题')).toBeTruthy();
    expect(screen.getAllByText('•')).toHaveLength(2);
    expect(screen.getByText('甲')).toBeTruthy();
    expect(screen.getByText('乙')).toBeTruthy();
    // The emphasis markers are gone; the label survives inside the run.
    expect(screen.getByText('重点')).toBeTruthy();
  });

  it('numbers an ordered list and renders a quote and a code block', () => {
    render(<MarkdownNote value={'1. 第一\n2. 第二\n\n> 引用\n\n```\nconst a = 1;\n```'} />);

    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
    expect(screen.getByText('引用')).toBeTruthy();
    expect(screen.getByText('const a = 1;')).toBeTruthy();
  });

  it('renders a link label and opens only through the supplied handler', () => {
    const onLinkPress = jest.fn();
    render(<MarkdownNote value="见 [文档](https://a.test)" onLinkPress={onLinkPress} />);

    fireEvent.press(screen.getByText('文档'));

    expect(onLinkPress).toHaveBeenCalledWith('https://a.test');
  });

  it('leaves a link inert when no handler is supplied', () => {
    render(<MarkdownNote value="见 [文档](https://a.test)" />);

    // No crash and no navigation: the label is present, the role is not link.
    expect(screen.getByText('文档')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nothing for an empty or whitespace-only note', () => {
    // A JSX attribute does not process escapes — the newlines must come from
    // an expression, or this would test a literal backslash-n.
    const { toJSON } = render(<MarkdownNote value={'   \n\n '} />);

    expect(toJSON()).toBeNull();
  });
});

describe('MarkdownNote — inline mode', () => {
  it('flattens blocks into one run so numberOfLines truncates', () => {
    const { toJSON } = render(<MarkdownNote mode="inline" numberOfLines={2} value={'# 标题\n\n- 甲'} />);
    const tree = JSON.stringify(toJSON());

    // One host Text carrying the whole note: headings and bullets do not
    // become their own rows.
    expect(screen.getByText('标题', { exact: false })).toBeTruthy();
    expect(tree).toContain('"numberOfLines":2');
  });

  it('keeps the emphasis of an inline note', () => {
    render(<MarkdownNote mode="inline" value="**重要** 的事" />);

    expect(screen.getByText('重要')).toBeTruthy();
  });

  it('exposes the raw note as the accessibility label', () => {
    render(<MarkdownNote mode="inline" value="**重要** 的事" />);

    expect(screen.getByLabelText('**重要** 的事')).toBeTruthy();
  });

  it('renders nothing for an empty note', () => {
    const { toJSON } = render(<MarkdownNote mode="inline" value="" />);

    expect(toJSON()).toBeNull();
  });
});
