/**
 * Local embedding generation using @xenova/transformers.
 * Runs all-MiniLM-L6-v2 locally (~23MB model, 384-dim vectors).
 * Zero cloud cost, ~50ms per embedding after initial model load.
 */

// @ts-expect-error — @xenova/transformers has no bundled types
import { pipeline } from "@xenova/transformers";

let embedder: ReturnType<typeof pipeline> | null = null;

async function getEmbedder() {
  if (!embedder) {
    console.error("[embeddings] loading all-MiniLM-L6-v2 model...");
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    console.error("[embeddings] model loaded");
  }
  return embedder;
}

/** Generate a 384-dimensional embedding for the given text */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Cosine similarity between two normalized vectors.
 * Since vectors are L2-normalized, dot product = cosine similarity.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
