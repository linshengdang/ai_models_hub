# demoui4ai

## Run

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

## Provider API keys

The server loads `.env` and `.env.local` automatically at startup. You can either:

- configure keys in the UI under Settings
- or put provider keys in `.env.local`

Example:

```bash
MOONSHOT_API_KEY=your_kimi_key
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_API_KEY=your_gemini_key
DEEPSEEK_API_KEY=your_deepseek_key
DASHSCOPE_API_KEY=your_qwen_key
```

Current local config already includes the `moonshot` provider template. Once `MOONSHOT_API_KEY` is set, the app can chat without saving the key in the browser UI.
