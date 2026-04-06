require('dotenv').config();
const path = require('path');
const express = require('express');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

console.log('Image recovery mode running');

// ---------------------- الصفحة الرئيسية ----------------------
app.get('/', (req, res) => {
  res.send('Image recovery mode is running');
});

// ---------------------- عرض public ----------------------
app.get('/download-images', (req, res) => {
  const targetPath = path.join(__dirname, 'public');

  try {
    const items = fs.readdirSync(targetPath, { withFileTypes: true });

    res.json({
      ok: true,
      targetPath,
      items: items.map(i => ({
        name: i.name,
        type: i.isDirectory() ? 'dir' : 'file'
      }))
    });

  } catch (err) {
    res.json({
      ok: false,
      error: err.message,
      triedPath: targetPath
    });
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
