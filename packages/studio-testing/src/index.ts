import { StudioDocument } from '@vibress/studio-core';

export const XSS_TEST_PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src="x" onerror="alert(1)">',
  '<a href="javascript:alert(1)">Click me</a>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<div onclick="alert(1)">Click</div>',
];

export function createTestStudioDocument(): StudioDocument {
  return {
    schema: 'vibress-studio',
    version: 1,
    editor: { lexicalVersion: '0.13.1' },
    root: {
      type: 'root',
      children: [
        {
          type: 'heading',
          tag: 'h1',
          children: [{ type: 'text', text: 'Welcome to Vibress Studio', format: 0, mode: 'normal', version: 1 }],
          version: 1,
        },
        {
          type: 'paragraph',
          children: [
            { type: 'text', text: 'This is a ', format: 0, mode: 'normal', version: 1 },
            { type: 'text', text: 'bold', format: 1, mode: 'normal', version: 1 },
            { type: 'text', text: ' and ', format: 0, mode: 'normal', version: 1 },
            { type: 'text', text: 'italic', format: 2, mode: 'normal', version: 1 },
            { type: 'text', text: ' paragraph.', format: 0, mode: 'normal', version: 1 },
          ],
          version: 1,
        },
        {
          type: 'studio-card',
          cardType: 'image',
          cardData: { src: 'https://example.com/test.jpg', alt: 'Test Image', caption: 'Sample Caption' },
          version: 1,
        },
      ],
      version: 1,
    },
  };
}

export function createStressTestStudioDocument(paragraphCount = 200): StudioDocument {
  const children: unknown[] = [
    {
      type: 'heading',
      tag: 'h1',
      children: [{ type: 'text', text: `Stress Test Document (${paragraphCount} Paragraphs)`, format: 0, mode: 'normal', version: 1 }],
      version: 1,
    },
  ];

  for (let i = 1; i <= paragraphCount; i++) {
    children.push({
      type: 'paragraph',
      children: [
        { type: 'text', text: `Paragraph ${i}: `, format: 1, mode: 'normal', version: 1 },
        { type: 'text', text: `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Section ${i} contents.`, format: 0, mode: 'normal', version: 1 },
      ],
      version: 1,
    });

    if (i % 50 === 0) {
      children.push({
        type: 'studio-card',
        cardType: 'callout',
        cardData: { text: `Milestone Callout at paragraph ${i}`, emoji: '🚀', backgroundColor: 'blue' },
        version: 1,
      });
    }
  }

  return {
    schema: 'vibress-studio',
    version: 1,
    editor: { lexicalVersion: '0.13.1' },
    root: {
      type: 'root',
      children: children,
      version: 1,
    },
  };
}
