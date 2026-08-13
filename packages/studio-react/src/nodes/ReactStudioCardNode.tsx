// Remove unused React import
import { NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import { StudioCardNode } from '@vibress/studio-cards';
import { StudioCardComponent } from '../components/StudioCardComponent';

export type SerializedReactStudioCardNode = Spread<
  {
    cardType: string;
    cardData: Record<string, unknown>;
  },
  SerializedLexicalNode
>;

export class ReactStudioCardNode extends StudioCardNode {
  static getType(): string {
    return 'react-studio-card';
  }

  static clone(node: ReactStudioCardNode): ReactStudioCardNode {
    return new ReactStudioCardNode(node.__cardType, node.__cardData, node.__key);
  }

  static importJSON(serializedNode: SerializedReactStudioCardNode): ReactStudioCardNode {
    // Imported (possibly canonical 'studio-card') nodes must become the
    // interactive editor node, not the base static node.
    return new ReactStudioCardNode(serializedNode.cardType, serializedNode.cardData);
  }

  constructor(cardType: string, cardData: Record<string, unknown>, key?: NodeKey) {
    super(cardType, cardData, key);
  }

  exportJSON(): SerializedReactStudioCardNode {
    // Lexical 0.13 enforces exportJSON().type === getType(), so the editor's
    // internal node type stays 'react-studio-card'. Canonicalization to the
    // persisted 'studio-card' type happens once, in serializeStudioDocument()
    // (studio-serializer), and on every read via normalizeStudioDocument()
    // (studio-core) — the single normalization layer.
    return {
      type: 'react-studio-card',
      cardType: this.__cardType,
      cardData: this.__cardData,
      version: 1,
    };
  }

  decorate(): JSX.Element {
    return (
      <StudioCardComponent
        cardType={this.__cardType}
        cardData={this.__cardData}
        nodeKey={this.__key}
      />
    );
  }
}

export function $createReactStudioCardNode(
  cardType: string,
  cardData: Record<string, unknown>
): ReactStudioCardNode {
  return new ReactStudioCardNode(cardType, cardData);
}

export function $isReactStudioCardNode(node: unknown): node is ReactStudioCardNode {
  return node instanceof ReactStudioCardNode;
}
