const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
const session = require('express-session');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 9999;

// ===== GitHub Device Flow 配置 =====
// 使用官方默认允许 CORS 的 Client ID
const GITHUB_CLIENT_ID = '01ab8ac9400c4e429b23'; 

// ===== MiniMax Device Flow 配置 =====
const MINIMAX_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113';
const MINIMAX_OAUTH_URL = 'https://api.minimaxi.com/oauth/code';
const MINIMAX_TOKEN_URL = 'https://api.minimaxi.com/oauth/token';

// ===== OpenAI Codex OAuth 配置 =====
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const OPENAI_REDIRECT_URI = 'http://localhost:1455/auth/callback';
const OPENAI_SCOPE = 'openid profile email offline_access';

app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: 'copilot-verifier-secret-key-123',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // 本地没有https设为false
}));

// 1. 发起 GitHub Device Flow 登录
app.post('/api/device/start', async (req, res) => {
    try {
        const response = await axios.post('https://github.com/login/device/code', {
            client_id: GITHUB_CLIENT_ID,
            scope: 'user'
        }, { headers: { 'Accept': 'application/json' } });

        res.json(response.data);
    } catch (error) {
        console.error('Device Flow Start Error:', error);
        res.status(500).json({ error: 'Failed to start device flow' });
    }
});

// 2. 轮询 GitHub Device Flow 状态
app.post('/api/device/poll', async (req, res) => {
    const { device_code } = req.body;
    if (!device_code) return res.status(400).json({ error: 'device_code is required' });

    try {
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            device_code: device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        }, { headers: { 'Accept': 'application/json' } });

        const data = response.data;
        
        if (data.error === 'authorization_pending') {
            return res.json({ status: 'authorization_pending' });
        } else if (data.error === 'expired_token') {
            return res.json({ status: 'expired_token' });
        } else if (data.access_token) {
            // 登录成功，保存 Token 到 Session
            req.session.githubToken = data.access_token;
            return res.json({ success: true, token: data.access_token });
        } else {
            return res.json({ error: data.error_description || data.error });
        }
    } catch (error) {
        console.error('Device Flow Poll Error:', error);
        res.status(500).json({ error: 'Failed to poll device flow status' });
    }
});

// ===== MiniMax Device Flow =====
app.post('/api/minimax/start', async (req, res) => {
    try {
        const state = require('crypto').randomBytes(16).toString('base64url');
        const verifier = require('crypto').randomBytes(32).toString('base64url');
        const challenge = require('crypto').createHash('sha256').update(verifier).digest('base64url');
        
        // 存下 verifier 供 poll 阶段使用
        req.session.minimaxVerifier = verifier;

        const formData = new URLSearchParams();
        formData.append('response_type', 'code');
        formData.append('client_id', MINIMAX_CLIENT_ID);
        formData.append('scope', 'group_id profile model.completion');
        formData.append('code_challenge', challenge);
        formData.append('code_challenge_method', 'S256');
        formData.append('state', state);

        const response = await fetch(MINIMAX_OAUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: formData.toString()
        });

        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        
        res.json({
            user_code: data.user_code,
            verification_uri: data.verification_uri,
            interval: data.interval,
            expired_in: data.expired_in
        });
    } catch (error) {
        console.error('MiniMax Start Error:', error);
        res.status(500).json({ error: 'Failed to start MiniMax device flow' });
    }
});

app.post('/api/minimax/poll', async (req, res) => {
    const { user_code } = req.body;
    const verifier = req.session.minimaxVerifier;
    
    if (!user_code || !verifier) return res.status(400).json({ error: 'user_code or verifier missing' });

    try {
        const formData = new URLSearchParams();
        formData.append('grant_type', 'urn:ietf:params:oauth:grant-type:user_code');
        formData.append('client_id', MINIMAX_CLIENT_ID);
        formData.append('user_code', user_code);
        formData.append('code_verifier', verifier);

        const response = await fetch(MINIMAX_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: formData.toString()
        });

        const data = await response.json();
        
        if (data.error === 'authorization_pending') {
            return res.json({ status: 'authorization_pending' });
        } else if (data.access_token) {
            req.session.minimaxToken = data.access_token;
            return res.json({ success: true, token: data.access_token });
        } else {
            return res.json({ error: data.error_description || data.error || 'Unknown error' });
        }
    } catch (error) {
        console.error('MiniMax Poll Error:', error);
        res.status(500).json({ error: 'Failed to poll MiniMax status' });
    }
});

// ===== OpenAI Codex OAuth (Proxy flow simulating local CLI) =====
// 生成 PKCE challenge 和 verifier
function generatePKCE() {
    const crypto = require('crypto');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
}

app.post('/api/openai/start', (req, res) => {
    try {
        const { verifier, challenge } = generatePKCE();
        const state = require('crypto').randomBytes(16).toString('hex');
        
        // 存到 session 里，供下一步兑换 token 时使用
        req.session.openaiVerifier = verifier;
        req.session.openaiState = state;

        const url = new URL(OPENAI_AUTHORIZE_URL);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", OPENAI_CLIENT_ID);
        url.searchParams.set("redirect_uri", OPENAI_REDIRECT_URI);
        url.searchParams.set("scope", OPENAI_SCOPE);
        url.searchParams.set("code_challenge", challenge);
        url.searchParams.set("code_challenge_method", "S256");
        url.searchParams.set("state", state);
        url.searchParams.set("id_token_add_organizations", "true");
        url.searchParams.set("codex_cli_simplified_flow", "true");
        url.searchParams.set("originator", "pi");

        res.json({
            url: url.toString(),
            instructions: "1. 复制这串 URL 到浏览器中打开 (注意你的浏览器必须允许访问 openai.com)\n2. 登录或授权成功后，页面会变成无法访问(127.0.0.1:1455)，这是正常的！\n3. 请把此时浏览器地址栏里包含 '?code=xxx' 的**完整网址**复制回来，填入下方框中点击确认。"
        });
    } catch (error) {
        console.error('OpenAI Start Error:', error);
        res.status(500).json({ error: 'Failed to generate OpenAI OAuth URL' });
    }
});

app.post('/api/openai/exchange', async (req, res) => {
    const { callbackUrl } = req.body;
    const verifier = req.session.openaiVerifier;
    const state = req.session.openaiState;

    if (!callbackUrl || !verifier || !state) {
        return res.status(400).json({ error: 'Missing callback URL or session expired' });
    }

    try {
        // 从传回的 url 里解析出 code 和 state
        let code = '';
        let receivedState = '';
        try {
            const urlObj = new URL(callbackUrl);
            code = urlObj.searchParams.get('code') || '';
            receivedState = urlObj.searchParams.get('state') || '';
        } catch(e) {
            // 如果用户只贴了 code
            const searchParams = new URLSearchParams(callbackUrl.split('?')[1] || callbackUrl);
            code = searchParams.get('code') || callbackUrl;
        }

        if (!code) {
            return res.status(400).json({ error: 'Could not extract code from input.' });
        }

        // 用 code 换取 accessToken
        const formData = new URLSearchParams();
        formData.append('grant_type', 'authorization_code');
        formData.append('client_id', OPENAI_CLIENT_ID);
        formData.append('code', code);
        formData.append('code_verifier', verifier);
        formData.append('redirect_uri', OPENAI_REDIRECT_URI);

        const response = await fetch(OPENAI_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formData.toString()
        });

        if (!response.ok) {
            const text = await response.text();
            return res.status(400).json({ error: `Token exchange failed: ${text}` });
        }

        const data = await response.json();
        req.session.openaiToken = data.access_token;
        res.json({ success: true, token: data.access_token });
    } catch (error) {
        console.error('OpenAI Exchange Error:', error);
        res.status(500).json({ error: 'Failed to exchange OpenAI token' });
    }
});

// 3. 检查当前 Session 中的登录状态并获取 Copilot Token
app.get('/api/me', async (req, res) => {
    const githubToken = req.session.githubToken;
    
    if (!githubToken) {
        return res.json({ loggedIn: false });
    }

    try {
        // 先获取用户基本信息
        const userRes = await axios.get('https://api.github.com/user', {
            headers: { 'Authorization': `token ${githubToken}` }
        });
        const username = userRes.data.login;
        const avatarUrl = userRes.data.avatar_url;

        // 然后尝试换取 Copilot Token
        const copilotRes = await fetch('https://api.github.com/copilot_internal/v2/token', {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.12.2'
            }
        });

        if (copilotRes.status === 401 || copilotRes.status === 403 || copilotRes.status === 404) {
             return res.json({ 
                 loggedIn: true, 
                 user: { login: username, avatar_url: avatarUrl },
                 hasCopilot: false,
                 error: 'No active Copilot subscription found for this account.' 
             });
        }

        if (!copilotRes.ok) {
             return res.json({ 
                 loggedIn: true, 
                 user: { login: username, avatar_url: avatarUrl },
                 hasCopilot: false,
                 error: `GitHub API error: ${copilotRes.statusText}` 
             });
        }

        const copilotData = await copilotRes.json();
        
        res.json({
            loggedIn: true,
            user: { login: username, avatar_url: avatarUrl },
            hasCopilot: true,
            copilotToken: copilotData.token,
            expires_at: copilotData.expires_at,
            githubToken: githubToken // 发给前端，用于调试或手动查验
        });

    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ error: 'Internal server error during verification' });
    }
});

// 支持之前的手动输入 Token 验证（保留旧逻辑）
app.post('/api/verify', async (req, res) => {
    const { githubToken } = req.body;
    if (!githubToken) return res.status(400).json({ error: 'GitHub Token is required' });

    try {
        const response = await fetch('https://api.github.com/copilot_internal/v2/token', {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.12.2'
            }
        });

        if (response.status === 401 || response.status === 403 || response.status === 404) {
            return res.status(401).json({ error: 'Invalid token or no active Copilot subscription found.' });
        }

        if (!response.ok) {
            return res.status(response.status).json({ error: `GitHub API error: ${response.statusText}` });
        }

        const data = await response.json();
        req.session.githubToken = githubToken; // 手动验证成功也存一下
        res.json({ success: true, token: data.token, expires_at: data.expires_at });
    } catch (error) {
        console.error('Verify error:', error);
        res.status(500).json({ error: 'Internal server error during verification' });
    }
});

// 4. 退出登录
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// 5. 代理聊天请求的端点 (支持多模型路由)
app.post('/api/chat', async (req, res) => {
    const { provider, token, messages, model } = req.body;

    if (!token || !messages || !provider) {
        return res.status(400).json({ error: 'Token, provider, and messages are required' });
    }

    try {
        let apiUrl = '';
        let headers = {};
        let body = {};

        // 统一 OpenAI 兼容的对话接口，但路由不同的端点
        if (provider === 'copilot') {
            apiUrl = 'https://api.githubcopilot.com/chat/completions';
            headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'GitHubCopilotChat/0.12.2',
                'Accept': 'application/json',
                'Editor-Version': 'vscode/1.85.0',
                'Editor-Plugin-Version': 'copilot-chat/0.12.2'
            };
            body = { model: model || 'gpt-4o', messages: messages, stream: false };

        } else if (provider === 'openai') {
            apiUrl = 'https://api.openai.com/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
            body = { model: 'gpt-4o', messages: messages, stream: false };

        } else if (provider === 'codex') {
            // Use the real ChatGPT backend-api Codex endpoint (as discovered in OpenClaw source)
            apiUrl = 'https://chatgpt.com/backend-api/codex/responses';
            headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'application/json'
            };
            
            // Format request exactly for Codex API spec
            let requestModel = model || 'gpt-4o';
            if (requestModel.includes('claude') || requestModel.includes('gemini')) {
                requestModel = 'gpt-4o';
            }
            
            // Codex API requires specific body shape, distinct from v1/chat/completions
            // mapping 'messages' -> 'input' and system -> 'instructions'
            let codexMessages = [];
            let systemInstructions = "";
            
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];
                if (msg.role === 'system') {
                    systemInstructions += msg.content + "\n";
                } else if (msg.role === 'user') {
                    codexMessages.push({
                        role: "user",
                        content: [{ type: "input_text", text: msg.content }]
                    });
                } else if (msg.role === 'assistant') {
                    // Assistant messages in Codex API are pushed directly into the top-level array, not wrapped in an object with role: "assistant"
                    codexMessages.push({
                        type: "message", 
                        role: "assistant",
                        status: "completed",
                        id: `msg_${i}`,
                        content: [{ type: "output_text", text: msg.content, annotations: [] }] 
                    });
                }
            }

            body = { 
                model: requestModel, 
                input: codexMessages,
                instructions: systemInstructions.trim() || undefined,
                stream: true,
                store: false,
                text: { verbosity: "medium" }
            };

        } else if (provider === 'kimi') {
            apiUrl = 'https://api.moonshot.cn/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
            body = { model: 'moonshot-v1-8k', messages: messages, stream: false };

        } else if (provider === 'minimax') {
            apiUrl = 'https://api.minimax.chat/v1/text/chatcompletion_v2';
            headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
            body = { model: 'abab6.5-chat', messages: messages, stream: false };

        } else if (provider === 'qwen') {
            apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
            headers = {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            };
            body = { model: 'qwen-max', messages: messages, stream: false };

        } else {
            return res.status(400).json({ error: 'Unsupported provider' });
        }

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({ error: `${provider.toUpperCase()} API error: ${response.statusText}`, details: errorText });
        }

        // Handle specific output format for Codex reverse API since it differs from standard v1/chat/completions
        if (provider === 'codex') {
            const dataText = await response.text();
            // Codex might stream SSE even if stream: false (often true for backend-api), 
            // but we'll try to extract text from the events
            let assistantMessage = "Failed to parse codex response";
            try {
                // If it's single JSON
                const data = JSON.parse(dataText);
                res.json({ choices: [{ message: { content: JSON.stringify(data) } }] });
            } catch(e) {
                // Parse SSE lines
                let lastResponseText = "";
                const lines = dataText.split('\n');
                for (let line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr && jsonStr !== '[DONE]') {
                            try {
                                const parsed = JSON.parse(jsonStr);
                                if (parsed.type === "response.output_text.delta") {
                                    lastResponseText += parsed.delta;
                                }
                            } catch(err) {}
                        }
                    }
                }
                if (lastResponseText) {
                    res.json({ choices: [{ message: { content: lastResponseText } }] });
                } else {
                    res.json({ choices: [{ message: { content: dataText.substring(0, 500) } }] });
                }
            }
            return;
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Internal server error during chat request' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Copilot Verifier is running on http://0.0.0.0:${PORT}`);
});