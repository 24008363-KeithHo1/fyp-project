const Announcement = require('../models/Announcement');
const User = require('../models/User');

module.exports = {
  newPage: async (req, res) => {
    try {
      // render a dedicated announcement creation page for HR/Admin
      res.render('announcements_new', { user: req.user });
    } catch (err) {
      console.error('Failed to render announcement new page', err);
      res.status(500).send('Server error');
    }
  },
  listPage: async (req, res) => {
    try {
      const announcements = await Announcement.findAll({
        where: { isActive: true },
        order: [['createdAt', 'DESC']],
        include: [{ model: User, as: 'author', attributes: ['id', 'name'] }],
      });
      res.render('announcements', { announcements, user: req.user });
    } catch (err) {
      console.error('Failed to load announcements', err);
      res.status(500).send('Server error');
    }
  },

  createAnnouncement: async (req, res) => {
    try {
      if (!req.user || !['Admin', 'HR'].includes(req.user.role)) {
        return res.status(403).send('Forbidden');
      }
      const { title, body } = req.body;
      if (!title || !body) return res.status(400).send('Missing fields');
      let attachments = [];
      if (req.files && req.files.length) {
        attachments = req.files.map(f => `/uploads/announcements/${f.filename}`);
      }
      await Announcement.create({ title, body, createdBy: req.user.id, attachments });
      res.redirect('/announcements');
    } catch (err) {
      console.error('Failed to create announcement', err);
      res.status(500).send('Server error');
    }
  },
};
