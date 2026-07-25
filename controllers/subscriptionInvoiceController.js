const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
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
const {
  SUBSCRIPTION_INVOICE_STATUSES,
  assertSubscriptionInvoiceTransition
} = require('../services/subscriptionInvoiceLifecycle');
const { logAction } = require('../utils/audit');
const { generateSubscriptionInvoicePDF } = require('../utils/subscriptionInvoicePdf');

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

exports.updateDraft = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const invoice = await SubscriptionInvoice.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Subscription invoice not found' });
    }
    if (invoice.status !== 'Draft') {
      await transaction.rollback();
      return res.status(409).json({ error: 'Only Draft subscription invoices can be edited.' });
    }

    const allowedFields = ['billingEmailSnapshot', 'description', 'dueDate', 'subtotal', 'taxAmount'];
    const suppliedFields = Object.keys(req.body || {});
    const forbiddenFields = suppliedFields.filter((field) => !allowedFields.includes(field));
    if (forbiddenFields.length) {
      await transaction.rollback();
      return res.status(403).json({
        error: 'Finance can edit approved draft fields only.',
        forbiddenFields
      });
    }

    const changes = {};
    if (req.body.billingEmailSnapshot !== undefined) {
      const email = String(req.body.billingEmailSnapshot).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Enter a valid invoice billing email.' });
      }
      changes.billingEmailSnapshot = email;
    }
    if (req.body.description !== undefined) {
      const description = String(req.body.description).trim();
      if (!description) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Invoice description is required.' });
      }
      changes.description = description;
    }
    if (req.body.dueDate !== undefined) {
      const dueDate = String(req.body.dueDate).trim();
      if (Number.isNaN(new Date(dueDate).getTime()) || new Date(dueDate) < new Date(invoice.invoiceDate)) {
        await transaction.rollback();
        return res.status(400).json({ error: 'Due date must be valid and cannot be before the invoice date.' });
      }
      changes.dueDate = dueDate;
    }

    const subtotal = req.body.subtotal === undefined ? Number(invoice.subtotal) : Number(req.body.subtotal);
    const taxAmount = req.body.taxAmount === undefined ? Number(invoice.taxAmount) : Number(req.body.taxAmount);
    if (!Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(taxAmount) || taxAmount < 0) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Subtotal and tax must be valid non-negative amounts.' });
    }
    changes.subtotal = Math.round((subtotal + Number.EPSILON) * 100) / 100;
    changes.taxAmount = Math.round((taxAmount + Number.EPSILON) * 100) / 100;
    changes.totalAmount = Math.round((changes.subtotal + changes.taxAmount + Number.EPSILON) * 100) / 100;

    await invoice.update(changes, { transaction });
    let item = await SubscriptionInvoiceItem.findOne({
      where: { subscriptionInvoiceId: invoice.id, lineNumber: 1 },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const itemValues = {
      description: changes.description || invoice.description,
      quantity: 1,
      unitPrice: changes.subtotal,
      lineAmount: changes.subtotal
    };
    if (item) {
      await item.update(itemValues, { transaction });
    } else {
      item = await SubscriptionInvoiceItem.create({
        subscriptionInvoiceId: invoice.id,
        lineNumber: 1,
        ...itemValues
      }, { transaction });
    }
    await transaction.commit();

    await logAction(req, 'edit_draft', 'SubscriptionInvoice', invoice.id, {
      number: invoice.number,
      changedFields: Object.keys(changes)
    });
    res.json(await SubscriptionInvoice.findByPk(invoice.id, {
      include: [{ model: SubscriptionInvoiceItem, as: 'items', separate: true, order: [['lineNumber', 'ASC']] }]
    }));
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    res.status(400).json({ error: error.message });
  }
};

exports.rejectDraft = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const invoice = await SubscriptionInvoice.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Subscription invoice not found' });
    }
    const reason = String((req.body && req.body.reason) || '').trim();
    if (reason.length < 3) {
      await transaction.rollback();
      return res.status(400).json({ error: 'A rejection reason of at least 3 characters is required.' });
    }
    assertSubscriptionInvoiceTransition(invoice.status, 'Rejected');
    await invoice.update({
      status: 'Rejected',
      rejectedBy: req.user.id,
      rejectedAt: new Date(),
      rejectionReason: reason
    }, { transaction });
    await transaction.commit();
    await logAction(req, 'reject', 'SubscriptionInvoice', invoice.id, {
      number: invoice.number,
      reason
    });
    res.json(invoice);
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    const status = error.code === 'INVALID_SUBSCRIPTION_INVOICE_TRANSITION' ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
};

exports.approveDraft = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const invoice = await SubscriptionInvoice.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!invoice) {
      await transaction.rollback();
      return res.status(404).json({ error: 'Subscription invoice not found' });
    }

    assertSubscriptionInvoiceTransition(invoice.status, 'Approved');
    const itemCount = await SubscriptionInvoiceItem.count({
      where: { subscriptionInvoiceId: invoice.id },
      transaction
    });
    if (itemCount === 0) {
      await transaction.rollback();
      return res.status(409).json({ error: 'Invoice cannot be approved without at least one line item.' });
    }
    if (Number(invoice.totalAmount) < 0) {
      await transaction.rollback();
      return res.status(409).json({ error: 'Invoice cannot be approved with an invalid total.' });
    }

    await invoice.update({
      status: 'Approved',
      approvedBy: req.user.id,
      approvedAt: new Date()
    }, { transaction });
    await transaction.commit();

    await logAction(req, 'approve', 'SubscriptionInvoice', invoice.id, {
      number: invoice.number,
      totalAmount: invoice.totalAmount,
      currency: invoice.currency
    });
    res.json({
      invoice,
      message: 'Subscription invoice approved. No email has been sent yet.'
    });
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    const status = error.code === 'INVALID_SUBSCRIPTION_INVOICE_TRANSITION' ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
};

exports.pdf = async (req, res) => {
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
    if (invoice.status !== 'Approved') {
      return res.status(409).json({ error: 'PDF preview is available only after Finance approval.' });
    }

    const pdf = generateSubscriptionInvoicePDF(invoice, invoice.items || []);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.number}.pdf"`);
    pdf.on('error', (error) => {
      if (!res.headersSent) res.status(500).json({ error: error.message });
      else res.destroy(error);
    });
    pdf.pipe(res);
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
