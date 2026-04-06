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

app.use(methodOverride('_method'));
app.use(cookieParser());
app.use(compression());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('trust proxy', 1);

console.log('Image recovery mode running');

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

app.get('/', (req, res) => {
  res.send('Image recovery mode is running');
});

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

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
