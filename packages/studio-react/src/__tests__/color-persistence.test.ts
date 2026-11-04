import { describe, it, expect } from 'vitest';
import {
  createEditor,
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isRangeSelection,
} from 'lexical';
import { $patchStyleText } from '@lexical/selection';
import { serializeStudioDocument } from '@vibress/studio-serializer';
import { migrateDocument } from '@vibress/studio-core';

describe('Text Color & Highlight Persistence (STU-003)', () => {
  it('persists text color and background-color in Lexical EditorState and serialized document', () => {
    const editor = createEditor();

    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        const t = $createTextNode('Highlight me please');
        p.append(t);
        root.append(p);

        // Select the word "Highlight"
        const selection = t.select(0, 9);
        if ($isRangeSelection(selection)) {
          $patchStyleText(selection, {
            color: '#1d4ed8',
            'background-color': '#dbeafe',
          });
        }
      },
      { discrete: true }
    );

    // Read state and verify text nodes
    let serializedJson: Record<string, unknown> | null = null;
    editor.getEditorState().read(() => {
      const stateJson = editor.getEditorState().toJSON();
      serializedJson = stateJson as unknown as Record<string, unknown>;

      const rootObj = stateJson.root as { children?: Array<{ children?: Array<{ text: string; style: string }> }> };
      const p = rootObj.children?.[0];
      const children = p?.children || [];
      expect(children.length).toBe(2);
      expect(children[0]?.text).toBe('Highlight');
      expect(children[0]?.style).toContain('color: #1d4ed8');
      expect(children[0]?.style).toContain('background-color: #dbeafe');
      expect(children[1]?.text).toBe(' me please');
      expect(children[1]?.style).toBe('');
    });

    expect(serializedJson).not.toBeNull();

    // Verify roundtrip through serializeStudioDocument and migrateDocument
    const stateJson = editor.getEditorState().toJSON();
    const studioDoc = serializeStudioDocument(stateJson.root);
    expect(studioDoc.version).toBe(1);

    const migrated = migrateDocument(studioDoc);
    expect(migrated).toBeDefined();

    // Rehydrate into a new editor
    const secondEditor = createEditor();
    secondEditor.setEditorState(
      secondEditor.parseEditorState(JSON.stringify({ root: migrated.root }))
    );

    secondEditor.getEditorState().read(() => {
      const rehydratedJson = secondEditor.getEditorState().toJSON();
      const rootObj = rehydratedJson.root as { children?: Array<{ children?: Array<{ text: string; style: string }> }> };
      const p = rootObj.children?.[0];
      const children = p?.children || [];
      expect(children.length).toBe(2);
      expect(children[0]?.text).toBe('Highlight');
      expect(children[0]?.style).toContain('color: #1d4ed8');
      expect(children[0]?.style).toContain('background-color: #dbeafe');
    });
  });
});
