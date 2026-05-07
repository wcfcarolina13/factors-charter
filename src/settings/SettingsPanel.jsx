import React, { useEffect, useMemo, useState } from 'react';
import { listProviders, callLLM } from '../llm/index.js';
import { readConfig, writeConfig } from './store.js';

const palette = {
  parchment: '#f0e3c4',
  parchmentDeep: '#d9c596',
  wax: '#5c1a08',
  ink: '#2a1a0a',
  faded: '#6b4423',
};

const card = {
  maxWidth: '32rem',
  margin: '2rem auto',
  padding: '1.5rem',
  background: `linear-gradient(180deg, ${palette.parchment}, ${palette.parchmentDeep})`,
  border: `1px solid ${palette.faded}`,
  borderRadius: '4px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  fontFamily: 'EB Garamond, serif',
  color: palette.ink,
  width: '100%',
  boxSizing: 'border-box',
};

const heading = {
  fontFamily: 'IM Fell English SC, serif',
  color: palette.wax,
  fontSize: '1.5rem',
  marginTop: 0,
};

const label = { display: 'block', marginTop: '0.75rem', color: palette.faded, fontSize: '0.9rem' };
const input = {
  width: '100%',
  padding: '0.5rem',
  marginTop: '0.25rem',
  border: `1px solid ${palette.faded}`,
  borderRadius: '3px',
  background: 'rgba(255,255,255,0.4)',
  fontFamily: 'inherit',
  fontSize: '1rem',
  color: palette.ink,
  boxSizing: 'border-box',
};
const button = {
  padding: '0.5rem 1rem',
  border: `1px solid ${palette.wax}`,
  background: palette.wax,
  color: palette.parchment,
  fontFamily: 'IM Fell English SC, serif',
  fontSize: '1rem',
  cursor: 'pointer',
  borderRadius: '3px',
};
const ghost = { ...button, background: 'transparent', color: palette.wax };

export default function SettingsPanel({ onClose }) {
  const providers = useMemo(() => listProviders(), []);
  const stored = readConfig();
  const [providerId, setProviderId] = useState(stored?.providerId || providers[0]?.id || '');
  const [allSettings, setAllSettings] = useState(() => {
    const init = {};
    if (stored?.providerId) init[stored.providerId] = { ...(stored.settings || {}) };
    return init;
  });
  const [showSecrets, setShowSecrets] = useState(false);
  const [testState, setTestState] = useState({ status: 'idle', msg: '' });

  const provider = providers.find(p => p.id === providerId);
  const settings = allSettings[providerId] || {};

  useEffect(() => {
    if (!provider) return;
    setAllSettings(s => {
      const cur = s[providerId] || {};
      const next = { ...cur };
      let changed = !s[providerId];
      for (const f of provider.fields) {
        if (next[f.key] === undefined && f.default !== undefined) {
          next[f.key] = f.default;
          changed = true;
        }
      }
      return changed ? { ...s, [providerId]: next } : s;
    });
  }, [providerId]);

  const updateField = (key, value) =>
    setAllSettings(s => ({ ...s, [providerId]: { ...(s[providerId] || {}), [key]: value } }));

  const onSave = () => {
    writeConfig({ providerId, settings });
    if (onClose) onClose();
  };

  const onTest = async () => {
    setTestState({ status: 'running', msg: 'Testing…' });
    writeConfig({ providerId, settings });
    const result = await callLLM({
      system: 'You reply only with valid JSON.',
      prompt: 'Reply with the JSON {"ok":true}',
      maxTokens: 50,
    });
    if (result.parsed?.ok === true) {
      setTestState({ status: 'ok', msg: 'Connection OK ✓' });
    } else {
      setTestState({ status: 'err', msg: result.error || 'Unexpected response' });
    }
  };

  return (
    <div style={card}>
      <h2 style={heading}>Settings</h2>
      <p style={{ color: palette.faded, fontStyle: 'italic', marginTop: 0 }}>
        Configure how the game speaks to an AI for prose generation.
      </p>

      <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0' }}>
        <legend style={{ color: palette.faded, fontSize: '0.9rem' }}>Active provider</legend>
        {providers.map(p => (
          <label key={p.id} style={{ display: 'block', marginTop: '0.4rem', cursor: 'pointer' }}>
            <input
              type="radio"
              name="provider"
              value={p.id}
              checked={providerId === p.id}
              onChange={() => setProviderId(p.id)}
              style={{ marginRight: '0.5rem' }}
            />
            {p.label}
          </label>
        ))}
      </fieldset>

      {provider?.fields.map(f => (
        <div key={f.key}>
          <label style={label}>{f.label}{f.required ? ' *' : ''}</label>
          <div style={{ position: 'relative' }}>
            <input
              type={f.type === 'password' && !showSecrets ? 'password' : 'text'}
              value={settings[f.key] ?? ''}
              onChange={e => updateField(f.key, e.target.value)}
              style={input}
              placeholder={f.default || ''}
            />
            {f.type === 'password' && (
              <button
                type="button"
                onClick={() => setShowSecrets(s => !s)}
                style={{ ...ghost, position: 'absolute', right: '0.25rem', top: '0.25rem', padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}
              >
                {showSecrets ? 'hide' : 'show'}
              </button>
            )}
          </div>
        </div>
      ))}

      <p style={{ fontSize: '0.8rem', color: palette.faded, fontStyle: 'italic', marginTop: '0.75rem' }}>
        Stored locally on this device only.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        <button style={button} onClick={onSave}>Save</button>
        <button style={ghost} onClick={onTest} disabled={testState.status === 'running'}>
          {testState.status === 'running' ? 'Testing…' : 'Test connection'}
        </button>
        {onClose && <button style={ghost} onClick={onClose}>Close</button>}
      </div>

      {testState.status !== 'idle' && (
        <p style={{
          marginTop: '0.75rem',
          color: testState.status === 'ok' ? '#2d5a2d' : testState.status === 'err' ? palette.wax : palette.faded,
          fontStyle: 'italic',
        }}>
          {testState.msg}
        </p>
      )}
    </div>
  );
}
