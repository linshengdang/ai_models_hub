
      let currentCopilotToken = null;
      let currentApiKey = null;
      let currentProvider = "copilot"; // 'copilot', 'openai', 'kimi', 'minimax'
      let chatHistory = [];

      // 页面加载时检查是否已登录
      document.addEventListener("DOMContentLoaded", async () => {
        try {
          const res = await fetch("/api/me");
          const data = await res.json();

          if (data.loggedIn) {
            document.getElementById("login-panel").style.display = "none";
            document.getElementById("user-info-panel").style.display = "flex";
            document.getElementById("user-avatar").src = data.user.avatar_url;
            document.getElementById("user-name").textContent = data.user.login;

            const statusEl = document.getElementById("auth-status");

            if (data.hasCopilot) {
              currentCopilotToken = data.copilotToken;
              const tokenExpiresAt = new Date(data.expires_at * 1000);

              statusEl.innerHTML = `✅ Copilot verified for @${data.user.login}. Token valid until: ${tokenExpiresAt.toLocaleTimeString()}`;
              statusEl.className = "status success";

              enableChat();
              addMessageToUI(
                "System",
                "Authentication and Copilot verification successful.",
              );
            } else {
              statusEl.innerHTML = `❌ Verification failed: ${data.error}`;
              statusEl.className = "status error";
            }
          }
        } catch (e) {
          console.error("Session check failed", e);
        }
      });

      async function startDeviceFlow() {
        const btn = document.getElementById("device-flow-btn");
        const statusDiv = document.getElementById("device-flow-status");
        btn.disabled = true;

        try {
          const res = await fetch("/api/device/start", { method: "POST" });
          const data = await res.json();

          if (data.error) throw new Error(data.error);

          try {
            // Modern async clipboard API (requires secure context/HTTPS, or localhost)
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(data.user_code);
            } else {
                // Fallback for non-secure contexts (HTTP over IP)
                const textArea = document.createElement("textarea");
                textArea.value = data.user_code;
                textArea.style.position = "fixed";  // Avoid scrolling to bottom
                textArea.style.opacity = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                try {
                    document.execCommand('copy');
                } catch (err) {
                    console.error('Fallback: Oops, unable to copy', err);
                }
                document.body.removeChild(textArea);
            }
          } catch (e) {
            console.warn("clipboard error", e);
          }

          statusDiv.style.display = "block";
          statusDiv.innerHTML = `
                <div style="background: #e1f0ff; padding: 10px; border-radius: 6px; margin-bottom: 10px; color: #0550ae;">
                    ✨ Code <b>${data.user_code}</b> has been copied to your clipboard!
                </div>
                Please visit: <a href="${data.verification_uri}" target="_blank" style="color: #0969da; font-weight: bold;">${data.verification_uri}</a> <br>
                And paste the code: <span style="font-size: 18px; font-weight: bold; background: #e1e4e8; padding: 2px 6px; border-radius: 4px;">${data.user_code}</span><br>
                <span style="font-size: 12px; color: #57606a;">Waiting for authorization...</span>
            `;

          // 开始轮询检查
          pollDeviceFlow(data.device_code, data.interval);
        } catch (e) {
          statusDiv.style.display = "block";
          statusDiv.innerHTML = `<span style="color: #cf222e;">Failed to start: ${e.message}</span>`;
          btn.disabled = false;
        }
      }

      async function pollDeviceFlow(deviceCode, intervalSeconds) {
        const intervalMs = (intervalSeconds + 1) * 1000;

        const poll = setInterval(async () => {
          try {
            const res = await fetch("/api/device/poll", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ device_code: deviceCode }),
            });
            const data = await res.json();

            if (data.success) {
              clearInterval(poll);
              document.getElementById("device-flow-status").innerHTML =
                '<span style="color: #1a7f37;">✅ Authorization successful! Reloading...</span>';
              setTimeout(() => window.location.reload(), 1500);
            } else if (data.status === "authorization_pending") {
              // 继续等
            } else if (data.status === "expired_token") {
              clearInterval(poll);
              document.getElementById("device-flow-status").innerHTML =
                '<span style="color: #cf222e;">❌ Code expired. Please try again.</span>';
              document.getElementById("device-flow-btn").disabled = false;
            } else if (data.error) {
              clearInterval(poll);
              document.getElementById("device-flow-status").innerHTML =
                `<span style="color: #cf222e;">❌ Error: ${data.error}</span>`;
              document.getElementById("device-flow-btn").disabled = false;
            }
          } catch (e) {
            console.error("Poll error", e);
          }
        }, intervalMs);
      }
      // 添加 API Key 验证逻辑
      function verifyApiKey() {
        const key = document.getElementById("api-key").value.trim();
        const modelSelect = document.getElementById("model-select");
        const selectedModel = modelSelect.value;
        const statusEl = document.getElementById("auth-status");

        if (!key) {
          statusEl.textContent = "Please enter an API Key.";
          statusEl.className = "status error";
          return;
        }

        if (selectedModel === "openai") {
            currentProvider = "openai";
            statusEl.innerHTML = `✅ Authenticated with OpenAI API Key`;
        } else if (selectedModel === "kimi") {
            currentProvider = "kimi";
            statusEl.innerHTML = `✅ Authenticated with Kimi API Key`;
        } else if (selectedModel === "minimax") {
            currentProvider = "minimax";
            statusEl.innerHTML = `✅ Authenticated with MiniMax API Key`;
        } else {
             statusEl.textContent = "Please select a matching provider from the dropdown first (OpenAI/Kimi/MiniMax).";
             statusEl.className = "status error";
             return;
        }

        currentApiKey = key;
        statusEl.className = "status success";

        document.getElementById("login-panel").style.display = "none";
        document.getElementById("user-info-panel").style.display = "flex";
        document.getElementById("user-name").textContent = `API Key: ${currentProvider}`;
        document.getElementById("user-avatar").src = "https://ui-avatars.com/api/?name=API+Key&background=0D8ABC&color=fff";

        enableChat();
        addMessageToUI("System", `Successfully switched to ${currentProvider.toUpperCase()} provider.`);
      }

      async function startMiniMaxDeviceFlow() {
        const btn = document.getElementById("minimax-device-btn");
        const statusDiv = document.getElementById("device-flow-status");
        btn.disabled = true;

        try {
          const res = await fetch("/api/minimax/start", { method: "POST" });
          const data = await res.json();

          if (data.error) throw new Error(data.error);

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
                try {
                    document.execCommand('copy');
                } catch (err) {}
                document.body.removeChild(textArea);
            }
          } catch (e) {}

          statusDiv.style.display = "block";
          statusDiv.innerHTML = `
                <div style="background: #e1f0ff; padding: 10px; border-radius: 6px; margin-bottom: 10px; color: #0550ae;">
                    ✨ MiniMax Code <b>${data.user_code}</b> has been copied to your clipboard!
                </div>
                Please visit: <a href="${data.verification_uri}" target="_blank" style="color: #0969da; font-weight: bold;">${data.verification_uri}</a> <br>
                And paste the code: <span style="font-size: 18px; font-weight: bold; background: #e1e4e8; padding: 2px 6px; border-radius: 4px;">${data.user_code}</span><br>
                <span style="font-size: 12px; color: #57606a;">Waiting for MiniMax authorization...</span>
            `;

          pollMiniMaxDeviceFlow(data.user_code, data.interval || 2);
        } catch (e) {
          statusDiv.style.display = "block";
          statusDiv.innerHTML = `<span style="color: #cf222e;">Failed to start MiniMax flow: ${e.message}</span>`;
          btn.disabled = false;
        }
      }

      async function pollMiniMaxDeviceFlow(userCode, intervalSeconds) {
        const intervalMs = intervalSeconds * 1000;

        const poll = setInterval(async () => {
          try {
            const res = await fetch("/api/minimax/poll", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ user_code: userCode }),
            });
            const data = await res.json();

            if (data.success) {
              clearInterval(poll);
              document.getElementById("device-flow-status").innerHTML =
                '<span style="color: #1a7f37;">✅ MiniMax Authorization successful! Switching...</span>';

              // 登录成功后直接切换到 MiniMax
              currentProvider = "minimax";
              currentApiKey = data.token; // 我们复用 apiKey 字段来存任何平台原生的 Token

              document.getElementById("model-select").value = "minimax";
              document.getElementById("login-panel").style.display = "none";
              document.getElementById("user-info-panel").style.display = "flex";
              document.getElementById("user-name").textContent = `MiniMax Account`;
              document.getElementById("user-avatar").src = "https://ui-avatars.com/api/?name=Mini+Max&background=6c5ce7&color=fff";

              enableChat();
              addMessageToUI("System", `Successfully logged into MiniMax! Ready to chat.`);
            } else if (data.status === "authorization_pending") {
              // 继续等
            } else if (data.error) {
              clearInterval(poll);
              document.getElementById(
                "device-flow-status"
              ).innerHTML = `<span style="color: #cf222e;">❌ Error: ${data.error}</span>`;
              document.getElementById("minimax-device-btn").disabled = false;
            }
          } catch (e) {
            console.error("Poll error", e);
          }
        }, intervalMs);
      }
      async function verifyTokenManual() {
        const ghToken = document.getElementById("gh-token").value.trim();
        const statusEl = document.getElementById("auth-status");
        const verifyBtn = document.getElementById("verify-btn");

        if (!ghToken) {
          statusEl.textContent = "Please enter a token first.";
          statusEl.className = "status error";
          return;
        }

        verifyBtn.disabled = true;
        statusEl.textContent = "Verifying manually...";

        try {
          const res = await fetch("/api/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ githubToken: ghToken }),
          });

          const data = await res.json();

          if (res.ok && data.success) {
            // 如果是手动验证成功，刷新页面以拉取用户信息
            window.location.reload();
          } else {
            statusEl.textContent = `❌ Verification failed: ${data.error}`;
            statusEl.className = "status error";
          }
        } catch (error) {
          statusEl.textContent = `❌ Network error: ${error.message}`;
          statusEl.className = "status error";
        } finally {
          verifyBtn.disabled = false;
        }
      }

      async function logout() {
        await fetch("/api/logout", { method: "POST" });
        window.location.reload();
      }

      function enableChat() {
        document.getElementById("chat-input").disabled = false;
        document.getElementById("send-btn").disabled = false;
      }

      async function sendMessage() {
        const inputEl = document.getElementById("chat-input");
        const sendBtn = document.getElementById("send-btn");
        const message = inputEl.value.trim();
        const model = document.getElementById("model-select").value;

        if (!message) return;
        if (currentProvider === "copilot" && !currentCopilotToken) return;
        if (currentProvider !== "copilot" && !currentApiKey) return;

        addMessageToUI("user", message);
        chatHistory.push({ role: "user", content: message });

        inputEl.value = "";
        inputEl.disabled = true;
        sendBtn.disabled = true;

        const messagesDiv = document.getElementById("chat-messages");
        const loadingDiv = document.createElement("div");
        loadingDiv.className = "message ai-message";
        loadingDiv.id = "loading-msg";
        loadingDiv.textContent = "Thinking...";
        messagesDiv.appendChild(loadingDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: currentProvider,
              token: currentProvider === "copilot" ? currentCopilotToken : currentApiKey,
              model: model,
              messages: chatHistory,
            }),
          });

          const data = await res.json();
          document.getElementById("loading-msg").remove();

          if (res.ok && data.choices && data.choices.length > 0) {
            const aiResponse = data.choices[0].message.content;
            chatHistory.push({ role: "assistant", content: aiResponse });

            const formattedResponse = aiResponse
              .replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>")
              .replace(/`([^`]+)`/g, "<code>$1</code>")
              .replace(/\n/g, "<br>");

            addMessageToUI("ai", formattedResponse, true);
          } else {
            addMessageToUI("ai", `❌ Error: ${data.error || "Unknown error"}`);
          }
        } catch (error) {
          document.getElementById("loading-msg").remove();
          addMessageToUI("ai", `❌ Request failed: ${error.message}`);
        } finally {
          inputEl.disabled = false;
          sendBtn.disabled = false;
          inputEl.focus();
        }
      }

      function addMessageToUI(sender, text, isHtml = false) {
        const messagesDiv = document.getElementById("chat-messages");
        const msgDiv = document.createElement("div");
        msgDiv.className = `message ${sender === "user" ? "user-message" : "ai-message"}`;

        if (isHtml) {
          msgDiv.innerHTML = text;
        } else {
          msgDiv.textContent = text;
        }

        messagesDiv.appendChild(msgDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }

      document
        .getElementById("chat-input")
        .addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        });
    