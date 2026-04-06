require('dotenv').config();
const path = require('path');
const express = require('express');
const fs = require('fs');
const session = require('express-session');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const { randomUUID } = require('crypto');
const compression = require('compression');

const app = express();
const port = process.env.PORT || 3000;

// ---------------------- إعدادات ----------------------
app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(compression());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('trust proxy', 1);

console.log('Image recovery mode running');

// ---------------------- Session ----------------------
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

// ---------------------- Cookie ----------------------
app.use((req, res, next) => {
  if (!req.cookies.anonId) {
    res.cookie('anonId', randomUUID(), {
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }
  next();
});

// ---------------------- الصفحة الرئيسية ----------------------
app.get('/', (req, res) => {
  res.send('Image recovery mode is running');
});

// ---------------------- عرض محتويات public ----------------------
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
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});

// ---------------------- تشغيل السيرفر ----------------------
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
