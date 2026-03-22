const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

let selectedFolders = []; 

// --- Folder Management ---
function updateFolderUI() {
    const list = document.getElementById('folderList');
    list.innerHTML = "";
    selectedFolders.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = "folder-item";
        li.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="checkbox" ${item.enabled ? 'checked' : ''} onchange="toggleFolder(${index})">
                <span>${item.path}</span>
            </div>
            <button class="remove-btn" onclick="removeFolder(${index})">Delete</button>
        `;
        list.appendChild(li);
    });
}

window.toggleFolder = (index) => {
    selectedFolders[index].enabled = !selectedFolders[index].enabled;
};

window.removeFolder = (index) => {
    selectedFolders.splice(index, 1);
    updateFolderUI();
};

document.getElementById('addBtn').addEventListener('click', async () => {
    const paths = await ipcRenderer.invoke('select-folders');
    if (paths) {
        paths.forEach(p => { 
            if (!selectedFolders.some(f => f.path === p)) {
                selectedFolders.push({ path: p, enabled: true }); 
            }
        });
        updateFolderUI();
    }
});

document.getElementById('clearBtn').addEventListener('click', () => {
    selectedFolders = [];
    updateFolderUI();
    document.getElementById('textContent').value = "";
});

// --- Validation Logic (CRITICAL: Added back) ---
async function validateFiles(files) {
    if (files.length === 0) return true;

    if (files.length > 100) {
        const choice = await ipcRenderer.invoke('show-warning', `Large task: ${files.length} files detected.`);
        if (choice === 1) return false;
    }

    for (const f of files) {
        try {
            const stats = fs.statSync(f);
            if (stats.size > 1024 * 1024) { // 1MB
                const choice = await ipcRenderer.invoke('show-warning', `Large file detected: ${path.basename(f)} (>1MB).`);
                if (choice === 1) return false;
                break; 
            }
        } catch (e) { continue; }
    }
    return true;
}

// --- File Logic ---
function getFiles() {
    const excludes = document.getElementById('excludeInput').value.split(',').map(s => s.trim()).filter(s => s !== "");
    let allFiles = [];
    
    selectedFolders.filter(f => f.enabled).forEach(folderObj => {
        walkSync(folderObj.path, allFiles, excludes);
    });
    
    return allFiles;
}

function walkSync(dir, filelist = [], excludes = []) {
    try {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            if (excludes.includes(file)) return;
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                walkSync(filePath, filelist, excludes);
            } else {
                filelist.push(filePath);
            }
        });
    } catch (e) { console.error("Error walking directory:", e); }
}

// --- Button Actions ---

document.getElementById('listBtn').addEventListener('click', async () => {
    const files = getFiles();
    if (await validateFiles(files)) {
        document.getElementById('textContent').value = files.length > 0 ? files.join('\n') : "No files found.";
    }
});

document.getElementById('concatBtn').addEventListener('click', async () => {
    const files = getFiles();
    if (!(await validateFiles(files))) return;

    let combined = "";
    files.forEach(f => {
        try {
            const content = fs.readFileSync(f, 'utf8');
            combined += `\n\n===== ${f} =====\n\n${content}`;
        } catch (e) { combined += `\n\n[Error reading ${f}]\n`; }
    });
    document.getElementById('textContent').value = combined || "No content to display.";
});

document.getElementById('copyBtn').addEventListener('click', () => {
    const text = document.getElementById('textContent');
    text.select();
    document.execCommand('copy');
    // Optional: visual feedback
    const originalText = document.getElementById('copyBtn').innerText;
    document.getElementById('copyBtn').innerText = "Copied!";
    setTimeout(() => { document.getElementById('copyBtn').innerText = originalText; }, 2000);
});