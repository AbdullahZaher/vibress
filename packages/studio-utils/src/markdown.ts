import MarkdownIt from 'markdown-it';

const mdParser = new MarkdownIt({ html: false, linkify: true });

export function parseMarkdownToHtml(markdown: string): string {
  if (!markdown) return '';
  return mdParser.render(markdown);
}
