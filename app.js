require('dotenv').config();
const path = require('path');
const express = require('express');
const fs = require('fs');
const session = require('express-session');
const nodemailer = require('nodemailer');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const { randomUUID } = require('crypto');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// إعدادات أساسية
// ---------------------------------------------------------------------------
app.use(methodOverride('_method'));
app.use(cookieParser());

app.use(compression());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('trust proxy', 1);

// ---------------------------------------------------------------------------
// تعطيل Mongo بالكامل (مهم جدًا)
// ---------------------------------------------------------------------------
console.log('⚠️ MongoDB disabled');

// ---------------------------------------------------------------------------
// الجلسات بدون Mongo
// ---------------------------------------------------------------------------
app.use(session({
  name: 'sid',
  secret: 'devsecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ---------------------------------------------------------------------------
// اختبار الصور
// ---------------------------------------------------------------------------
app.get('/download-images', (req, res) => {
  const uploadsPath = path.join(__dirname, 'uploads');

  try {
    const files = fs.readdirSync(uploadsPath);

    res.json({
      ok: true,
      uploadsPath,
      count: files.length,
      files: files.slice(0, 50)
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// ---------------------------------------------------------------------------
// تشغيل السيرفر
// ---------------------------------------------------------------------------
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${port}`);
});
