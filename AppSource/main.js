
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const sqlite3 = require('sqlite3');
const fs = require('fs');

let db;

function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const fromPath = path.join(src, entry.name);
    const toPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(fromPath, toPath);
    } else {
      fs.copyFileSync(fromPath, toPath);
    }
  }
}

function ensureSeededFilesystem(targetRoot, seedRoot) {
  if (fs.existsSync(targetRoot)) {
    return false;
  }
  if (!fs.existsSync(seedRoot)) {
    console.warn('Seed source not found at', seedRoot);
    return false;
  }
  try {
    copyDirectory(seedRoot, targetRoot);
    console.log('Seeded OurLibrary filesystem to', targetRoot);
    return true;
  } catch (error) {
    console.error('Failed to seed OurLibrary filesystem:', error);
    return false;
  }
}

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  win.loadFile('new-desktop-library.html');
}

app.whenReady().then(() => {
  // Runtime filesystem lives at ~/OurLibrary/ (or %USERPROFILE%\OurLibrary on Windows)
  const os = require('os');
  const ourLibraryPath = path.join(os.homedir(), 'OurLibrary');
  const seedPath = app.isPackaged
    ? path.join(process.resourcesPath, 'seed', 'OurLibrary')
    : path.join(__dirname, 'resources', 'seed', 'OurLibrary');

  ensureSeededFilesystem(ourLibraryPath, seedPath);

  if (!fs.existsSync(ourLibraryPath)) {
    console.error('OurLibrary filesystem not found at:', ourLibraryPath);
    const message = 'OurLibrary filesystem not found.\nThe installer could not provision the data directory.';
    dialog.showErrorBox('Filesystem Missing', message);
    app.quit();
    return;
  }

  // Use external filesystem paths
  const configPath = path.join(ourLibraryPath, 'user_data', 'config.json');
  const dbPath = path.join(ourLibraryPath, 'database', 'OurLibrary.db');
  
  // Check if config exists, create basic one if missing
  let config;
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else {
    // Create basic config
    config = {
      local_database_path: 'database/OurLibrary.db',
      app_data_path: ourLibraryPath
    };
    // Ensure user_data directory exists
    const userDataDir = path.dirname(configPath);
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  config.local_database_path = 'database/OurLibrary.db';
  config.app_data_path = ourLibraryPath;
  config.database_filename = config.database_filename || 'OurLibrary.db';
  if (!config.sync_settings) {
    config.sync_settings = { auto_sync_enabled: false, sync_interval_hours: 24 };
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('Error opening database', err.message);
    } else {
      console.log('Connected to the OurLibrary database.');
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db.close();
    app.quit();
  }
});

ipcMain.handle('db:initialize', async () => {
  // This is a placeholder, as the database is already initialized when the app starts.
  return { ok: !!db, mode: 'desktop' };
});

ipcMain.handle('db:connect', async () => {
  // This is a placeholder, as the database is already connected.
  return { ok: !!db, mode: 'desktop' };
});

ipcMain.handle('db:getStatus', async () => {
  return new Promise((resolve, reject) => {
    if (!db) {
      return resolve({ ok: false, mode: 'desktop', books: 0 });
    }
    db.get('SELECT COUNT(*) AS n FROM Books', (err, row) => {
      if (err) {
        console.error(err);
        resolve({ ok: true, mode: 'desktop', books: 0 });
      } else {
        resolve({ ok: true, mode: 'desktop', books: row.n });
      }
    });
  });
});

ipcMain.handle('db:query', async (event, sql, params) => {
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject(new Error('Database not connected'));
    }
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error(err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
});

ipcMain.handle('db:searchBooks', async (event, query) => {
  const sql = `
    SELECT ID, Title, Author, Category_ID, Filename, Thumbnail
    FROM Books
    WHERE Title LIKE ? OR Author LIKE ?
    ORDER BY Title
    LIMIT 200`;
  const params = [`%${query}%`, `%${query}%`];
  return new Promise((resolve, reject) => {
    if (!db) {
      return reject(new Error('Database not connected'));
    }
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error(err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
});

ipcMain.handle('getGoogleConfig', async () => {
    const os = require('os');
    const ourLibraryPath = path.join(os.homedir(), 'OurLibrary');
    const configPath = path.join(ourLibraryPath, 'user_data', 'config.json');
    
    // Try to read the config, return default if not found
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // Return Google-specific config or default values
        return {
            database_url: path.join(ourLibraryPath, 'database', 'OurLibrary.db'),
            database_file_id: config.database_file_id || "19uVpwt7uROQ_BCdsea32LlBUQF5v7zJl",
            database_filename: "OurLibrary.db",
            total_books: config.total_books || 1219,
            sync_settings: config.sync_settings || { auto_sync_enabled: false, sync_interval_hours: 24 }
        };
    } catch (error) {
        console.error('Error reading config:', error);
        // Return default config
        return {
            database_url: path.join(ourLibraryPath, 'database', 'OurLibrary.db'),
            database_file_id: "19uVpwt7uROQ_BCdsea32LlBUQF5v7zJl",
            database_filename: "OurLibrary.db",
            total_books: 1219,
            sync_settings: { auto_sync_enabled: false, sync_interval_hours: 24 }
        };
    }
});

ipcMain.handle('updateDatabase', async (event, buffer) => {
    // Desktop mode - updateDatabase is not needed as we use local database directly
    console.log('updateDatabase called in desktop mode - using local database, no remote update needed.');
    return { ok: true, mode: 'desktop', updated: false };
});

// Local file access functionality
ipcMain.handle('file:openDialog', async (event, options) => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'PDF Files', extensions: ['pdf'] },
            { name: 'Text Files', extensions: ['txt', 'md'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        ...options
    });
    return result;
});

ipcMain.handle('file:readFile', async (event, filePath) => {
    try {
        const content = fs.readFileSync(filePath);
        return { success: true, content: content.toString('base64'), path: filePath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('file:openExternal', async (event, filePath) => {
    try {
        await shell.openExternal(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('file:showItemInFolder', async (event, filePath) => {
    try {
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('file:getFileInfo', async (event, filePath) => {
    try {
        const stats = fs.statSync(filePath);
        return {
            success: true,
            info: {
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory()
            }
        };
    } catch (error) {
        return { success: false, error: error.message };
    }
});
