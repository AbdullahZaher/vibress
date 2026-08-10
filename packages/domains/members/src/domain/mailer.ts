export interface MemberMagicLinkEmail {
  to: string;
  magicLinkUrl: string;
  expiresInMinutes: number;
}

export interface MemberAuthMailer {
  sendMagicLink(input: MemberMagicLinkEmail): Promise<void>;
}
