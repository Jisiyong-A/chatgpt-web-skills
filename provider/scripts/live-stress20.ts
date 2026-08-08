/**
 * Phase 1 acceptance: 20 consecutive prompts, no duplicate submission.
 * Each round sends the FULL history (Hermes-style) so the adapter stays in
 * delta mode on one thread. Failures print immediately; success prints all.
 */
const BASE = 'http://127.0.0.1:8765/v1/chat/completions';
const SESSION = 'stress-20';
const ROUNDS = 20;

const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
let failed = 0;

for (let round = 1; round <= ROUNDS; round++) {
  const q = `这是第${round}轮压力测试。只回复数字 ${round}。`;
  const messages = [...history, { role: 'user' as const, content: q }];
  const started = Date.now();
  try {
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
      failed++;
      console.log(`[${round}/${ROUNDS}] FAIL ${res.status} ${body.error?.code ?? ''} ${(body.error?.message ?? '').slice(0, 70)} (${ms}ms)`);
      break;
    }
    const answer = body.choices[0].message.content;
    history.push({ role: 'user', content: q });
    history.push({ role: 'assistant', content: answer });
    const ok = answer.trim() === String(round);
    if (!ok) {
      failed++;
      console.log(`[${round}/${ROUNDS}] WRONG ANSWER: expected "${round}" got "${answer.slice(0, 60)}"`);
      break;
    }
    console.log(`[${round}/${ROUNDS}] OK ${ms}ms :: ${answer.slice(0, 40)}`);
  } catch (err) {
    failed++;
    console.log(`[${round}/${ROUNDS}] NETWORK ERROR: ${String(err).slice(0, 100)}`);
    break;
  }
}

console.log(`\nRESULT: ${ROUNDS - failed}/${ROUNDS} succeeded, failures=${failed}`);
process.exit(failed > 0 ? 1 : 0);
