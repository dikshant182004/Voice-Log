import { useState } from 'react';

export function AgentPlaygroundPage() {
  const [agentId, setAgentId] = useState('marketing');
  const [message, setMessage] = useState('Give me three campaign ideas for a B2B SaaS launch.');
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const api = import.meta.env.VITE_API_BASE_URL || '';
  const tenantId = import.meta.env.VITE_TENANT_ID || '';
  const token = import.meta.env.VITE_AGENT_BUILDER_TOKEN || '';

  async function run() {
    setBusy(true);
    setResponse('');
    try {
      const res = await fetch(api.replace(/\/+$/, '') + '/v1/runtime/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'X-Tenant-ID': tenantId,
        },
        body: JSON.stringify({ agent_id: agentId, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || 'Runtime request failed');
      setResponse(data.response || '');
    } catch (error: any) {
      setResponse('Error: ' + (error?.message || 'Runtime request failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest text-neutral-500">Runtime</p>
        <h1 className="text-3xl font-semibold tracking-tight">Agent Playground</h1>
        <p className="mt-2 text-sm text-neutral-600">Exercise the published agent harness with its policy, memory, knowledge and MCP configuration.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
          <label className="block text-sm"><span className="mb-1 block font-medium">Agent ID</span><input className="w-full rounded-lg border p-3" value={agentId} onChange={e=>setAgentId(e.target.value)} /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium">Message</span><textarea className="min-h-40 w-full rounded-lg border p-3" value={message} onChange={e=>setMessage(e.target.value)} /></label>
          <button disabled={busy} onClick={run} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Running…' : 'Run agent'}</button>
        </div>
        <div className="min-h-64 rounded-2xl border border-neutral-200 bg-neutral-950 p-5 text-sm leading-6 text-neutral-100 whitespace-pre-wrap">
          {response || 'Agent output will appear here.'}
        </div>
      </div>
    </section>
  );
}
