require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const { sequelize } = require('./config/db');

const app = express();
// view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// static frontend (assets)
app.use(express.static(path.join(__dirname, 'public')));

// Rendered pages
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.render('login'));

// Dashboard redirect - routes to role-specific dashboard
app.get('/dashboard', require('./middlewares/auth'), (req, res) => {
  const role = req.user.role || 'Staff';
  if (role === 'Admin') return res.redirect('/admin/dashboard');
  if (role === 'Finance') return res.redirect('/finance/dashboard');
  if (role === 'HR') return res.redirect('/hr/dashboard');
  res.redirect('/staff/dashboard');
});

app.get('/invoices', require('./middlewares/auth'), (req, res) => res.render('invoice'));
app.get('/payroll', require('./middlewares/auth'), (req, res) => res.render('payroll'));
app.get('/mypayslips', require('./middlewares/auth'), require('./controllers/payrollController').mypayslipsView);
app.get('/reports', require('./middlewares/auth'), (req, res) => res.render('reports'));
app.get('/register', (req, res) => res.render('register', { token: req.query.token || '', email: req.query.email || '', title: 'Register' }));
app.get('/reset', (req, res) => res.render('reset', { token: req.query.token || '' }));
app.get('/mfa-setup', (req, res) => res.render('mfa-setup'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/invoices', require('./routes/invoice'));
app.use('/api/payroll', require('./routes/payroll'));
// Admin routes (UI)
app.use('/admin', require('./routes/admin'));
// Role-specific dashboards
app.use('/finance', require('./routes/finance'));
app.use('/hr', require('./routes/hr'));
app.use('/staff', require('./routes/staff'));

// health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('DB connected');
    await sequelize.sync();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start', err);
    process.exit(1);
  }
}

start();
