import { getDb, page_authors } from './index';
import { eq } from 'drizzle-orm';

async function test() {
  const db = getDb();
  const authors = await db.select().from(page_authors).where(eq(page_authors.pageId, 'a777bcf3-e840-4c4d-ae2c-c1f8c899783b'));
  console.log(authors);
}

test().then(() => process.exit(0)).catch(console.error);
