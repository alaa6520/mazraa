require('dotenv').config();
const path = require('path');
const express = require('express');
const fs = require('fs');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const nodemailer = require('nodemailer');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const { randomUUID } = require('crypto');
const compression = require('compression');

const ContractorRequest = require('./models/contractorRequestModel');
const SubscriptionConfig = require('./models/SubscriptionConfig');
const FooterSettings = require('./models/FooterSettings');

// Utils / Mailer
const { verifyTransporter } = require('./utils/mailer2');
verifyTransporter();

// Models
const Farm = require('./models/farmModel');
const User = require('./models/usermodels');

// Routers
const loginRouter = require('./routers/loginrouter');
const publicRouter = require('./routers/public');
const adminRouter = require('./routers/adminRouter');
const ownerRouter = require('./routers/ownerRouter');

async function applyContractorLimitsForUser(userId, tier) {
  try {
    const cfg = await SubscriptionConfig.findOne({ key: 'sub-plans' }).lean().catch(() => null);
    const limitByTier = {
      Basic: cfg?.basicLimit ?? 1,
      Premium: cfg?.premiumLimit ?? 2,
      VIP: cfg?.vipLimit ?? 999,
    };
    const allow = limitByTier[tier] ?? 1;

    const farms = await Farm.find({
      owner: userId,
      deletedAt: null,
      status: 'approved'
    }).sort({ createdAt: -1 });

    const keep = farms.slice(0, allow);
    const suspend = farms.slice(allow);

    await Farm.updateMany(
      { _id: { $in: keep.map(f => f._id) } },
      { $set: { isSuspended: false, suspendedReason: '' } }
    );

    await Farm.updateMany(
      { _id: { $in: suspend.map(f => f._id) } },
      { $set: { isSuspended: true, suspendedReason: 'limit' } }
    );
  } catch (e) {
    console.error('applyContractorLimitsForUser error:', e);
  }
}

const msDay = 24 * 60 * 60 * 1000;

if (!global.__subCleanupJobStarted) {
  global.__subCleanupJobStarted = true;

  setInterval(async () => {
    try {
      const cfg = await SubscriptionConfig.findOne({ key: 'sub-plans' }).lean().catch(() => null);
      const basicLimit = cfg?.basicLimit ?? 1;
      const now = new Date();

      const expired = await User.find({
        subscriptionExpiresAt: { $ne: null, $lte: now },
        $or: [
          { subscriptionGraceUntil: null },
          { subscriptionGraceUntil: { $exists: false } }
        ]
      }).lean();

      for (const u of expired) {
        const graceUntil = new Date(Date.now() + 7 * msDay);
        await User.findByIdAndUpdate(u._id, {
          $set: { subscriptionGraceUntil: graceUntil, subscriptionTier: 'Basic' }
        });

        const farms = await Farm.find({ owner: u._id, deletedAt: null }).sort({ createdAt: -1 });
        const keep = farms.slice(0, basicLimit);
        const suspend = farms.slice(basicLimit);

        if (keep.length) {
          await Farm.updateMany(
            { _id: { $in: keep.map(f => f._id) } },
            { $set: { isSuspended: false, suspendedReason: '' } }
          );
        }

        if (suspend.length) {
          await Farm.updateMany(
            { _id: { $in: suspend.map(f => f._id) } },
            { $set: { isSuspended: true, suspendedReason: 'limit' } }
          );
        }

        await applyContractorLimitsForUser(u._id, 'Basic');
      }

      const graceOver = await User.find({
        subscriptionGraceUntil: { $ne: null, $lte: now }
      }).lean();

      for (const u of graceOver) {
        const farms = await Farm.find({ owner: u._id, deletedAt: null }).sort({ createdAt: -1 });
        const keep = farms.slice(0, basicLimit);
        const remove = farms.slice(basicLimit);

        if (remove.length) {
          await Farm.updateMany(
            { _id: { $in: remove.map(f => f._id) } },
            { $set: { deletedAt: new Date(), isSuspended: true, suspendedReason: 'expired' } }
          );
        }

        if (keep.length) {
          await Farm.updateMany(
            { _id: { $in: keep.map(f => f._id) } },
            { $set: { isSuspended: false, suspendedReason: '' } }
          );
        }

        await applyContractorLimitsForUser(u._id, 'Basic');
      }

    } catch (err) {
      console.error('Subscription cleanup job error:', err);
    }
  }, 12 * 60 * 60 * 1000);
}

const app = express();
const port = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// إعدادات أساسية
// ---------------------------------------------------------------------------
app.use(methodOverride('_method'));
app.use(cookieParser());

app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = (res.getHeader('Content-Type') || '').toString().toLowerCase();
    if (
      type.includes('image/') ||
      type.includes('video/') ||
      type.includes('audio/') ||
      type.includes('font/') ||
      type.includes('pdf') ||
      type.includes('zip') ||
      type.includes('x-7z') ||
      type.includes('x-rar')
    ) return false;

    return compression.filter(req, res);
  }
}));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.json({ limit: '15mb' }));

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------------------------
// اتصال قاعدة البيانات معطّل مؤقتًا لإنقاذ الصور
// ---------------------------------------------------------------------------
// mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)
//   .then(() => console.log('✅ MongoDB connected'))
//   .catch(err => console.error('❌ MongoDB error:', err));

console.log('⚠️ MongoDB connection temporarily disabled for image recovery');

// ---------------------------------------------------------------------------
// API Router
// ---------------------------------------------------------------------------
const api = express.Router();

api.get('/farms/rent', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';

    let rows = await Farm.find({ kind: 'rent', status: 'approved' })
      .populate('owner', 'subscriptionTier')
      .sort({ createdAt: -1 })
      .lean();

    rows = rows.map(f => ({
      ...f,
      ownerTier: (f.owner?.subscriptionTier || 'Basic')
    }));

    if (vipOnly) {
      rows = rows.filter(f => f.ownerTier === 'VIP');
    }

    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

app.use(async (req, res, next) => {
  try {
    const doc = await FooterSettings.findOne({ key: 'default' }).lean();
    res.locals.footer = doc || {};
  } catch (_) {
    res.locals.footer = {};
  }
  next();
});

app.use('/api', api);

// ---------------------------------------------------------------------------
// Cookie مميز للزائر
// ---------------------------------------------------------------------------
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

app.get('/id-by-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: 'Email is required',
      });
    }

    const user = await User.findOne({ email }).select('_id');

    if (!user) {
      return res.status(404).json({
        message: 'User not found',
      });
    }

    res.status(200).json({
      userId: user._id,
    });
  } catch (error) {
    res.status(500).json({
      message: 'Server error',
      error: error.message,
    });
  }
});

// ---------------------------------------------------------------------------
// الجلسات مؤقتًا بدون MongoStore
// ---------------------------------------------------------------------------
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  }
}));

app.use((err, req, res, next) => {
  if (err && /Unable to find the session to touch/i.test(err.message)) {
    res.clearCookie('sid', { sameSite: 'lax' });
    return next();
  }
  next(err);
});

// ---------------------------------------------------------------------------
// تمرير بيانات المستخدم إلى القوالب
// ---------------------------------------------------------------------------
app.use(async (req, res, next) => {
  try {
    const u = req.session?.user || null;

    if (u?._id) {
      const fresh = await User.findById(u._id, 'subscriptionTier plan role name email').lean();
      if (fresh) {
        const tier = fresh.subscriptionTier || fresh.plan || 'Basic';
        if (req.session.user.subscriptionTier !== tier) {
          req.session.user.subscriptionTier = tier;
        }
        res.locals.safeUser = {
          ...req.session.user,
          subscriptionTier: tier,
        };
      } else {
        res.locals.safeUser = u;
      }
    } else {
      res.locals.safeUser = null;
    }

    res.locals.currentUser = req.session?.user || null;
    res.locals.isAuth = !!req.session?.user;
    res.locals.role = req.session?.user?.role || 'guest';
    res.locals.isAdmin = req.session?.user?.role === 'admin';
    res.locals.isContractor = req.session?.user?.role === 'contractor';
    res.locals.isOwner = req.session?.user?.role === 'owner';

    res.locals.msg = req.session.msg || '';
    res.locals.type = req.session.type || '';
    delete req.session.msg;
    delete req.session.type;

    next();
  } catch (e) {
    console.warn('session sync error:', e);
    next();
  }
});

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------
const transporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

if (transporter) {
  transporter.verify((err) => {
    if (err) console.error('SMTP verify error:', err);
    else console.log('✅ SMTP ready to send');
  });
}

app.locals.transporter = transporter;

// ---------------------------------------------------------------------------
// صفحات أساسية
// ---------------------------------------------------------------------------
app.get('/login', (req, res) => res.render('signup'));
app.get('/signup', (req, res) => res.render('signup'));

// ---------------------------------------------------------------------------
// ربط الراوترات
// ---------------------------------------------------------------------------
app.use('/admin', adminRouter);
app.use('/', loginRouter);
app.use('/', publicRouter);
app.use('/', ownerRouter);

// ---------------------------------------------------------------------------
// ملفات عامة
// ---------------------------------------------------------------------------
app.get('/google88fd5ddd67a71ece.html', (req, res) => {
  res.type('text/html');
  res.sendFile(path.join(__dirname, 'google88fd5ddd67a71ece.html'));
});

app.get('/robots.txt', (req, res) => {
  const filePath = path.join(__dirname, 'robots.txt');
  if (fs.existsSync(filePath)) {
    res.type('text/plain');
    return res.sendFile(filePath);
  }

  res.type('text/plain').send(`User-agent: *
Allow: /`);
});

app.get('/sitemap.xml', (req, res) => {
  const filePath = path.join(__dirname, 'sitemap.xml');
  if (fs.existsSync(filePath)) {
    res.type('application/xml');
    return res.sendFile(filePath);
  }
  res.status(404).send('Not found');
});

// ---------------------------------------------------------------------------
// فحص الصور
// ---------------------------------------------------------------------------
app.get('/download-images', (req, res) => {
  const uploadsPath = path.join(__dirname, 'uploads');

  try {
    const files = fs.readdirSync(uploadsPath);
    res.json({
      ok: true,
      uploadsPath,
      count: files.length,
      files: files.slice(0, 100)
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
