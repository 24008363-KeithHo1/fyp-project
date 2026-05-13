const User = require('../models/User');

exports.ensureAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'Admin') return res.status(403).send('Forbidden');
  next();
};

exports.listUsers = async (req, res) => {
  try {
    const users = await User.findAll({ order: [['id', 'ASC']] });
    res.render('admin/users', { users });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.editUserView = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.redirect('/admin/users');
    res.render('admin/edit_user', { user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { role, isActive } = req.body;
    await User.update({ role, isActive: isActive === 'on' }, { where: { id: req.params.id } });
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};
