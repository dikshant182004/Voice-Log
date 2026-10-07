import { useMemo, useState } from 'react';

type AgentDraft = {
  id: string;
  version: number;
  name: string;
  description: string;
  system_instructions: string;
  persona: string;
  model: { provider: string; model: string; temperature: number; max_output_tokens: number; reasoning_effort: 'none'|'low'|'medium'|'high' };
  voice: { provider: string; voice_id: string; sample_rate: number; language: string } | null;
};

const initial: AgentDraft = {
  id: 'marketing',
  version: 1,
  name: 'Marketing Agent',
  description: 'Domain-specific company marketing assistant',
  system_instructions: 'Help the user with marketing questions. Be accurate and concise.',
  persona: 'Helpful, confident marketing strategist.',
  model: { provider: 'groq', model: 'openai/gpt-oss-20b', temperature: 0.2, max_output_tokens: 256, reasoning_effort: 'low' },
  voice: null,
};

export function AgentBuilderPage() {
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState('');
  const tenantId = import.meta.env.VITE_TENANT_ID || '';
  const token = import.meta.env.VITE_AGENT_BUILDER_TOKEN || '';
  const api = import.meta.env.VITE_API_BASE_URL || '';

  const json = useMemo(() => JSON.stringify(draft, null, 2), [draft]);

  async function save() {
    setMessage('');
    try {
      const response = await fetch(api.replace(/\/+$/, '') + '/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'X-Tenant-ID': tenantId,
        },
        body: json,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Unable to save agent');
      setMessage('Draft saved as version ' + data.version + '.');
    } catch (error: any) {
      setMessage(error?.message || 'Unable to save agent');
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-neutral-500">Agent Platform</p>
        <h1 className="text-3xl font-semibold tracking-tight">Agent Builder</h1>
        <p className="mt-2 text-sm text-neutral-600">Configure an agent once; the runtime can reuse it for voice and text channels.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
          {[
            ['id','Agent ID'], ['name','Name'], ['description','Description'], ['persona','Persona'], ['system_instructions','System instructions'],
          ].map(([key,label]) => (
            <label key={key} className="block text-sm">
              <span className="mb-1 block font-medium">{label}</span>
              {key === 'system_instructions' || key === 'description' || key === 'persona' ? (
                <textarea className="min-h-24 w-full rounded-lg border border-neutral-300 p-3" value={(draft as any)[key]} onChange={e => setDraft({...draft, [key]: e.target.value})} />
              ) : (
                <input className="w-full rounded-lg border border-neutral-300 p-3" value={(draft as any)[key]} onChange={e => setDraft({...draft, [key]: e.target.value})} />
              )}
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Model<input className="mt-1 w-full rounded-lg border p-3" value={draft.model.model} onChange={e=>setDraft({...draft,model:{...draft.model,model:e.target.value}})} /></label>
            <label className="text-sm">Temperature<input type="number" step="0.1" min="0" max="2" className="mt-1 w-full rounded-lg border p-3" value={draft.model.temperature} onChange={e=>setDraft({...draft,model:{...draft.model,temperature:Number(e.target.value)}})} /></label>
          </div>
          <button onClick={save} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">Save draft</button>
          {message && <p className="text-sm text-neutral-600">{message}</p>}
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-5 text-neutral-100">
          <div className="mb-3 text-xs uppercase tracking-widest text-neutral-400">Definition preview</div>
          <pre className="overflow-auto text-xs leading-5">{json}</pre>
        </div>
      </div>
    </section>
  );
}
