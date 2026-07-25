const {
  previewSubscriptionInvoiceGeneration,
  generateSubscriptionInvoiceDrafts
} = require('../services/subscriptionInvoiceGeneration');
const { logAction } = require('../utils/audit');

exports.previewGeneration = async (req, res) => {
  try {
    res.json(await previewSubscriptionInvoiceGeneration(req.query.period));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.generateDrafts = async (req, res) => {
  try {
    const result = await generateSubscriptionInvoiceDrafts(req.body && req.body.period);
    await logAction(req, 'generate_drafts', 'SubscriptionInvoice', null, {
      period: result.period.key,
      eligible: result.eligible,
      generated: result.generated,
      skipped: result.skipped,
      failed: result.failed,
      totalAmount: result.totalAmount
    });
    res.status(result.failed ? 207 : 201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
