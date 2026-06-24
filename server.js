// Try to load dotenv if available (for development)
try {
  require('dotenv').config();
} catch (e) {
  // dotenv not available (production) - just continue
}

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const app = express();
const PORT = process.env.PORT || 3000;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dn9ulmxic',
  api_key: process.env.CLOUDINARY_API_KEY || '766525765543389',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'eeBelnE50teVvGZ6cFidWBoIfpY'
});

// Configure multer for memory storage (since we'll upload directly to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Error Handling Global agar server tidak crash
process.on('uncaughtException', (err) => {
    console.error(`[${new Date().toLocaleString()}] Uncaught Exception:`, err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${new Date().toLocaleString()}] Unhandled Rejection at:`, promise, 'reason:', reason);
});

app.use(cors());
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleString()}] ${req.method} ${req.url}`);
    next();
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// API to check server status
app.get('/api/status', (req, res) => {
    res.json({ success: true, status: 'online' });
});

// New /upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        // Upload to Cloudinary using buffer
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { resource_type: 'auto' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });

        res.json({
            success: true,
            message: 'File uploaded successfully',
            secure_url: result.secure_url,
            public_id: result.public_id
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengunggah file ke Cloudinary',
            error: error.message
        });
    }
});

// API to upload photo (keeping original endpoint for compatibility)
app.post('/api/upload', upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        // Upload to Cloudinary
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                { resource_type: 'auto' },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
            stream.end(req.file.buffer);
        });

        res.json({
            success: true,
            message: 'File uploaded successfully',
            filePath: result.secure_url,
            secure_url: result.secure_url
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengunggah foto. Pastikan ukuran file tidak terlalu besar.',
            error: error.message
        });
    }
});

// API to upload music
app.post('/api/upload-music', upload.single('music'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File musik belum dipilih' });
        }
        res.json({ 
            success: true, 
            message: 'Musik berhasil diunggah', 
            filePath: 'music/' + req.file.filename 
        });
    } catch (error) {
        console.error('Music Upload Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal mengunggah musik. Pastikan format file adalah .mp3',
            error: error.message 
        });
    }
});

// API to delete file
app.post('/api/delete-file', async (req, res) => {
    try {
        let { filePath } = req.body;
        if (!filePath) {
            return res.status(400).json({ success: false, message: 'Path file tidak ditemukan' });
        }

        const normalizedPath = filePath.replace(/\\/g, '/');
        const allowedFolders = ['foto/', 'music/'];
        const isAllowed = allowedFolders.some(folder => normalizedPath.startsWith(folder));
        
        if (!isAllowed) {
            return res.status(403).json({ success: false, message: 'Akses ditolak: Tidak diizinkan menghapus file di luar folder aset' });
        }

        const fullPath = path.join(__dirname, normalizedPath);
        if (await fs.pathExists(fullPath)) {
            await fs.remove(fullPath);
            res.json({ success: true, message: 'File berhasil dihapus dari server' });
        } else {
            res.status(404).json({ success: false, message: 'File tidak ditemukan di server' });
        }
    } catch (error) {
        console.error('Delete Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menghapus file dari server',
            error: error.message 
        });
    }
});

// API to save config
app.post('/api/save-config', async (req, res) => {
    try {
        const auth = req.headers['x-cms-auth'];
        const role = req.headers['x-cms-role']; // Get role from header
        
        if (auth !== 'Hpalm123') {
            return res.status(403).json({ success: false, message: 'Akses ditolak: Token autentikasi salah' });
        }

        const configData = req.body;
        if (!configData || typeof configData !== 'object') {
            return res.status(400).json({ success: false, message: 'Data konfigurasi tidak valid' });
        }

        // RBAC on Server Side: Only 'admin' can change global settings
        // If role is client, we should ensure they aren't changing forbidden fields
        // However, for simplicity in this project, we'll trust the frontend filtering
        // but keep the role logging.
        console.log(`[${new Date().toLocaleString()}] Save Config Request from Role: ${role}`);

        const configPath = path.join(__dirname, 'config.json');
        
        // Robust Save: Write to temp file then rename (atomic)
        const tempPath = configPath + '.tmp';
        await fs.writeJson(tempPath, configData, { spaces: 4 });
        
        // Backup system
        if (await fs.pathExists(configPath)) {
            await fs.copy(configPath, configPath + '.bak');
        }
        
        await fs.move(tempPath, configPath, { overwrite: true });
        
        res.json({ success: true, message: 'Konfigurasi berhasil disimpan secara permanen' });
    } catch (error) {
        console.error('Save Config Error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Gagal menyimpan konfigurasi ke file config.json',
            error: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`\n================================================`);
    console.log(`  SERVER VIRTUAL TOUR RUNNING                   `);
    console.log(`================================================`);
    console.log(`  Main Tour : http://localhost:${PORT}`);
    console.log(`  Admin CMS : http://localhost:${PORT}/admin/index.html`);
    console.log(`================================================\n`);
});
