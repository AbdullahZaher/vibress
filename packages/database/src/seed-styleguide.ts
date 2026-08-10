import { getDb, pages, users, closeDbPool } from './index';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

export const seedStyleGuide = async () => {
  const db = getDb();
  
  // get admin user
  const adminUsers = await db.select().from(users).where(eq(users.email, 'admin@vibress.local')).limit(1);
  if (!adminUsers.length) {
    console.error('No admin user found. Seed the db first.');
    return;
  }
  const adminId = adminUsers[0]!.id;
  
  // delete existing if any
  await db.delete(pages).where(eq(pages.slug, 'style-guide'));
  
  const content = {
    root: {
      children: [
        {
          type: "heading",
          tag: "h1",
          children: [{ type: "text", version: 1, text: "Vibress Style Guide" }],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1
        },
        {
          type: "paragraph",
          children: [{ type: "text", version: 1, text: "This page contains all the different cards and elements supported by the Vibress Studio editor." }],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1
        },
        
        { type: "heading", tag: "h2", children: [{ type: "text", version: 1, text: "1. Media Cards" }], direction: "ltr", format: "", indent: 0, version: 1 },
        {
          type: "studio-card",
          cardType: "image",
          cardData: {
            src: "https://images.unsplash.com/photo-1707343843437-caacff5cfa74?q=80&w=2940&auto=format&fit=crop",
            alt: "A beautiful scenery",
            caption: "This is an image card caption"
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "gallery",
          cardData: {
            images: [
              { src: "https://images.unsplash.com/photo-1682687982501-1e58b8147144?q=80&w=2940", alt: "Gallery image 1" },
              { src: "https://images.unsplash.com/photo-1682687220199-d0124f48f95b?q=80&w=2940", alt: "Gallery image 2" },
              { src: "https://images.unsplash.com/photo-1682687982502-1529b3b33f69?q=80&w=2940", alt: "Gallery image 3" }
            ]
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "video",
          cardData: {
            src: "http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            caption: "Open Source Video Example"
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "audio",
          cardData: {
            src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            title: "Sample Audio Track"
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "file",
          cardData: {
            src: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
            fileName: "style-guide-resources.pdf",
            fileSize: "1.2 MB"
          },
          version: 1
        },

        { type: "heading", tag: "h2", children: [{ type: "text", version: 1, text: "2. Content Cards" }], direction: "ltr", format: "", indent: 0, version: 1 },
        {
          type: "studio-card",
          cardType: "bookmark",
          cardData: {
            url: "https://vibress.com",
            title: "Vibress - The Publishing Platform",
            description: "Build your audience with Vibress. The modern publishing platform.",
            iconUrl: "https://vibress.com/favicon.ico",
            thumbnailUrl: "https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=2929"
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "callout",
          cardData: {
            text: "This is a very important callout message to highlight key information.",
            emoji: "💡",
            backgroundColor: "blue"
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "toggle",
          cardData: {
            heading: "What is Vibress?",
            content: "Vibress is a modern, open-source publishing platform built for creators, journalists, and businesses."
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "button",
          cardData: {
            text: "Subscribe Now",
            url: "https://vibress.com/subscribe",
            alignment: "center"
          },
          version: 1
        },
        {
          type: "studio-card",
          cardType: "header",
          cardData: {
            heading: "Build your audience",
            subheading: "Start your journey today.",
            size: "large",
            style: "dark"
          },
          version: 1
        },

        { type: "heading", tag: "h2", children: [{ type: "text", version: 1, text: "3. Structure Cards" }], direction: "ltr", format: "", indent: 0, version: 1 },
        {
          type: "studio-card",
          cardType: "divider",
          cardData: {},
          version: 1
        },
        {
          type: "studio-card",
          cardType: "html",
          cardData: {
            html: "<div style='padding: 20px; background: #fee2e2; color: #991b1b; border-radius: 8px;'>Custom HTML Block Example</div>"
          },
          version: 1
        }
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1
    }
  };

  const id = crypto.randomUUID();
  const now = new Date();
  
  await db.insert(pages).values({
    id,
    title: 'Style Guide',
    slug: 'style-guide',
    content,
    primaryAuthorId: adminId,
    createdBy: adminId,
    updatedBy: adminId,
    status: 'published',
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  console.log('Style Guide page created successfully!');
};

if (require.main === module) {
  seedStyleGuide()
    .then(() => closeDbPool())
    .catch(async (err) => {
      console.error(err);
      await closeDbPool();
      process.exit(1);
    });
}
