const keyInput = document.getElementById("api-key");
const saveBtn = document.getElementById("save-key");
const clearBtn = document.getElementById("clear-key");
const status = document.getElementById("save-status");

// Pre-fill with a masked placeholder if a key is already stored, so the user
// can tell at a glance whether one is set without re-revealing it.
chrome.storage.local.get("anthropicApiKey").then(({ anthropicApiKey }) => {
  if (anthropicApiKey) {
    keyInput.placeholder = "•••••••••••••••• (key saved)";
  }
});

saveBtn.addEventListener("click", async () => {
  const value = keyInput.value.trim();
  if (!value) {
    status.textContent = "Enter a key first.";
    return;
  }
  if (!value.startsWith("sk-ant-")) {
    status.textContent = "That doesn't look like an Anthropic key (should start with sk-ant-).";
    return;
  }
  await chrome.storage.local.set({ anthropicApiKey: value });
  keyInput.value = "";
  keyInput.placeholder = "•••••••••••••••• (key saved)";
  status.textContent = "Saved.";
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("anthropicApiKey");
  keyInput.value = "";
  keyInput.placeholder = "sk-ant-…";
  status.textContent = "Cleared.";
});
