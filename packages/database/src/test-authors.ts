import { DrizzleAuthorRepository } from '@vibress/authors/src/infrastructure/drizzle-author-repository';

async function test() {
  const repo = new DrizzleAuthorRepository();
  const authors = await repo.getPageAuthors('a777bcf3-e840-4c4d-ae2c-c1f8c899783b');
  console.log(authors);
}
test().catch(console.error);
