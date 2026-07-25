const Request = require('../models/Request');
const { logAction } = require('../utils/audit');

exports.create = async (req, res) => {
  try {
    const { title, message, recipient } = req.body;
    let requestData = {};
    if (req.body.data) {
      try {
        const parsedData = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
        if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
          return res.status(400).json({ error: 'Request data must be an object' });
        }
        requestData = parsedData;
      } catch (err) {
        return res.status(400).json({ error: 'Request data must be valid JSON' });
      }
    }
    const errors = [];
    if (!title || !title.trim()) errors.push({ field: 'title', message: 'Title is required' });
    if (!message || !message.trim()) errors.push({ field: 'message', message: 'Message is required' });
    const normalizedRecipient = recipient && ['HR', 'Finance', 'Admin'].includes(recipient) ? recipient : null;
    if (!normalizedRecipient) errors.push({ field: 'recipient', message: 'Recipient must be HR, Finance or Admin' });
    if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

    const attachments = (req.files || []).map(f => ({
      filename: f.filename,
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      path: `/uploads/requests/${f.filename}`
    }));

    const rec = await Request.create({
      title: title.trim(),
      message: message.trim(),
      senderId: req.user.id,
      senderName: req.user.name,
      recipient: normalizedRecipient,
      status: 'Pending',
      data: { ...requestData, attachments }
    });

    await logAction(req, 'create', 'Request', rec.id, { recipient: normalizedRecipient, title: rec.title });
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.list = async (req, res) => {
  try {
    const role = req.user.role;
    let where = {};
    if (role === 'Staff') where = { senderId: req.user.id };
    else if (role === 'HR' || role === 'Finance' || role === 'Admin') where = { recipient: role };
    else where = {};

    const items = await Request.findAll({ where, order: [['id', 'DESC']] });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get = async (req, res) => {
  try {
    const item = await Request.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const role = req.user.role;
    if (role === 'Staff' && item.senderId !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if ((role === 'HR' || role === 'Finance' || role === 'Admin') && item.recipient !== role) return res.status(403).json({ error: 'Forbidden' });

    if ((role === 'HR' || role === 'Finance' || role === 'Admin')) {
      const data = Object.assign({}, item.data || {}, { readAt: new Date().toISOString() });
      await item.update({ data });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const item = await Request.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const role = req.user.role;
    if (!['Admin','HR','Finance'].includes(role)) return res.status(403).json({ error: 'Forbidden' });
    if (item.recipient !== role) return res.status(403).json({ error: 'Forbidden' });
    const status = req.body.status;
    if (!['Pending', 'Completed', 'Incomplete'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await item.update({ status });
    await logAction(req, 'update', 'Request', item.id, { status });
    res.json({ ok: true, request: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UI renderers
exports.staffListPage = async (req, res) => {
  try {
    const items = await Request.findAll({ where: { senderId: req.user.id }, order: [['id', 'DESC']] });
    res.render('staff/requests', { requests: items });
  } catch (err) {
    res.status(500).send('Failed to load requests');
  }
};

exports.newRequestPage = async (req, res) => {
  res.render('staff/new_request');
};

exports.deptInboxPage = async (req, res) => {
  try {
    const role = req.user.role;
    const items = await Request.findAll({ where: { recipient: role }, order: [['id', 'DESC']] });
    res.render(`${role.toLowerCase()}/requests`, { requests: items, role });
  } catch (err) {
    res.status(500).send('Failed to load inbox');
  }
};

exports.viewPage = async (req, res) => {
  try {
    const item = await Request.findByPk(req.params.id);
    if (!item) return res.status(404).send('Request not found');
    const role = req.user.role;
    if (role === 'Staff' && item.senderId !== req.user.id) return res.status(403).send('Forbidden');
    if ((role === 'HR' || role === 'Finance' || role === 'Admin') && item.recipient !== role) return res.status(403).send('Forbidden');
    res.render('requests/view', { request: item });
  } catch (err) {
    res.status(500).send('Failed to open request');
  }
};

// Render leave request page for staff
exports.leaveRequestPage = async (req, res) => {
  try {
    res.render('staff/leave_requests');
  } catch (err) {
    res.status(500).send('Failed to load leave request page');
  }
};

// Render leave inbox for HR / Admin
exports.leaveInboxPage = async (req, res) => {
  try {
    const role = req.user.role;
    const items = await Request.findAll({ where: { recipient: role }, order: [['id', 'DESC']] });
    const leaveRequests = items.filter((item) => item.data && item.data.type === 'leave');
    if (role === 'HR') return res.render('hr/leave_requests', { requests: leaveRequests });
    // Admin fallback: show admin requests view
    return res.render('admin/requests', { requests: items, role });
  } catch (err) {
    res.status(500).send('Failed to load leave requests');
  }
};
