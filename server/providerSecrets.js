const PROVIDER_ENV_KEYS = {
  openai: 'OPENAI_API_KEY',
  antigravity: 'ANTIGRAVITY_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  kimi_coding: 'MOONSHOT_CODING_PLAN_KEY',
  qwen: 'DASHSCOPE_API_KEY',
  zhipu: 'ZHIPU_API_KEY',
  doubao: 'DOUBAO_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  siliconflow: 'SILICONFLOW_API_KEY',
  stepfun: 'STEPFUN_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  cohere: 'COHERE_API_KEY',
  groq: 'GROQ_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  hunyuan: 'TENCENT_HUNYUAN_API_KEY',
};

export function getProviderEnvVar(providerId) {
  return PROVIDER_ENV_KEYS[providerId] || null;
}

export function resolveProviderApiKey(provider) {
  if (!provider) return '';
  if (provider.apiKey) return provider.apiKey;

  const envVar = getProviderEnvVar(provider.id);
  return envVar ? process.env[envVar] || '' : '';
}

export function getMaskedResolvedApiKey(provider) {
  const apiKey = resolveProviderApiKey(provider);
  return apiKey ? `****${apiKey.slice(-4)}` : '';
}
