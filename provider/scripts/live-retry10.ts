/** Retry round 10 after the timeout: must RESUME, not resubmit. */
const BASE = 'http://127.0.0.1:8765/v1/chat/completions';
const SESSION = 'stress-20';

// Full history through round 10 (same as the failed request).
const messages = [];
for (let round = 1; round <= 10; round++) {
  messages.push({ role: 'user', content: `这是第${round}轮压力测试。只回复数字 ${round}。` });
  if (round < 10) messages.push({ role: 'assistant', content: String(round) });
}

const started = Date.now();
const res = await fetch(BASE, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hermes-session-id': SESSION },
  body: JSON.stringify({ model: 'chatgpt-web', messages }),
});
const ms = Date.now() - started;
const body = (await res.json()) as {
  choices?: Array<{ message: { content: string } }>;
  error?: { code?: string; message?: string };
};
if (!res.ok || !body.choices?.[0]) {
  console.log(`RETRY FAIL ${res.status} ${body.error?.code ?? ''} ${(body.error?.message ?? '').slice(0, 100)} (${ms}ms)`);
  process.exit(1);
}
console.log(`RETRY OK ${ms}ms :: ${body.choices[0].message.content.slice(0, 60)}`);
