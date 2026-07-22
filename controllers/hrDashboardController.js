const { Op } = require('sequelize');
const User = require('../models/User');
const Request = require('../models/Request');
const Payroll = require('../models/Payroll');

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isLeaveRequest(request) {
  const data = request.data || {};
  return data.type === 'leave' || Boolean(data.startDate && data.endDate) || /\bleave\b/i.test(request.title || '');
}

function isEmployeeOnLeave(request, today) {
  if (!['Approved', 'Completed'].includes(request.status)) return false;

  const data = request.data || {};
  const startDate = dateKey(data.startDate);
  const endDate = dateKey(data.endDate || data.startDate);
  return Boolean(startDate && endDate && startDate <= today && endDate >= today);
}

function isCurrentPayrollPeriod(period, now) {
  const value = String(period || '').trim().toLowerCase();
  if (!value) return false;

  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const numericPeriod = new RegExp(`\\b${year}[-/]0?${month}\\b|\\b0?${month}[-/]${year}\\b`);
  if (numericPeriod.test(value)) return true;

  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const monthName = monthNames[now.getMonth()];
  const shortMonthName = monthName.slice(0, 3);
  const hasCurrentYear = new RegExp(`\\b${year}\\b`).test(value);
  const hasCurrentMonth = new RegExp(`\\b${monthName}\\b|\\b${shortMonthName}\\b`).test(value);
  return hasCurrentYear && hasCurrentMonth;
}

function payrollSummary(payrolls, now) {
  const currentPayrolls = payrolls.filter((payroll) => isCurrentPayrollPeriod(payroll.period, now));
  const counts = currentPayrolls.reduce((summary, payroll) => {
    const status = payroll.payment_status || 'Pending';
    if (status === 'Paid') summary.paid += 1;
    else if (status === 'Approved') summary.approved += 1;
    else summary.pending += 1;
    return summary;
  }, { paid: 0, approved: 0, pending: 0 });

  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const total = currentPayrolls.length;
  return {
    total,
    ...counts,
    status: total ? `${counts.paid}/${total} paid` : 'No payroll run',
    detail: total
      ? `${counts.approved} approved, ${counts.pending} pending`
      : `No records for ${monthLabel}`
  };
}

exports.summary = async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = dateKey(now);
    const [totalEmployees, newHires, hrRequests, payrolls] = await Promise.all([
      User.count({ where: { isActive: true } }),
      User.count({ where: { isActive: true, createdAt: { [Op.gte]: monthStart } } }),
      Request.findAll({
        where: { recipient: 'HR' },
        attributes: ['title', 'senderId', 'status', 'data']
      }),
      Payroll.findAll({ attributes: ['period', 'payment_status'] })
    ]);

    const leaveRequests = hrRequests.filter(isLeaveRequest);
    const employeesOnLeave = new Set(
      leaveRequests
        .filter((request) => isEmployeeOnLeave(request, today))
        .map((request) => request.senderId)
    ).size;

    res.json({
      workforce: {
        totalEmployees,
        newHires,
        employeesOnLeave,
        pendingLeaveRequests: leaveRequests.filter((request) => request.status === 'Pending').length
      },
      payroll: payrollSummary(payrolls, now)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports._private = { isCurrentPayrollPeriod, isEmployeeOnLeave, isLeaveRequest, payrollSummary };