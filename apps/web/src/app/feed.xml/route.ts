import { generateRssFeed } from "../../lib/rss";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET() {
  return generateRssFeed();
}
