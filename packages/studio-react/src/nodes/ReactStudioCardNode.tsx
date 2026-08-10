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

  constructor(cardType: string, cardData: Record<string, unknown>, key?: NodeKey) {
    super(cardType, cardData, key);
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
