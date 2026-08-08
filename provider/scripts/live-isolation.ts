const BASE = 'http://127.0.0.1:8765/v1/chat/completions';
async function ask(session: string, content: string, n: number) {
  const started = Date.now();
  const res = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hermes-session-id': session }, body: JSON.stringify({ model: 'chatgpt-web', messages: [{ role: 'user', content }] }) });
  const ms = Date.now() - started;
  const body = await res.json() as { choices?: Array<{ message: { content: string } }>; error?: { code?: string } };
  if (!res.ok || !body.choices?.[0]) { console.log(`[${n}] ${session} FAIL ${res.status} ${body.error?.code ?? ''} (${ms}ms)`); return false; }
  console.log(`[${n}] ${session} OK ${ms}ms :: ${body.choices[0].message.content.slice(0, 60)}`);
  return true;
}
// Three brand-new sessions must each get their OWN thread.
const x1 = await ask('iso-X', '隔离测试X，只回复"X"', 1);
const y1 = await ask('iso-Y', '隔离测试Y，只回复"Y"', 2);
const z1 = await ask('iso-Z', '隔离测试Z，只回复"Z"', 3);
console.log('SUMMARY:', { x1, y1, z1 });
