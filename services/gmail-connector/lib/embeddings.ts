// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/embeddings.ts
// (commit 55eedf7) — no DB or auth dependency beyond Google's own
// GoogleAuth (already used elsewhere in this project), no adaptation needed.
import { GoogleAuth } from "google-auth-library";

const EMBEDDING_MODEL = "text-embedding-004";
export const EMBEDDING_DIMENSIONS = 768;

let cachedAuth: GoogleAuth | null = null;

function getAuth(): GoogleAuth {
  if (!cachedAuth) {
    cachedAuth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return cachedAuth;
}

function getEndpoint(): { project: string; location: string; url: string } {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_LOCATION;

  if (!project || !location) {
    throw new Error(
      "GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION environment variables must be set",
    );
  }

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${EMBEDDING_MODEL}:predict`;
  return { project, location, url };
}

interface VertexEmbeddingPrediction {
  embeddings: { values: number[] };
}

interface VertexEmbeddingResponse {
  predictions: VertexEmbeddingPrediction[];
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { url } = getEndpoint();
  const auth = getAuth();
  const client = await auth.getClient();
  const accessTokenResponse = await client.getAccessToken();
  const accessToken = accessTokenResponse.token;

  if (!accessToken) {
    throw new Error("Failed to obtain a Google Cloud access token");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: texts.map((content) => ({ content })),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Vertex AI embedding request failed (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as VertexEmbeddingResponse;
  return data.predictions.map((p) => p.embeddings.values);
}

export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  if (vectors.length === 1) return vectors[0];

  const dimensions = vectors[0].length;
  const sums = new Array(dimensions).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimensions; i++) {
      sums[i] += vector[i];
    }
  }

  return sums.map((sum) => sum / vectors.length);
}

export function toPgVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
