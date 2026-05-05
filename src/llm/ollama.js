export const ollama = {
  id: 'ollama',
  label: 'Ollama (local, desktop only)',
  fields: [
    { key: 'endpoint', label: 'Endpoint', type: 'text', default: 'http://localhost:11434' },
    { key: 'model', label: 'Model', type: 'text', default: 'llama3.1:8b' },
  ],
  call: async ({ system, prompt, maxTokens, endpoint, model }) => {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        format: 'json',
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body}`);
    }
    const data = await res.json();
    return data?.message?.content || '';
  },
};
