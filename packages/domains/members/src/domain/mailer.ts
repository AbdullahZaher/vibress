export interface MemberMagicLinkEmail {
  to: string;
  magicLinkUrl: string;
  expiresInMinutes: number;
}

export interface MemberEmailChangeVerificationEmail {
  to: string;
  verifyUrl: string;
  expiresInMinutes: number;
}

export interface MemberEmailChangeNoticeEmail {
  to: string;
  newEmail: string;
}

export interface MemberAuthMailer {
  sendMagicLink(input: MemberMagicLinkEmail): Promise<void>;
  sendEmailChangeVerification?(input: MemberEmailChangeVerificationEmail): Promise<void>;
  sendEmailChangeNotice?(input: MemberEmailChangeNoticeEmail): Promise<void>;
}
