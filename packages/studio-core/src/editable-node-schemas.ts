import { z } from 'zod';

// This is the editable contract for the host Lexical 0.13 runtime, not the
// persisted envelope. Unknown fields remain valid persisted JSON but must not
// enter an editor that would discard them on its next exportJSON().
const version = z.literal(1).optional();
// Numeric zero is a historical unaligned default. Nonzero numeric alignment
// is persisted losslessly but cannot enter the string-based Lexical setter.
const element = {
  children: z.array(z.unknown()),
  direction: z.enum(['ltr', 'rtl']).nullable().optional(),
  format: z.union([z.enum(['', 'left', 'right', 'center', 'justify', 'start', 'end']), z.literal(0)]).optional(),
  indent: z.number().int().nonnegative().optional(),
  version,
};
const text = {
  text: z.string(),
  format: z.number().int().nonnegative().optional(),
  detail: z.number().int().nonnegative().optional(),
  mode: z.enum(['normal', 'token', 'segmented']).optional(),
  style: z.string().optional(),
  version,
};
const link = {
  ...element,
  url: z.string(),
  target: z.string().nullable().optional(),
  rel: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
};

export const StudioQuoteNodeSchema = z.strictObject({ type: z.literal('quote'), ...element });
export const StudioAutoLinkNodeSchema = z.strictObject({ type: z.literal('autolink'), ...link });
export const StudioCodeHighlightNodeSchema = z.strictObject({
  type: z.literal('code-highlight'), ...text, format: z.literal(0).optional(), highlightType: z.string().optional(),
});
export const StudioLineBreakNodeSchema = z.strictObject({ type: z.literal('linebreak'), version });
export const StudioTabNodeSchema = z.strictObject({ type: z.literal('tab'), ...text, text: z.literal('\t').optional() });

const card = {
  cardType: z.string().min(1),
  cardData: z.record(z.string(), z.unknown()),
  version,
};
const schemas: ReadonlyMap<string, z.ZodType> = new Map(Object.entries({
  root: z.strictObject({ type: z.literal('root'), ...element }),
  paragraph: z.strictObject({ type: z.literal('paragraph'), ...element }),
  heading: z.strictObject({ type: z.literal('heading'), ...element, tag: z.enum(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) }),
  text: z.strictObject({ type: z.literal('text'), ...text }),
  quote: StudioQuoteNodeSchema,
  linebreak: StudioLineBreakNodeSchema,
  tab: StudioTabNodeSchema,
  link: z.strictObject({ type: z.literal('link'), ...link }),
  autolink: StudioAutoLinkNodeSchema,
  list: z.strictObject({ type: z.literal('list'), ...element, listType: z.enum(['bullet', 'number', 'check']), start: z.number().int().optional(), tag: z.enum(['ol', 'ul']).optional() }),
  listitem: z.strictObject({ type: z.literal('listitem'), ...element, checked: z.boolean().optional(), value: z.number().int().optional() }),
  code: z.strictObject({ type: z.literal('code'), ...element, language: z.string().optional() }),
  'code-highlight': StudioCodeHighlightNodeSchema,
  table: z.strictObject({ type: z.literal('table'), ...element }),
  tablerow: z.strictObject({ type: z.literal('tablerow'), ...element }),
  tablecell: z.strictObject({ type: z.literal('tablecell'), ...element,
    colSpan: z.number().int().positive().optional(), rowSpan: z.number().int().positive().optional(),
    headerState: z.number().int().min(0).max(3).optional(),
    backgroundColor: z.string().nullable().optional(), width: z.number().positive().optional(),
  }),
  'studio-card': z.strictObject({ type: z.literal('studio-card'), ...card }),
  'react-studio-card': z.strictObject({ type: z.literal('react-studio-card'), ...card }),
}));

export interface StudioEditableNodeIssue {
  code: 'INVALID_DOCUMENT' | 'UNSUPPORTED_DOCUMENT';
  message: string;
}

/** Inspect without rewriting input or applying defaults/coercions. */
export function inspectEditableStudioNode(node: unknown): StudioEditableNodeIssue | null {
  const entry = z.object({ type: z.string() }).passthrough().safeParse(node);
  if (!entry.success) return { code: 'INVALID_DOCUMENT', message: 'Invalid or missing node type' };
  const schema = schemas.get(entry.data.type);
  if (!schema) return { code: 'UNSUPPORTED_DOCUMENT', message: `Unsupported editor node: ${entry.data.type}` };
  if (typeof entry.data.version === 'number' && entry.data.version > 1) {
    return { code: 'UNSUPPORTED_DOCUMENT', message: `Unsupported ${entry.data.type} node version` };
  }
  // Undefined fields have no persisted JSON representation; legacy card
  // normalization may add children: undefined without adding any content.
  const fields = Object.fromEntries(Object.entries(entry.data).filter(([, value]) => value !== undefined));
  const result = schema.safeParse(fields);
  if (result.success) return null;
  const unsupported = result.error.issues.some(issue => issue.code === 'unrecognized_keys');
  const paths = result.error.issues.map(issue => issue.path.join('.') || 'fields').join(', ');
  return {
    code: unsupported ? 'UNSUPPORTED_DOCUMENT' : 'INVALID_DOCUMENT',
    message: `Cannot safely edit ${entry.data.type} node (${paths})`,
  };
}
