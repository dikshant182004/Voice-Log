import { z } from 'zod';

export const KnowledgeDocumentSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  source_id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type KnowledgeDocument = z.infer<typeof KnowledgeDocumentSchema>;

export interface KnowledgeRetriever {
  search(input: {
    tenantId: string;
    agentId: string;
    query: string;
    limit: number;
    sourceIds?: string[];
  }): Promise<KnowledgeDocument[]>;
}

export function buildKnowledgeContext(documents: KnowledgeDocument[], maxChars = 12000): string {
  return documents
    .map((doc) => '[Source: ' + doc.title + ']\n' + doc.content)
    .join('\n\n')
    .slice(0, maxChars);
}
