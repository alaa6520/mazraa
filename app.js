require('dotenv').config();
const path = require('path');
const express = require('express');
const fs = require('fs');
const archiver = require('archiver');

const app = express();
const port = process.env.PORT || 3000;

console.log('Image recovery mode running');

app.get('/', (req, res) => {
  res.send('Image recovery mode is running');
});

app.get('/download-images', (req, res) => {
  const targetPath = path.join(__dirname, 'public', 'assests');

  try {
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({
        ok: false,
        error: 'Folder not found',
        triedPath: targetPath
      });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    res.attachment('assests-images.zip');
    archive.pipe(res);
    archive.directory(targetPath, false);
    archive.finalize();

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
