const KEY = 'factor_charter_llm_config_v1';

export function readConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeConfig(cfg) {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}

export function clearConfig() {
  localStorage.removeItem(KEY);
}
