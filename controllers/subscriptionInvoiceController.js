const {
  previewSubscriptionInvoiceGeneration
} = require('../services/subscriptionInvoiceGeneration');
const {
  runMonthlySubscriptionInvoiceGeneration
} = require('../services/subscriptionInvoiceAutomation');
const SubscriptionAutomationRun = require('../models/SubscriptionAutomationRun');
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
