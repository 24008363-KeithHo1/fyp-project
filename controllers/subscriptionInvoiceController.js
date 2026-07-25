const { Op } = require('sequelize');
const {
  previewSubscriptionInvoiceGeneration,
  parseBillingPeriod
} = require('../services/subscriptionInvoiceGeneration');
const {
  runMonthlySubscriptionInvoiceGeneration
} = require('../services/subscriptionInvoiceAutomation');
const SubscriptionAutomationRun = require('../models/SubscriptionAutomationRun');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionInvoiceItem = require('../models/SubscriptionInvoiceItem');
const { SUBSCRIPTION_INVOICE_STATUSES } = require('../services/subscriptionInvoiceLifecycle');
const { logAction } = require('../utils/audit');

exports.reviewPage = (req, res) => res.render('finance/subscription-invoices', {
  title: 'Subscription Invoices',
  statuses: SUBSCRIPTION_INVOICE_STATUSES
});

exports.list = async (req, res) => {
  try {
    const where = {};
    if (req.query.status) {
      if (!SUBSCRIPTION_INVOICE_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid subscription invoice status.' });
      }
      where.status = req.query.status;
    }
    if (req.query.period) {
      const period = parseBillingPeriod(req.query.period);
      where.billingPeriodStart = period.start;
      where.billingPeriodEnd = period.end;
    }
    const search = String(req.query.search || '').trim();
    if (search) {
      where[Op.or] = [
        { number: { [Op.like]: `%${search}%` } },
        { customerCodeSnapshot: { [Op.like]: `%${search}%` } },
        { businessNameSnapshot: { [Op.like]: `%${search}%` } },
        { billingEmailSnapshot: { [Op.like]: `%${search}%` } }
      ];
    }
    const invoices = await SubscriptionInvoice.findAll({
      where,
      order: [['invoiceDate', 'DESC'], ['id', 'DESC']]
    });
    res.json(invoices);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.get = async (req, res) => {
  try {
    const invoice = await SubscriptionInvoice.findByPk(req.params.id, {
      include: [{
        model: SubscriptionInvoiceItem,
        as: 'items',
        separate: true,
        order: [['lineNumber', 'ASC']]
      }]
    });
    if (!invoice) return res.status(404).json({ error: 'Subscription invoice not found' });
    res.json(invoice);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.previewGeneration = async (req, res) => {
  try {
    res.json(await previewSubscriptionInvoiceGeneration(req.query.period));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.generateDrafts = async (req, res) => {
  try {
    const period = req.body && req.body.period;
    const outcome = await runMonthlySubscriptionInvoiceGeneration({
      period,
      triggerSource: 'FinanceRecovery',
      triggeredBy: req.user.id,
      scheduledFor: new Date()
    });
    await logAction(req, 'trigger_generation_recovery', 'SubscriptionAutomationRun', outcome.run.id, {
      period,
      alreadyProcessed: outcome.alreadyProcessed
    });
    if (outcome.alreadyProcessed) {
      return res.status(200).json({
        alreadyProcessed: true,
        message: 'This billing period has already been processed successfully or is currently running.',
        run: outcome.run
      });
    }
    res.status(outcome.result.failed ? 207 : 201).json({
      alreadyProcessed: false,
      run: outcome.run,
      result: outcome.result
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.automationHistory = async (req, res) => {
  try {
    const runs = await SubscriptionAutomationRun.findAll({
      order: [['startedAt', 'DESC'], ['id', 'DESC']],
      limit: 100
    });
    res.json(runs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
