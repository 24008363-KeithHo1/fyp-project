const AuditLog = require('../models/AuditLog');

/**
 * AUDIT LOGGING POLICY:
 * This system logs mutating actions (create, update, send, login, register,
 * password reset, MFA changes) and first-view events (e.g. an invoice's
 * first tokenized view). It intentionally does NOT log every read/list/GET
 * request (e.g. viewing the invoice list, exporting a PDF/Excel copy),
 * since those are high-frequency, low-risk operations and logging every
 * one would add noise without a corresponding security or compliance
 * benefit. If this project were extended for a real deployment, read-access
 * logging could be added selectively (e.g. only for sensitive entities).
 */

/**
 * Log an audit event
 * @param {Object} options - Audit log options
 * @param {number} options.userId - User ID performing the action
 * @param {string} options.action - Action name (e.g., 'create', 'update', 'delete')
 * @param {string} options.entity - Entity type (e.g., 'Invoice', 'Payment', 'User')
 * @param {number} options.entityId - ID of the entity affected
 * @param {Object} options.meta - Additional metadata (changes, reason, etc.)
 * @param {string} options.ip - IP address of requester
 * @param {string} options.userAgent - User agent string
 * @returns {Promise<AuditLog>}
 */
async function logAudit(options = {}) {
  try {
    const {
      userId = null,
      action = '',
      entity = '',
      entityId = null,
      meta = {},
      ip = null,
      userAgent = null
    } = options;

    // Don't log if critical fields are missing
    if (!action || !entity) {
      console.warn('Audit log skipped: missing action or entity', options);
      return null;
    }

    const log = await AuditLog.create({
      userId,
      action,
      entity,
      entityId,
      meta,
      ip,
      userAgent
    });

    return log;
  } catch (err) {
    console.error('Audit log creation failed:', err);
    return null;
  }
}

/**
 * Extract user info and request metadata from Express request
 * @param {Object} req - Express request object
 * @returns {Object} { userId, ip, userAgent }
 */
function getRequestMetadata(req) {
  return {
    userId: req.user ? req.user.id : null,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('user-agent')
  };
}

/**
 * Log with common audit fields from Express request
 * @param {Object} req - Express request object
 * @param {string} action - Action name
 * @param {string} entity - Entity type
 * @param {number} entityId - Entity ID
 * @param {Object} meta - Additional metadata
 * @returns {Promise<AuditLog>}
 */
async function logAction(req, action, entity, entityId, meta = {}) {
  const { userId, ip, userAgent } = getRequestMetadata(req);
  return logAudit({
    userId,
    action,
    entity,
    entityId,
    meta,
    ip,
    userAgent
  });
}

module.exports = {
  logAudit,
  getRequestMetadata,
  logAction
};
