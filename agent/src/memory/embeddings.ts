/**
 * Local embedding generation using @xenova/transformers.
 * Runs all-MiniLM-L6-v2 locally (~23MB model, 384-dim vectors).
 * Zero cloud cost, ~50ms per embedding after initial model load.
 */

// Lazily imported inside getEmbedder() so the agent starts even if the package
// is absent in production (e.g. not installed on the end-user's machine).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let embedder: any | null = null;

async function getEmbedder() {
  if (!embedder) {
    // Dynamic import — avoids a top-level static import that would prevent the
    // agent from starting when @xenova/transformers is not available.
    // @ts-ignore — @xenova/transformers has no bundled types
    const { pipeline } = await import("@xenova/transformers");
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
 * Pre-warm the embedding model so the first chat message doesn't pay the
 * 2-5 second model load cost. Call fire-and-forget at agent startup.
 */
export async function preWarmEmbedder(): Promise<void> {
  try {
    await getEmbedder();
  } catch (err) {
    console.error("[embeddings] pre-warm failed (non-fatal):", err);
  }
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
