const { ipcRenderer } = require("electron");
const fs = require("fs").promises; // Use Promises to prevent UI freezing
const path = require("path");

// --- State Management ---
let selectedFolders = [];
let activeSmartExcludes = new Set();

const COMMON_NOISE = [
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "thumbs.db",
  ".env",
  ".env.local",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".cache",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bower_components",
  "venv",
  ".venv",
  "env",
  "__pycache__",
  "bin",
  "obj",
  ".vs",
  ".vscode",
  "target",
  ".gradle",
  "logs",
  "temp",
  "tmp",
];

// --- UI Helpers ---

function setLoading(show, text = "Processing...") {
  const overlay = document.getElementById("loadingOverlay");
  const textEl = document.getElementById("loadingText");
  if (overlay) {
    overlay.style.display = show ? "flex" : "none";
    textEl.innerText = text;
  }
}

async function updateFolderUI() {
  const list = document.getElementById("folderList");
  list.innerHTML = "";
  selectedFolders.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "folder-item";
    li.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" ${item.enabled ? "checked" : ""} onchange="toggleFolder(${index})">
                <span style="word-break: break-all;">${item.path}</span>
            </div>
            <button class="remove-btn" onclick="removeFolder(${index})">Delete</button>
        `;
    list.appendChild(li);
  });
  await detectNoise();
}

// --- Non-Blocking Noise Detection ---

async function detectNoise() {
  const foundInFolders = new Set();

  // Scan enabled folders
  for (const folderObj of selectedFolders.filter((f) => f.enabled)) {
    await scanForNoise(folderObj.path, foundInFolders, 0, 3);
  }

  const container = document.getElementById("smartExcludes");
  if (!container) return;

  const previouslyChecked = new Set(activeSmartExcludes);
  container.innerHTML =
    foundInFolders.size > 0
      ? "<div style='width:100%; font-size:12px; margin-bottom:5px;'><strong>Auto-Exclude detected:</strong></div>"
      : "";

  foundInFolders.forEach((noise) => {
    if (!activeSmartExcludes.has(noise) && !previouslyChecked.has(noise)) {
      activeSmartExcludes.add(noise);
    }

    const isChecked = activeSmartExcludes.has(noise);
    const label = document.createElement("label");
    label.style =
      "background: #e0e0e0; padding: 4px 10px; border-radius: 15px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 5px; border: 1px solid #ccc; margin-bottom: 5px;";
    label.innerHTML = `
            <input type="checkbox" ${isChecked ? "checked" : ""} onchange="toggleSmartExclude('${noise}', this.checked)">
            ${noise}
        `;
    container.appendChild(label);
  });
}

async function scanForNoise(dir, foundSet, depth, maxDepth) {
  if (depth > maxDepth) return;
  try {
    const items = await fs.readdir(dir);
    for (const item of items) {
      if (COMMON_NOISE.includes(item)) {
        foundSet.add(item);
      }
      const fullPath = path.join(dir, item);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && !COMMON_NOISE.includes(item)) {
          await scanForNoise(fullPath, foundSet, depth + 1, maxDepth);
        }
      } catch (e) {
        /* skip individual file errors */
      }
    }
  } catch (e) {
    /* skip directory access errors */
  }
}

// --- Folder Management ---

window.toggleSmartExclude = (name, isChecked) => {
  if (isChecked) activeSmartExcludes.add(name);
  else activeSmartExcludes.delete(name);
};

window.toggleFolder = async (index) => {
  selectedFolders[index].enabled = !selectedFolders[index].enabled;
  await detectNoise();
};

window.removeFolder = (index) => {
  selectedFolders.splice(index, 1);
  updateFolderUI();
};

document.getElementById("addBtn").addEventListener("click", async () => {
  const paths = await ipcRenderer.invoke("select-folders");
  if (paths) {
    paths.forEach((p) => {
      if (!selectedFolders.some((f) => f.path === p)) {
        selectedFolders.push({ path: p, enabled: true });
      }
    });
    updateFolderUI();
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  selectedFolders = [];
  activeSmartExcludes.clear();
  updateFolderUI();
  document.getElementById("textContent").value = "";
});

// --- Core File Logic ---

async function getFiles() {
  const manualExcludes = document
    .getElementById("excludeInput")
    .value.split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");

  const allExcludes = [...activeSmartExcludes, ...manualExcludes];
  let allFiles = [];

  for (const folderObj of selectedFolders.filter((f) => f.enabled)) {
    await walk(folderObj.path, allFiles, allExcludes);
  }
  return allFiles;
}

async function walk(dir, filelist = [], excludes = []) {
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (excludes.includes(file)) continue;

      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);

      if (stat.isDirectory()) {
        await walk(filePath, filelist, excludes);
      } else {
        const ext = path.extname(file).toLowerCase();
        const binaryExts = [
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".pdf",
          ".zip",
          ".exe",
          ".dll",
          ".pyc",
          ".ico",
        ];
        if (!binaryExts.includes(ext)) {
          filelist.push(filePath);
        }
      }
    }
  } catch (e) {
    console.error("Walk error:", e);
  }
}

// --- Button Actions ---

document.getElementById("listBtn").addEventListener("click", async () => {
  setLoading(true, "Scanning folders...");
  const files = await getFiles();
  setLoading(false);

  document.getElementById("textContent").value =
    `Total Files: ${files.length}\n\n` + files.join("\n");
});

document.getElementById("concatBtn").addEventListener("click", async () => {
  const files = await getFiles();
  if (files.length === 0) return alert("No files found.");

  setLoading(true, `Reading ${files.length} files...`);

  // Small timeout allows the UI to render the spinner before the loop starts
  setTimeout(async () => {
    let combined = "";
    for (const f of files) {
      try {
        const content = await fs.readFile(f, "utf8");
        combined += `\n\n===== ${f} =====\n\n${content}`;
      } catch (e) {
        combined += `\n\n[Error reading ${f}]\n`;
      }
    }
    document.getElementById("textContent").value =
      combined || "No readable content found.";
    setLoading(false);
  }, 100);
});

document.getElementById("copyBtn").addEventListener("click", () => {
  const text = document.getElementById("textContent");
  if (!text.value) return;

  text.select();
  document.execCommand("copy");

  const btn = document.getElementById("copyBtn");
  const originalText = btn.innerText;
  btn.innerText = "Copied!";
  setTimeout(() => {
    btn.innerText = originalText;
  }, 2000);
});
