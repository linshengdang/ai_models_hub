---
name: github-device-flow-auth
description: Provides a standardized, zero-configuration method to authenticate users via GitHub Device Flow. Use this skill when a web tool, CLI, or local service needs GitHub authentication without requiring the user to manually configure OAuth Apps, Client IDs, or Secrets. It provides ready-to-use Node.js backend logic and vanilla JS frontend code for the complete Device Flow lifecycle (start, poll, copy code, fallback clipboard, success redirect).
---

# GitHub Device Flow Authentication

This skill provides a standardized way to implement GitHub authentication in local or lightweight web tools without requiring users to set up OAuth Apps. It leverages the GitHub Device Flow using a well-known Client ID.

## Core Principle
Instead of traditional OAuth redirects (which require configuring callback URLs and client secrets), Device Flow allows the app to request a code, display it to the user, and poll GitHub until the user authorizes the app in their browser.

## Backend Implementation (Node.js/Express)

To implement the backend, you need `axios` and `express-session`. 
Use the GitHub CLI's default Client ID `01ab8ac9400c4e429b23` as it permits CORS and requires no setup.

```javascript
const GITHUB_CLIENT_ID = '01ab8ac9400c4e429b23'; 

// 1. Start Device Flow
app.post('/api/device/start', async (req, res) => {
    try {
        const response = await axios.post('https://github.com/login/device/code', {
            client_id: GITHUB_CLIENT_ID,
            scope: 'user'
        }, { headers: { 'Accept': 'application/json' } });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to start device flow' });
    }
});

// 2. Poll Device Flow Status
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
            req.session.githubToken = data.access_token; // Save token to session
            return res.json({ success: true, token: data.access_token });
        } else {
            return res.json({ error: data.error_description || data.error });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to poll status' });
    }
});
```

## Frontend Implementation (Vanilla JS)

The frontend needs to trigger the flow, display the `user_code` and `verification_uri`, copy the code to the clipboard (handling both secure HTTPS and fallback HTTP contexts), and start polling.

```javascript
async function startDeviceFlow() {
    const statusDiv = document.getElementById("device-flow-status");
    try {
        const res = await fetch("/api/device/start", { method: "POST" });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        // Auto-copy to clipboard with HTTP fallback
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(data.user_code);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = data.user_code;
                textArea.style.position = "fixed";
                textArea.style.opacity = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try { document.execCommand('copy'); } catch (err) {}
                document.body.removeChild(textArea);
            }
        } catch (e) {}

        // Render UI
        statusDiv.style.display = "block";
        statusDiv.innerHTML = \`
            <div style="background: #e1f0ff; padding: 10px; border-radius: 6px; margin-bottom: 10px; color: #0550ae;">
                ✨ Code <b>\${data.user_code}</b> has been copied to your clipboard!
            </div>
            Please visit: <a href="\${data.verification_uri}" target="_blank">\${data.verification_uri}</a> <br>
            And paste the code: <b>\${data.user_code}</b><br>
            <span>Waiting for authorization...</span>
        \`;

        pollDeviceFlow(data.device_code, data.interval);
    } catch (e) {
        statusDiv.innerHTML = \`<span style="color: red;">Error: \${e.message}</span>\`;
    }
}

async function pollDeviceFlow(deviceCode, intervalSeconds) {
    const intervalMs = (intervalSeconds + 1) * 1000;
    const poll = setInterval(async () => {
        try {
            const res = await fetch("/api/device/poll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ device_code: deviceCode })
            });
            const data = await res.json();

            if (data.success) {
                clearInterval(poll);
                document.getElementById("device-flow-status").innerHTML = '✅ Authorization successful!';
                setTimeout(() => window.location.reload(), 1000);
            } else if (data.status === "expired_token" || data.error) {
                clearInterval(poll);
                document.getElementById("device-flow-status").innerHTML = '❌ Code expired or error occurred. Try again.';
            }
        } catch (e) {}
    }, intervalMs);
}
```