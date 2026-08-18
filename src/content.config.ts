import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    author: z.string().default("毛宝龙"),
    readingTime: z.string().default("6 min"),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false)
  })
});

export const collections = { blog };
