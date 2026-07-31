require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const requireRole = require('./middlewares/roles');
const { publicInvoiceLimiter } = require('./middlewares/subscriptionPaymentSecurity');

const { sequelize } = require('./config/db');
const { startPayrollAutomationScheduler } = require('./services/payrollAutomation');
require('./models/PartnerCustomer');
require('./models/SubscriptionInvoiceItem');
require('./models/SubscriptionAutomationRun');
require('./models/SubscriptionEmailDelivery');
require('./models/SubscriptionDemoSchedule');
require('./models/SubscriptionPayment');
require('./models/PaymentReturn');
const { startSubscriptionInvoiceScheduler } = require('./services/subscriptionInvoiceAutomation');
const { startSubscriptionDemoScheduler } = require('./services/subscriptionInvoiceDemoScheduler');
const { startSubscriptionOverdueScheduler } = require('./services/subscriptionInvoiceOverdue');
const { startSubscriptionReminderScheduler } = require('./services/subscriptionInvoiceReminder');

// Register the separate Partner Subscription Billing master-data model with
// Sequelize. It intentionally has no relationship to the existing invoices.

const app = express();
// view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(cors());
app.post('/payment/webhook', express.raw({ type: 'application/json' }), require('./controllers/paymentController').handleWebhook);
app.post('/subscription-payment/webhook', express.raw({ type: 'application/json' }), require('./controllers/subscriptionPaymentController').stripeWebhook);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Make the requested page available to shared view partials (for example,
// highlighting the active item in the finance navigation).
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

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
app.get('/invoices/new', require('./middlewares/auth'), (req, res) => res.render('invoice'));
app.get('/invoices/:id/view', require('./controllers/invoiceController').viewPage);
app.get('/subscription-invoices/view/:token', publicInvoiceLimiter, require('./controllers/subscriptionInvoiceController').publicView);
app.get('/partner-customers', require('./middlewares/auth'), requireRole(['Admin']), require('./controllers/partnerCustomerController').page);
app.get('/payroll', require('./middlewares/auth'), (req, res) => res.render('payroll'));
app.get('/mypayslips', require('./middlewares/auth'), require('./controllers/payrollController').mypayslipsView);
app.get('/reports', require('./middlewares/auth'), (req, res) => res.render('reports'));
app.get('/register', (req, res) => res.render('register', { token: req.query.token || '', email: req.query.email || '', title: 'Register' }));
app.get('/reset', (req, res) => res.render('reset', { token: req.query.token || '' }));
app.get('/mfa-setup', require('./middlewares/auth'), (req, res) => res.render('mfa-setup'));
app.get('/profile', require('./middlewares/auth'), requireRole(['Admin','Staff','Finance','HR']), (req, res) => res.render('staff/profile'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/invoices', require('./routes/invoice'));
app.use('/api/partner-customers', require('./routes/partnerCustomers'));
app.use('/api/subscription-invoices', require('./routes/subscriptionInvoices'));
app.use('/subscription-payments', require('./routes/subscriptionPayments'));
app.use('/api/payroll', require('./routes/payroll'));
app.use('/api/reports', require('./routes/report'));
app.use('/api/requests', require('./routes/requestsApi'));
app.use('/payment', require('./routes/payment'));
// Admin routes (UI)
app.use('/admin', require('./routes/admin'));
// Role-specific dashboards
app.use('/finance', require('./routes/finance'));
app.use('/hr', require('./routes/hr'));
app.use('/staff', require('./routes/staff'));

// Requests UI (staff)
app.get('/requests', require('./middlewares/auth'), requireRole(['Admin','Staff']), require('./controllers/requestsController').staffListPage);
app.get('/requests/new', require('./middlewares/auth'), requireRole(['Admin','Staff']), require('./controllers/requestsController').newRequestPage);
app.get('/requests/:id/view', require('./middlewares/auth'), require('./controllers/requestsController').viewPage);
app.get('/leave-request', require('./middlewares/auth'), requireRole(['Admin','Staff']), require('./controllers/requestsController').leaveRequestPage);

app.get('/leave-requests', require('./middlewares/auth'), requireRole(['HR','Admin']), require('./controllers/requestsController').leaveInboxPage);
// health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await sequelize.authenticate();
    console.log('DB connected');
    startPayrollAutomationScheduler();
    startSubscriptionInvoiceScheduler();
    startSubscriptionDemoScheduler();
    startSubscriptionOverdueScheduler();
    startSubscriptionReminderScheduler();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start', err);
    process.exit(1);
  }
}

start();
