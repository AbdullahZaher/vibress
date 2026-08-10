export interface Author {
  id: string; // user_id
  email: string;
  name: string;
  slug: string;
  bio: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ContentAuthor {
  userId: string;
  isPrimary: boolean;
  sortOrder: number;
}
