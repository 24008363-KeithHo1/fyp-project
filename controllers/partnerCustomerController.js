const { Op } = require('sequelize');
const PartnerCustomer = require('../models/PartnerCustomer');
const { logAction } = require('../utils/audit');

const ALLOWED_STATUSES = ['Active', 'Suspended', 'Inactive'];
const ALLOWED_BUSINESS_TYPES = [
  'Hair Salon',
  'Nail Salon',
  'Spa & Massage',
  'Aesthetics & Facial',
  'Hair Removal',
  'Makeup Studio',
  "Men's Grooming",
  'Fitness & Wellness',
  'Dental',
  'Chiropractic',
  'TCM',
  'Other'
];

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function validatePayload(body, partial = false) {
  const errors = [];
  const required = ['businessName', 'businessType', 'contactPerson', 'billingEmail', 'subscriptionStartDate'];
  if (!partial) {
    required.forEach((field) => {
      if (!clean(body[field])) errors.push({ field, message: `${field} is required.` });
    });
  }

  if (body.businessType !== undefined && !ALLOWED_BUSINESS_TYPES.includes(clean(body.businessType))) {
    errors.push({ field: 'businessType', message: 'Select a supported business type.' });
  }
  if (body.billingEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(body.billingEmail) || '')) {
    errors.push({ field: 'billingEmail', message: 'Enter a valid billing email.' });
  }
  if (body.subscriptionStartDate !== undefined && Number.isNaN(new Date(body.subscriptionStartDate).getTime())) {
    errors.push({ field: 'subscriptionStartDate', message: 'Enter a valid subscription start date.' });
  }
  if (body.paymentTermsDays !== undefined) {
    const days = Number(body.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      errors.push({ field: 'paymentTermsDays', message: 'Payment terms must be between 0 and 365 days.' });
    }
  }
  if (body.status !== undefined && !ALLOWED_STATUSES.includes(clean(body.status))) {
    errors.push({ field: 'status', message: 'Invalid customer status.' });
  }
  return errors;
}

function writableFields(body) {
  const fields = [
    'businessName', 'businessType', 'contactPerson', 'billingEmail', 'phone',
    'billingAddress', 'region', 'paymentTermsDays', 'subscriptionStartDate',
    'status', 'notes'
  ];
  return fields.reduce((result, field) => {
    if (body[field] !== undefined) result[field] = clean(body[field]);
    return result;
  }, {});
}

async function nextCustomerCode() {
  const latest = await PartnerCustomer.findOne({ order: [['id', 'DESC']] });
  const nextNumber = latest ? latest.id + 1 : 1;
  return `CUS-${String(nextNumber).padStart(4, '0')}`;
}

exports.page = (req, res) => res.render('admin/partner-customers', {
  title: 'Partner Customers',
  businessTypes: ALLOWED_BUSINESS_TYPES
});

exports.list = async (req, res) => {
  try {
    const where = {};
    const status = clean(req.query.status);
    const search = clean(req.query.search);
    if (status && ALLOWED_STATUSES.includes(status)) where.status = status;
    if (search) {
      where[Op.or] = [
        { customerCode: { [Op.like]: `%${search}%` } },
        { businessName: { [Op.like]: `%${search}%` } },
        { contactPerson: { [Op.like]: `%${search}%` } },
        { billingEmail: { [Op.like]: `%${search}%` } }
      ];
    }
    const customers = await PartnerCustomer.findAll({ where, order: [['id', 'DESC']] });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.get = async (req, res) => {
  const customer = await PartnerCustomer.findByPk(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Partner customer not found' });
  res.json(customer);
};

exports.create = async (req, res) => {
  try {
    const errors = validatePayload(req.body || {});
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

    const values = writableFields(req.body);
    values.customerCode = await nextCustomerCode();
    values.currency = 'SGD';
    values.billingCycle = 'Monthly';
    const customer = await PartnerCustomer.create(values);
    await logAction(req, 'create', 'PartnerCustomer', customer.id, {
      customerCode: customer.customerCode,
      businessName: customer.businessName
    });
    res.status(201).json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const customer = await PartnerCustomer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Partner customer not found' });
    const errors = validatePayload(req.body || {}, true);
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

    const changes = writableFields(req.body || {});
    // Customer code, currency and billing cycle are deliberately immutable here.
    await customer.update(changes);
    await logAction(req, 'update', 'PartnerCustomer', customer.id, {
      customerCode: customer.customerCode,
      changedFields: Object.keys(changes)
    });
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.setStatus = async (req, res) => {
  try {
    const customer = await PartnerCustomer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ error: 'Partner customer not found' });
    const status = clean(req.body && req.body.status);
    if (!ALLOWED_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid customer status' });
    const previousStatus = customer.status;
    await customer.update({ status });
    await logAction(req, 'status_change', 'PartnerCustomer', customer.id, {
      customerCode: customer.customerCode,
      previousStatus,
      status
    });
    res.json(customer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.businessTypes = ALLOWED_BUSINESS_TYPES;
