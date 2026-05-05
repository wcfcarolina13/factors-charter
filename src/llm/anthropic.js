export const anthropic = {
  id: 'anthropic',
  label: 'Anthropic API (BYO key)',
  fields: [
    { key: 'apiKey', label: 'API key', type: 'password', required: true },
    { key: 'model', label: 'Model', type: 'text', default: 'claude-sonnet-4-20250514' },
  ],
  call: async ({ system, prompt, maxTokens, apiKey, model }) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Anthropic ${res.status}: ${body}`);
    }
    const data = await res.json();
    return (data?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
  },
};
