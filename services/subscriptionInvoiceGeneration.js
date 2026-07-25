const { Op } = require('sequelize');
const { sequelize } = require('../config/db');
const PartnerCustomer = require('../models/PartnerCustomer');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const SubscriptionInvoice = require('../models/SubscriptionInvoice');
const SubscriptionInvoiceItem = require('../models/SubscriptionInvoiceItem');

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseBillingPeriod(period) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!match) throw new Error('Billing period must use YYYY-MM format.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('Billing period month must be between 01 and 12.');

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const nextBillingDate = new Date(Date.UTC(year, month + 1, 0));
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    compact: `${year}${String(month).padStart(2, '0')}`,
    start: isoDate(start),
    end: isoDate(end),
    nextBillingDate: isoDate(nextBillingDate)
  };
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return isoDate(date);
}

function invoiceNumberFor(period, customer) {
  return `SUB-${period.compact}-${String(customer.id).padStart(4, '0')}`;
}

function snapshotFor(customer, period) {
  if (!customer.subscriptionPlan) throw new Error(`Customer ${customer.customerCode} has no active subscription plan.`);
  const fee = Number(customer.subscriptionPlan.monthlyFee);
  const terms = Number(customer.paymentTermsDays);
  return {
    number: invoiceNumberFor(period, customer),
    partnerCustomerId: customer.id,
    subscriptionPlanId: customer.subscriptionPlan.id,
    customerCodeSnapshot: customer.customerCode,
    businessNameSnapshot: customer.businessName,
    billingEmailSnapshot: customer.billingEmail,
    planCodeSnapshot: customer.subscriptionPlan.code,
    planNameSnapshot: customer.subscriptionPlan.name,
    planFeaturesSnapshot: customer.subscriptionPlan.features || [],
    description: `${customer.subscriptionPlan.name} Monthly Subscription Fee`,
    subtotal: fee,
    taxAmount: 0,
    totalAmount: fee,
    currency: customer.subscriptionPlan.currency || customer.currency || 'SGD',
    billingPeriodStart: period.start,
    billingPeriodEnd: period.end,
    invoiceDate: period.end,
    dueDate: addDays(period.end, terms),
    paymentTermsDaysSnapshot: terms,
    status: 'Draft'
  };
}

async function eligibleCustomers(period) {
  return PartnerCustomer.findAll({
    where: {
      status: 'Active',
      autoBillingEnabled: true,
      subscriptionStartDate: { [Op.lte]: period.end },
      nextBillingDate: { [Op.lte]: period.end }
    },
    include: [{
      model: SubscriptionPlan,
      as: 'subscriptionPlan',
      required: true,
      where: { isActive: true }
    }],
    order: [['id', 'ASC']]
  });
}

async function previewSubscriptionInvoiceGeneration(periodInput) {
  const period = parseBillingPeriod(periodInput);
  const customers = await eligibleCustomers(period);
  const existing = await SubscriptionInvoice.findAll({
    where: {
      partnerCustomerId: customers.map((customer) => customer.id),
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end
    },
    attributes: ['partnerCustomerId']
  });
  const existingIds = new Set(existing.map((invoice) => Number(invoice.partnerCustomerId)));
  const candidates = customers.map((customer) => {
    const snapshot = snapshotFor(customer, period);
    return {
      partnerCustomerId: customer.id,
      customerCode: customer.customerCode,
      businessName: customer.businessName,
      plan: customer.subscriptionPlan.name,
      amount: snapshot.totalAmount,
      currency: snapshot.currency,
      dueDate: snapshot.dueDate,
      outcome: existingIds.has(Number(customer.id)) ? 'Duplicate' : 'Ready'
    };
  });
  return {
    period,
    eligible: candidates.length,
    ready: candidates.filter((candidate) => candidate.outcome === 'Ready').length,
    duplicates: candidates.filter((candidate) => candidate.outcome === 'Duplicate').length,
    totalAmount: candidates
      .filter((candidate) => candidate.outcome === 'Ready')
      .reduce((sum, candidate) => sum + Number(candidate.amount), 0),
    candidates
  };
}

async function generateSubscriptionInvoiceDrafts(periodInput) {
  const period = parseBillingPeriod(periodInput);
  const customers = await eligibleCustomers(period);
  const result = {
    period,
    eligible: customers.length,
    generated: 0,
    skipped: 0,
    failed: 0,
    totalAmount: 0,
    invoices: [],
    errors: []
  };

  for (const customer of customers) {
    const existing = await SubscriptionInvoice.findOne({
      where: {
        partnerCustomerId: customer.id,
        billingPeriodStart: period.start,
        billingPeriodEnd: period.end
      }
    });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    const transaction = await sequelize.transaction();
    try {
      const snapshot = snapshotFor(customer, period);
      const invoice = await SubscriptionInvoice.create(snapshot, { transaction });
      await SubscriptionInvoiceItem.create({
        subscriptionInvoiceId: invoice.id,
        lineNumber: 1,
        description: snapshot.description,
        quantity: 1,
        unitPrice: snapshot.subtotal,
        lineAmount: snapshot.subtotal,
        data: { planCode: snapshot.planCodeSnapshot }
      }, { transaction });
      await customer.update({ nextBillingDate: period.nextBillingDate }, { transaction });
      await transaction.commit();

      result.generated += 1;
      result.totalAmount += Number(snapshot.totalAmount);
      result.invoices.push({
        id: invoice.id,
        number: invoice.number,
        customerCode: snapshot.customerCodeSnapshot,
        amount: snapshot.totalAmount,
        currency: snapshot.currency
      });
    } catch (error) {
      await transaction.rollback();
      if (error.name === 'SequelizeUniqueConstraintError') {
        result.skipped += 1;
      } else {
        result.failed += 1;
        result.errors.push({ customerCode: customer.customerCode, error: error.message });
      }
    }
  }

  result.totalAmount = Math.round((result.totalAmount + Number.EPSILON) * 100) / 100;
  return result;
}

module.exports = {
  parseBillingPeriod,
  addDays,
  invoiceNumberFor,
  snapshotFor,
  previewSubscriptionInvoiceGeneration,
  generateSubscriptionInvoiceDrafts
};
