/** Live consecutive-request test: session continuity + isolation. */
const BASE = 'http://127.0.0.1:8765/v1/chat/completions';

async function ask(session: string | null, content: string, n: number) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (session) headers['x-hermes-session-id'] = session;
  const started = Date.now();
  const res = await fetch(BASE, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: 'chatgpt-web', messages: [{ role: 'user', content }] }),
  });
  const ms = Date.now() - started;
  const body = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { code?: string; message?: string };
  };
  if (!res.ok || !body.choices?.[0]) {
    console.log(`[${n}] ${session ?? '(default)'} FAIL ${res.status} ${body.error?.code ?? ''} ${(body.error?.message ?? '').slice(0, 80)} (${ms}ms)`);
    return false;
  }
  console.log(`[${n}] ${session ?? '(default)'} OK ${ms}ms :: ${body.choices[0].message.content.slice(0, 90)}`);
  return true;
}

// Session A: 3 consecutive questions (must stay in the same ChatGPT thread)
const a1 = await ask('sess-A', '这是连续测试第一问，只回复"一"', 1);
const a2 = await ask('sess-A', '第二问，只回复"二"', 2);
const a3 = await ask('sess-A', '第三问，只回复"三"', 3);

// Session B: independent (must not contaminate A)
const b1 = await ask('sess-B', '独立会话测试，只回复"B"', 4);

// Default session (no header)
const d1 = await ask(null, '默认会话测试，只回复"D"', 5);

console.log('\nSUMMARY:', { a1, a2, a3, b1, d1 });
