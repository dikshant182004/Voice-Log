import { useEffect, useState } from 'react';

type Connection = { id:string; name:string; type:string; base_url?:string; secret_ref?:string; config:Record<string,unknown>; enabled:boolean };

const types = [
  ['http_json','Customer API / Policy service'],
  ['vector_rest','Vector / semantic search gateway'],
  ['webhook','Observability / event sink'],
  ['d1','Voice-Log managed D1'],
];

export function ConnectionsPage() {
  const api=(import.meta.env.VITE_API_BASE_URL||'').replace(/\/+$/,'');
  const tenantId=import.meta.env.VITE_TENANT_ID||'';
  const token=import.meta.env.VITE_AGENT_BUILDER_TOKEN||'';
  const [items,setItems]=useState<Connection[]>([]);
  const [form,setForm]=useState({id:'customer-data',name:'Customer Data',type:'http_json',base_url:'',secret_ref:'',config:'{}'});
  const [message,setMessage]=useState('');

  async function test(id:string){setMessage('Testing connection…');const r=await fetch(api+'/v1/connections/'+id+'/test',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Tenant-ID':tenantId}});const d=await r.json();setMessage(d.ok?'Connection healthy.':'Connection test failed.')}
  async function load(){ const r=await fetch(api+'/v1/connections',{headers:{Authorization:'Bearer '+token,'X-Tenant-ID':tenantId}}); const d=await r.json(); if(r.ok)setItems(d.items||[]); }
  useEffect(()=>{void load()},[]);

  async function save(){
    setMessage('');
    try{
      const body={...form,secret_ref:form.secret_ref||undefined,base_url:form.base_url||undefined,config:JSON.parse(form.config)};
      const r=await fetch(api+'/v1/connections',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Tenant-ID':tenantId},body:JSON.stringify(body)});
      const d=await r.json(); if(!r.ok)throw new Error(d?.error?.message||'Unable to save connection');
      setMessage('Connection saved.'); await load();
    }catch(e:any){setMessage(e.message||'Invalid configuration');}
  }

  return <section className="space-y-6">
    <div><p className="text-xs uppercase tracking-widest text-neutral-500">Integrations</p><h1 className="text-3xl font-semibold tracking-tight">Connections</h1><p className="mt-2 text-sm text-neutral-600">Attach customer-owned APIs, semantic search gateways and observability sinks without putting secrets into agent definitions.</p></div>
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold">Add connection</h2>
        <label className="block text-sm">ID<input className="mt-1 w-full rounded-lg border p-3" value={form.id} onChange={e=>setForm({...form,id:e.target.value})}/></label>
        <label className="block text-sm">Name<input className="mt-1 w-full rounded-lg border p-3" value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
        <label className="block text-sm">Type<select className="mt-1 w-full rounded-lg border p-3" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>{types.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label className="block text-sm">Base URL<input className="mt-1 w-full rounded-lg border p-3" placeholder="https://customer-api.example.com" value={form.base_url} onChange={e=>setForm({...form,base_url:e.target.value})}/></label>
        <label className="block text-sm">Secret reference<input className="mt-1 w-full rounded-lg border p-3" placeholder="CUSTOMER_API" value={form.secret_ref} onChange={e=>setForm({...form,secret_ref:e.target.value})}/><span className="mt-1 block text-xs text-neutral-500">Only the reference is stored; the credential stays server-side.</span></label>
        <label className="block text-sm">Provider config JSON<textarea className="mt-1 min-h-24 w-full rounded-lg border p-3 font-mono text-xs" value={form.config} onChange={e=>setForm({...form,config:e.target.value})}/></label>
        <button onClick={save} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">Save connection</button>
        {message&&<p className="text-sm text-neutral-600">{message}</p>}
      </div>
      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-5">
        <h2 className="font-semibold">Configured connections</h2>
        {!items.length&&<p className="text-sm text-neutral-500">No connections yet.</p>}
        {items.map(x=><div key={x.id} className="rounded-xl border p-4"><div className="flex justify-between"><strong>{x.name}</strong><span className="text-xs text-neutral-500">{x.type}</span></div><div className="mt-1 text-xs text-neutral-500">{x.id} · {x.base_url||'managed'}</div><button onClick={()=>test(x.id)} className="mt-3 rounded-lg border px-3 py-1.5 text-xs">Test connection</button></div>)}
      </div>
    </div>
  </section>;
}
